import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";

const templates = {
  STUDENT: ["accountName", "legalName", "nickname", "grade", "classCode", "contactEmail"],
  TEACHER: ["accountName", "legalName", "contactEmail", "classAccess", "resetPasswordAccess"],
} as const;

export async function GET(_req: Request, { params }: { params: Promise<{ entity: string; format: string }> }) {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: auth.status });
  const { entity, format } = await params;
  const key = entity.toUpperCase() as keyof typeof templates;
  if (!(key in templates) || !["csv", "xlsx"].includes(format.toLowerCase())) return NextResponse.json({ code: "TEMPLATE_NOT_FOUND" }, { status: 404 });
  const headers = [...templates[key]];
  const filename = `${key.toLowerCase()}-roster-v1-template.${format.toLowerCase()}`;
  if (format.toLowerCase() === "csv") {
    return new Response(`\uFEFF${headers.join(",")}\r\n`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("data");
  sheet.columns = headers.map((header) => ({ header, key: header, style: { numFmt: "@" } }));
  sheet.addRow(headers.map(() => ""));
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
}
