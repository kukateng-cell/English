import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { checkStudyRate } from "@/lib/study-limiter";
import { isStudyStreamV2Assigned } from "@/lib/study-stream/assignment";
import {
  reconcileStudyStreamAction,
  StudyStreamError,
} from "@/lib/study-stream/server";
import { parseStudyStreamAction } from "@/lib/study-stream/contracts";
import { describeStudyStreamFailure } from "@/lib/study-stream/logging";
import { observeStudyStreamRequest } from "@/lib/study-stream/observability";
import { isSameOriginMutation } from "@/lib/csrf";
import { readLimitedBody } from "@/lib/request-body";

const BODY_LIMIT = 32 * 1024;

function errorResponse(error: unknown): NextResponse {
  if (error instanceof StudyStreamError) {
    return NextResponse.json({ error: error.message, ...error.details }, { status: error.status });
  }
  console.error("[study-stream] action reconciliation failed", describeStudyStreamFailure(error));
  return NextResponse.json({ error: "學習操作狀態暫時不可用，請稍後重試" }, { status: 503 });
}

/**
 * POST /api/study/actions/reconcile — authenticated, read-only terminal
 * status check for a queued action whose bearer credential may have fallen
 * out of the bounded lineage. It never scores, acknowledges feedback, or
 * returns the item contents.
 */
export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
  const context: {
    flowVersion?: "v2";
    actionKind?: string;
    outcome?: "assignment-off" | "rate-limited";
  } = {};
  return observeStudyStreamRequest("action-reconciliation", async () => {
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
    const parsed = parseStudyStreamAction(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    context.actionKind = parsed.value.actionKind;
    const rate = await checkStudyRate(auth.userId);
    if (!rate.ok) {
      context.outcome = "rate-limited";
      return NextResponse.json(
        { error: "學習提交過於頻繁，請稍後再試" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } },
      );
    }
    try {
      return NextResponse.json(await reconcileStudyStreamAction(auth.userId, parsed.value));
    } catch (error) {
      return errorResponse(error);
    }
  }, () => context);
}
