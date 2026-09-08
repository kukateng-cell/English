import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/csrf";
import { requireUser } from "@/lib/session";
import { studyFlowRetiredResponse } from "@/lib/study-flow-retirement";

/** V1 session rotation is retired; V2 renews item credentials by lineage. */
export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) {
    return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
  }
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  return studyFlowRetiredResponse();
}
