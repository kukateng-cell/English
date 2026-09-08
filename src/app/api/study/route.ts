import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/csrf";
import { requireUser } from "@/lib/session";
import { studyFlowRetiredResponse } from "@/lib/study-flow-retirement";

/**
 * The former V1 study writer is kept as a short-lived compatibility barrier.
 * It authenticates the caller, performs no body parsing or database write, and
 * never translates a legacy submission into a V2 action.
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  return studyFlowRetiredResponse();
}

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) {
    return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
  }
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  return studyFlowRetiredResponse();
}
