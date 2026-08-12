import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { checkStudyRate } from "@/lib/study-limiter";
import { isStudyStreamV2Assigned } from "@/lib/study-stream/assignment";
import {
  applyStudyStreamAction,
  StudyStreamError,
} from "@/lib/study-stream/server";
import { parseStudyStreamAction } from "@/lib/study-stream/contracts";
import { describeStudyStreamFailure } from "@/lib/study-stream/logging";
import { observeStudyStreamRequest } from "@/lib/study-stream/observability";

function errorResponse(error: unknown): NextResponse {
  if (error instanceof StudyStreamError) {
    return NextResponse.json({ error: error.message, ...error.details }, { status: error.status });
  }
  console.error("[study-stream] action failed", describeStudyStreamFailure(error));
  return NextResponse.json({ error: "学习操作暂时不可用，请稍后重试" }, { status: 503 });
}

/** POST /api/study/actions — typed V2 intent; server derives all outcomes. */
export async function POST(req: Request) {
  const context: {
    flowVersion?: "v2";
    actionKind?: string;
    outcome?: "duplicate-replay" | "assignment-off" | "rate-limited";
  } = {};
  return observeStudyStreamRequest("action", async () => {
    const auth = await requireUser();
    if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
    context.flowVersion = "v2";
    if (!isStudyStreamV2Assigned(auth.userId)) {
      context.outcome = "assignment-off";
      return NextResponse.json({ error: "当前账户未分配 Retrieval-first Learning Stream" }, { status: 404 });
    }
    const body = await req.json().catch(() => null);
    const parsed = parseStudyStreamAction(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    context.actionKind = parsed.value.actionKind;
    const rate = await checkStudyRate(auth.userId);
    if (!rate.ok) {
      context.outcome = "rate-limited";
      return NextResponse.json(
        { error: "学习提交过于频繁，请稍后再试" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } },
      );
    }
    try {
      const result = await applyStudyStreamAction(auth.userId, parsed.value);
      if (result.duplicate) context.outcome = "duplicate-replay";
      return NextResponse.json(result.response);
    } catch (error) {
      return errorResponse(error);
    }
  }, () => context);
}
