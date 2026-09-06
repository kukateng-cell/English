import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import {
  rotateStudySession,
  serializeStudySession,
  StudySessionRotationError,
} from "@/lib/study-session-server";
import { checkStudyCredentialRate } from "@/lib/study-limiter";
import { getClientIp } from "@/lib/login-limiter";
import { canResumeStudySession } from "@/lib/study-session";
import { isSameOriginMutation } from "@/lib/csrf";
import { readLimitedBody } from "@/lib/request-body";

const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const BODY_LIMIT = 16 * 1024;

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  const rate = await checkStudyCredentialRate(auth.userId, getClientIp(req.headers));
  if (!rate.ok) {
    return NextResponse.json(
      { error: "學習憑證續期過於頻繁，請稍後再試" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } },
    );
  }
  let body: Record<string, unknown> | null = null;
  try {
    const raw = new TextDecoder().decode(await readLimitedBody(req, BODY_LIMIT));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch (error) {
    if (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE") {
      return NextResponse.json({ error: "請求內容過大" }, { status: 413 });
    }
  }
  const previousSessionId =
    typeof body?.previousSessionId === "string" ? body.previousSessionId.trim() : "";
  const rotationKey =
    typeof body?.rotationKey === "string" ? body.rotationKey.trim() : "";
  const queueIds = body?.queueIds;
  if (
    !ID_PATTERN.test(previousSessionId) ||
    !ID_PATTERN.test(rotationKey) ||
    !canResumeStudySession(queueIds)
  ) {
    return NextResponse.json({ error: "學習 session 輪換請求無效" }, { status: 400 });
  }
  try {
    const session = await rotateStudySession(
      auth.userId,
      previousSessionId,
      queueIds,
      rotationKey,
    );
    return NextResponse.json({ studySession: serializeStudySession(session) });
  } catch (error) {
    if (error instanceof StudySessionRotationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
