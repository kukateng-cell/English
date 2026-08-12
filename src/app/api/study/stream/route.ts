import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getClientIp } from "@/lib/login-limiter";
import { checkStudyQueueRate } from "@/lib/study-limiter";
import { isStudyStreamV2Assigned } from "@/lib/study-stream/assignment";
import {
  getOrCreateStudyStream,
  StudyStreamError,
} from "@/lib/study-stream/server";
import { describeStudyStreamFailure } from "@/lib/study-stream/logging";
import { observeStudyStreamRequest } from "@/lib/study-stream/observability";

function errorResponse(error: unknown): NextResponse {
  if (error instanceof StudyStreamError) {
    return NextResponse.json({ error: error.message, ...error.details }, { status: error.status });
  }
  console.error("[study-stream] bootstrap failed", describeStudyStreamFailure(error));
  return NextResponse.json({ error: "学习流暂时不可用，请稍后重试" }, { status: 503 });
}

/** GET /api/study/stream — V2 bootstrap/resume; V1 remains the default. */
export async function GET(req: Request) {
  const context: { flowVersion?: "v1" | "v2"; outcome?: "assignment-off" | "rate-limited" } = {};
  return observeStudyStreamRequest("bootstrap", async () => {
    const auth = await requireUser();
    if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
    if (!isStudyStreamV2Assigned(auth.userId)) {
      context.flowVersion = "v1";
      context.outcome = "assignment-off";
      return NextResponse.json({ ok: true, assigned: false, flowVersion: "v1" });
    }
    context.flowVersion = "v2";
    if (new URL(req.url).searchParams.get("assignmentOnly") === "1") {
      return NextResponse.json({ ok: true, assigned: true, flowVersion: "v2" });
    }
    const rate = await checkStudyQueueRate(auth.userId, getClientIp(req.headers));
    if (!rate.ok) {
      context.outcome = "rate-limited";
      return NextResponse.json(
        { error: "学习队列请求过于频繁，请稍后再试" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } },
      );
    }
    const url = new URL(req.url);
    try {
      return NextResponse.json(await getOrCreateStudyStream(auth.userId, {
        mode: url.searchParams.get("mode"),
        level: url.searchParams.get("level"),
        category: url.searchParams.has("category") ? url.searchParams.get("category") : null,
        itemCredential: url.searchParams.get("itemCredential"),
      }));
    } catch (error) {
      return errorResponse(error);
    }
  }, () => context);
}
