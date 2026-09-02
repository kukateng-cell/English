import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { getStudentDashboard } from "@/lib/student-metrics";

export async function GET() {
  const auth = await requireRole(ROLES.STUDENT);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  try {
    const response = NextResponse.json(await getStudentDashboard(auth.userId));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return NextResponse.json({ error: "暫時無法載入學習概覽" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
