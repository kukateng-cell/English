import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { isSameOriginMutation } from "@/lib/csrf";

function governanceResponse(action: "update" | "retire") {
  return NextResponse.json({
    code: "CATALOG_GOVERNANCE_REQUIRED",
    error: action === "retire"
      ? "詞庫不可直接刪除；請經 catalog lifecycle workflow 停用。"
      : "詞庫內容必須經 CSV catalog workflow 提交及審核。",
  }, { status: 410 });
}

export async function PATCH(req: Request) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  return governanceResponse("update");
}

export async function DELETE(req: Request) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  return governanceResponse("retire");
}
