import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/csrf";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { studyFlowRetiredResponse } from "@/lib/study-flow-retirement";

/** V1 credential renewal is retired; V2 uses `/api/study/sessions/renew`. */
export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) {
    return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
  }
  const auth = await requireRole(ROLES.STUDENT);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  return studyFlowRetiredResponse();
}
