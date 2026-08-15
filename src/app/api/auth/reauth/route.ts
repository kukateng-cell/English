import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { getClientIp, checkLimit, checkReauthSessionLimit } from "@/lib/login-limiter";
import { isSameOriginMutation } from "@/lib/csrf";
import { getRequestToken, issueRecentAuthGrant } from "@/lib/recent-auth";
import { securityEventData } from "@/lib/security-events";

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) {
    return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
  }
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: auth.status });
  }
  const token = await getRequestToken(req);
  if (!token?.sessionJti || token.id !== auth.userId) {
    return NextResponse.json({ code: "RECENT_AUTH_SESSION_INVALID" }, { status: 401 });
  }
  const ip = getClientIp(req.headers);
  const limit = await checkLimit(`reauth:${auth.userId}`, ip);
  if (!limit.ok) {
    return NextResponse.json(
      { code: "REAUTH_RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec ?? 60) } },
    );
  }
  const sessionLimit = await checkReauthSessionLimit(token.sessionJti);
  if (!sessionLimit.ok) {
    return NextResponse.json({ code: "REAUTH_RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(sessionLimit.retryAfterSec ?? 60) } });
  }
  if (Number(req.headers.get("content-length") ?? 0) > 16 * 1024) return NextResponse.json({ code: "PASSWORD_REQUIRED" }, { status: 422 });
  const rawBody = await req.text().catch(() => "");
  if (Buffer.byteLength(rawBody, "utf8") > 16 * 1024) return NextResponse.json({ code: "PASSWORD_REQUIRED" }, { status: 422 });
  const body = (() => { try { return JSON.parse(rawBody) as { password?: unknown }; } catch { return null; } })();
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password) return NextResponse.json({ code: "PASSWORD_REQUIRED" }, { status: 422 });

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: {
      id: true,
      accountName: true,
      passwordHash: true,
      role: true,
      status: true,
      tokenVersion: true,
      credentialRevision: true,
    },
  });
  if (!user || user.status !== "ACTIVE") {
    return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ code: "PASSWORD_INVALID" }, { status: 401 });
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await issueRecentAuthGrant(tx, {
      sessionJti: token.sessionJti as string,
      userId: user.id,
      tokenVersion: user.tokenVersion,
      credentialRevision: user.credentialRevision,
      now,
    });
    await tx.securityEvent.create({
      data: securityEventData({
        actorUserId: user.id,
        subjectUserId: user.id,
        subjectAccount: user.accountName,
        eventType: "PROFILE_UPDATED",
        ip,
        metadata: { kind: "RECENT_AUTH_REAUTH" },
      }),
    });
  });
  return NextResponse.json({ ok: true, expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString() }, {
    headers: { "Cache-Control": "no-store" },
  });
}
