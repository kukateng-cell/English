import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { checkStudyRate } from "@/lib/study-limiter";
import { isStudyStreamV2Assigned } from "@/lib/study-stream/assignment";
import {
  recoverExpiredStudyStreamAction,
  StudyStreamError,
} from "@/lib/study-stream/server";
import { parseStudyStreamRecoveryAction } from "@/lib/study-stream/contracts";
import { describeStudyStreamFailure } from "@/lib/study-stream/logging";
import { observeStudyStreamRequest } from "@/lib/study-stream/observability";
import { isSameOriginMutation } from "@/lib/csrf";
import { readLimitedBody } from "@/lib/request-body";

const BODY_LIMIT = 32 * 1024;

function errorResponse(error: unknown): NextResponse {
  if (error instanceof StudyStreamError) {
    return NextResponse.json({ error: error.message, ...error.details }, { status: error.status });
  }
  console.error("[study-stream] action recovery failed", describeStudyStreamFailure(error));
  return NextResponse.json({ error: "學習操作恢復暫時不可用，請稍後重試" }, { status: 503 });
}

/**
 * POST /api/study/actions/recover — one bounded retry for an expired V2
 * session. The body is the same typed action contract plus an optional
 * item-bound recovery proof; no client score or replacement item is accepted.
 */
export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
  const context: {
    flowVersion?: "v2";
    actionKind?: string;
    outcome?: "assignment-off" | "rate-limited";
  } = {};
  return observeStudyStreamRequest("action-recovery", async () => {
    const auth = await requireUser();
    if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
    context.flowVersion = "v2";
    if (!isStudyStreamV2Assigned(auth.userId)) {
      context.outcome = "assignment-off";
      return NextResponse.json({ error: "目前帳戶未分配 Retrieval-first Learning Stream" }, { status: 404 });
    }
    let body: unknown = null;
    try {
      const raw = new TextDecoder().decode(await readLimitedBody(req, BODY_LIMIT));
      body = raw ? JSON.parse(raw) as unknown : null;
    } catch (error) {
      if (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE") return NextResponse.json({ error: "請求內容過大" }, { status: 413 });
    }
    const parsed = parseStudyStreamRecoveryAction(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    context.actionKind = parsed.value.action.actionKind;
    const rate = await checkStudyRate(auth.userId);
    if (!rate.ok) {
      context.outcome = "rate-limited";
      return NextResponse.json(
        { error: "學習提交過於頻繁，請稍後再試" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } },
      );
    }
    try {
      const result = await recoverExpiredStudyStreamAction(
        auth.userId,
        parsed.value.action,
        parsed.value.recoveryCredential,
      );
      return NextResponse.json(result.response);
    } catch (error) {
      return errorResponse(error);
    }
  }, () => context);
}
