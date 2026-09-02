import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getClientIp } from "@/lib/login-limiter";
import { checkStudyCredentialRate } from "@/lib/study-limiter";
import { isStudyStreamV2Assigned } from "@/lib/study-stream/assignment";
import {
  renewStudyStreamCredential,
  StudyStreamError,
} from "@/lib/study-stream/server";
import { describeStudyStreamFailure } from "@/lib/study-stream/logging";
import { observeStudyStreamRequest } from "@/lib/study-stream/observability";
import { isSameOriginMutation } from "@/lib/csrf";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRenewInput(value: unknown) {
  if (!isRecord(value) || Object.keys(value).some((key) => ![
    "flowVersion", "studySessionId", "streamItemId", "itemCredential", "clientKnownRevision",
  ].includes(key))) return null;
  if (
    value.flowVersion !== "v2" ||
    typeof value.studySessionId !== "string" || value.studySessionId.length < 8 || value.studySessionId.length > 128 ||
    typeof value.streamItemId !== "string" || value.streamItemId.length < 8 || value.streamItemId.length > 128 ||
    typeof value.itemCredential !== "string" || value.itemCredential.length < 32 || value.itemCredential.length > 256 ||
    typeof value.clientKnownRevision !== "number" || !Number.isSafeInteger(value.clientKnownRevision) || value.clientKnownRevision < 0
  ) return null;
  return {
    studySessionId: value.studySessionId,
    streamItemId: value.streamItemId,
    itemCredential: value.itemCredential,
    clientKnownRevision: value.clientKnownRevision,
  };
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof StudyStreamError) {
    return NextResponse.json({ error: error.message, ...error.details }, { status: error.status });
  }
  console.error("[study-stream] credential renewal failed", describeStudyStreamFailure(error));
  return NextResponse.json({ error: "學習憑證暫時不可用，請稍後重試" }, { status: 503 });
}

/** POST /api/study/sessions/renew — V2 item credential lineage only. */
export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
  const context: {
    flowVersion?: "v2";
    outcome?: "assignment-off" | "rate-limited";
  } = {};
  return observeStudyStreamRequest("credential-renewal", async () => {
    const auth = await requireUser();
    if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
    context.flowVersion = "v2";
    if (!isStudyStreamV2Assigned(auth.userId)) {
      context.outcome = "assignment-off";
      return NextResponse.json({ error: "目前帳戶未分配 Retrieval-first Learning Stream" }, { status: 404 });
    }
    const body = await req.json().catch(() => null);
    const input = parseRenewInput(body);
    if (!input) return NextResponse.json({ error: "憑證續期請求格式錯誤" }, { status: 400 });
    const rate = await checkStudyCredentialRate(auth.userId, getClientIp(req.headers));
    if (!rate.ok) {
      context.outcome = "rate-limited";
      return NextResponse.json(
        { error: "學習憑證請求過於頻繁，請稍後再試" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } },
      );
    }
    try {
      return NextResponse.json(await renewStudyStreamCredential(auth.userId, input));
    } catch (error) {
      return errorResponse(error);
    }
  }, () => context);
}
