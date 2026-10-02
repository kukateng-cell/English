import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { isSameOriginMutation } from "@/lib/csrf";
import { queryAdminUserDirectory, readAdminDirectoryQuery } from "@/lib/admin-user-directory";

const headers = {
  "Cache-Control": "private, no-store",
  "Vary": "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function authError(status: number) {
  return NextResponse.json({ code: status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : status === 403 ? "ROLE_FORBIDDEN" : "AUTH_REQUIRED" }, { status, headers });
}

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403, headers });
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return authError(auth.status);
  try {
    const query = await readAdminDirectoryQuery(req);
    const result = await queryAdminUserDirectory(query);
    return NextResponse.json(result, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
    const status = code === "PAYLOAD_TOO_LARGE" ? 413 : code === "CURRENT_YEAR_UNAVAILABLE" ? 503 : code === "ACADEMIC_YEAR_NOT_FOUND" ? 404 : ["CURSOR_INVALID", "QUERY_INVALID", "DIRECTORY_TOO_LARGE"].includes(code) ? 422 : code === "ADMIN_USER_QUERY_STALE" ? 409 : 500;
    return NextResponse.json({ code: status === 500 ? "INTERNAL_ERROR" : code }, { status, headers });
  }
}
