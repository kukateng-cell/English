import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { validateNicknameAgainstIdentity } from "@/lib/nickname";
import { checkNicknameChangeRate } from "@/lib/nickname-limiter";
import { getClientIp } from "@/lib/login-limiter";
import { securityEventData } from "@/lib/security-events";
import { isSameOriginMutation } from "@/lib/csrf";
import { lockRosterIdentityKeys, lockRosterMutationState } from "@/lib/roster-server";

const PROFILE_SELECT = {
  accountName: true,
  contactEmail: true,
  studentProfile: {
    select: {
      legalName: true,
      nickname: true,
      profileRevision: true,
      enrollments: {
        where: { status: "ACTIVE", academicYear: { status: "CURRENT" } },
        take: 1,
        select: {
          grade: true,
          schoolClass: { select: { classCode: true } },
          academicYear: { select: { label: true } },
        },
      },
    },
  },
} as const;

function serializeProfile(user: {
  accountName: string;
  contactEmail: string | null;
  studentProfile: {
    legalName: string;
    nickname: string;
    profileRevision: number;
    enrollments: Array<{
      grade: string;
      schoolClass: { classCode: string } | null;
      academicYear: { label: string };
    }>;
  } | null;
}) {
  const enrollment = user.studentProfile?.enrollments[0];
  return {
    accountName: user.accountName,
    contactEmail: user.contactEmail,
    legalName: user.studentProfile?.legalName ?? "",
    nickname: user.studentProfile?.nickname ?? "",
    profileRevision: user.studentProfile?.profileRevision ?? 0,
    academicYear: enrollment?.academicYear.label ?? null,
    grade: enrollment?.grade ?? null,
    classCode: enrollment?.schoolClass?.classCode ?? null,
  };
}

function authResponse(status: 401 | 403 | 503) {
  return NextResponse.json(
    { code: status === 401 ? "AUTH_REQUIRED" : status === 403 ? "FORBIDDEN" : "AUTH_BACKEND_UNAVAILABLE" },
    { status },
  );
}

export async function GET() {
  const auth = await requireRole(ROLES.STUDENT);
  if (!auth.ok) {
    return authResponse(auth.status);
  }
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: PROFILE_SELECT,
  });
  if (!user?.studentProfile) {
    return NextResponse.json({ code: "PROFILE_NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json(serializeProfile(user), { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: Request) {
  if (!isSameOriginMutation(req)) {
    return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
  }
  const auth = await requireRole(ROLES.STUDENT);
  if (!auth.ok) {
    return authResponse(auth.status);
  }
  const limit = await checkNicknameChangeRate(auth.userId);
  if (!limit.ok) {
    return NextResponse.json(
      { code: "NICKNAME_RATE_LIMITED" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec ?? 60) },
      },
    );
  }
  const body = await req.json().catch(() => null);
  const identity = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: {
      accountName: true,
      contactEmail: true,
      studentProfile: { select: { legalName: true } },
    },
  });
  if (!identity?.studentProfile) {
    return NextResponse.json({ code: "PROFILE_NOT_FOUND" }, { status: 404 });
  }
  const nickname = validateNicknameAgainstIdentity(String(body?.nickname ?? ""), {
    legalName: identity.studentProfile.legalName,
    accountName: identity.accountName,
    contactEmail: identity.contactEmail,
  });
  if (!nickname.ok) return NextResponse.json({ code: "NICKNAME_INVALID" }, { status: 422 });
  const revision = Number(body?.profileRevision);
  if (!Number.isInteger(revision) || revision < 0) {
    return NextResponse.json({ code: "PROFILE_REVISION_INVALID" }, { status: 422 });
  }

  let updated: Prisma.UserGetPayload<{ select: typeof PROFILE_SELECT }> | null;
  try {
    updated = await prisma.$transaction(async (tx) => {
    await lockRosterMutationState(tx);
    await lockRosterIdentityKeys(tx, [identity.accountName, nickname.normalized]);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${auth.userId} FOR UPDATE`;
    const freshIdentity = await tx.user.findUnique({ where: { id: auth.userId }, select: { accountName: true, contactEmail: true, studentProfile: { select: { legalName: true, profileRevision: true } } } });
    if (!freshIdentity?.studentProfile) return null;
    const freshNickname = validateNicknameAgainstIdentity(nickname.value, {
      legalName: freshIdentity.studentProfile.legalName,
      accountName: freshIdentity.accountName,
      contactEmail: freshIdentity.contactEmail,
    });
    if (!freshNickname.ok) throw new Error("NICKNAME_INVALID");
    const result = await tx.studentProfile.updateMany({
      where: { userId: auth.userId, profileRevision: revision },
      data: {
        nickname: freshNickname.value,
        nicknameNormalized: freshNickname.normalized,
        nicknameUpdatedAt: new Date(),
        profileRevision: { increment: 1 },
      },
    });
    if (result.count !== 1) return null;
    const user = await tx.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: PROFILE_SELECT,
    });
    await tx.securityEvent.create({
      data: securityEventData({
        actorUserId: auth.userId,
        subjectUserId: auth.userId,
        subjectAccount: user.accountName,
        eventType: "NICKNAME_CHANGED",
        ip: getClientIp(req.headers),
        metadata: { profileRevision: revision + 1 },
      }),
    });
    return user;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "NICKNAME_INVALID") return NextResponse.json({ code: "NICKNAME_INVALID" }, { status: 422 });
    return NextResponse.json({ code: "PROFILE_WRITE_CONFLICT" }, { status: 409 });
  }
  if (!updated) {
    return NextResponse.json(
      { code: "PROFILE_STALE" },
      { status: 409 },
    );
  }
  return NextResponse.json({
    ...serializeProfile(updated),
  }, { headers: { "Cache-Control": "no-store" } });
}
