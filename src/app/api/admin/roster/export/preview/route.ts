import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireAdminMutation } from "@/lib/roster-api";
import { resolveExportRows, validateExportRequest } from "@/lib/roster-export";

export async function POST(req: Request) {
  const gate = await requireAdminMutation(req);
  if (!gate.ok) return gate.response;
  if (Number(req.headers.get("content-length") ?? 0) > 16 * 1024) return NextResponse.json({ code: "EXPORT_INPUT_INVALID" }, { status: 422 });
  const rawBody = await req.text().catch(() => "");
  if (Buffer.byteLength(rawBody, "utf8") > 16 * 1024) return NextResponse.json({ code: "EXPORT_INPUT_INVALID" }, { status: 422 });
  const body = (() => { try { return JSON.parse(rawBody); } catch { return null; } })();
  const validated = validateExportRequest(body);
  if (!validated.ok) return NextResponse.json({ code: validated.code }, { status: 422 });
  try {
    const rows = await prisma.$transaction((tx) => resolveExportRows(tx, validated.request), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 });
    return NextResponse.json({ count: rows.length, fields: validated.request.fields, entityType: validated.request.entityType, academicYearId: validated.request.academicYearId }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "EXPORT_PREVIEW_FAILED";
    return NextResponse.json({ code: code === "EXPORT_TOO_LARGE" ? code : "EXPORT_PREVIEW_FAILED" }, { status: code === "EXPORT_TOO_LARGE" ? 413 : code === "ACADEMIC_YEAR_NOT_FOUND" ? 404 : 409 });
  }
}
