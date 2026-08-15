import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { checkLimit, getClientIp } from "@/lib/login-limiter";
import { securityEventData } from "@/lib/security-events";
import { projectExportRows, resolveExportRows, validateExportRequest } from "@/lib/roster-export";

function codeResponse(code: string, status: number) { return NextResponse.json({ code }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
function safeSpreadsheetText(value: unknown) { const text = value === null || value === undefined ? "" : String(value); return /^[=+\-@\t\r]/u.test(text) ? `'${text}` : text; }
function csvCell(value: unknown) { const text = safeSpreadsheetText(value); return `"${text.replaceAll('"', '""')}"`; }
function contentDisposition(filename: string) { return `attachment; filename="${filename.replaceAll('"', "")}"`; }

async function gate(req: Request) {
  if (!isSameOriginMutation(req)) return { response: codeResponse("CSRF_ORIGIN_INVALID", 403) } as const;
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return { response: codeResponse("AUTH_REQUIRED", auth.status) } as const;
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) return { response: codeResponse("RECENT_AUTH_REQUIRED", 401) } as const;
  const limit = await checkLimit(`roster-export:${auth.userId}`, getClientIp(req.headers));
  if (!limit.ok) return { response: codeResponse("EXPORT_RATE_LIMITED", 429) } as const;
  return { auth } as const;
}

export async function POST(req: Request) {
  const checked = await gate(req);
  if ("response" in checked) return checked.response;
  if (Number(req.headers.get("content-length") ?? 0) > 16 * 1024) return codeResponse("EXPORT_INPUT_INVALID", 422);
  const rawBody = await req.text().catch(() => "");
  if (Buffer.byteLength(rawBody, "utf8") > 16 * 1024) return codeResponse("EXPORT_INPUT_INVALID", 422);
  const body = (() => { try { return JSON.parse(rawBody) as { entityType?: unknown; academicYearId?: unknown; fields?: unknown; filters?: unknown; format?: unknown }; } catch { return null; } })();
  if (!body) return codeResponse("EXPORT_INPUT_INVALID", 422);
  const validated = validateExportRequest(body);
  if (!validated.ok) return codeResponse(validated.code, 422);
  const request = validated.request;
  const format = body.format === "CSV" ? "CSV" : body.format === "XLSX" ? "XLSX" : null;
  if (!format) return codeResponse("EXPORT_FORMAT_INVALID", 422);
  const transactionStartedAt = Date.now();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const rows = await resolveExportRows(tx, request);
      const projected = projectExportRows(rows, request.fields);
      await tx.securityEvent.create({ data: securityEventData({ actorUserId: checked.auth.userId, subjectAccount: `roster-export:${request.entityType.toLowerCase()}`, eventType: "ROSTER_EXPORTED", ip: getClientIp(req.headers), metadata: { entityType: request.entityType, academicYearId: request.academicYearId, format, fields: request.fields, rowCount: rows.length } }) });
      return { rows, projected };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 });
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${request.entityType.toLowerCase()}-roster-${date}.${format.toLowerCase()}`;
    const serverTiming = `roster-export-transaction;dur=${Date.now() - transactionStartedAt}`;
    if (format === "CSV") {
      const text = `\uFEFF${request.fields.map(csvCell).join(",")}\r\n${result.projected.map((row) => request.fields.map((field) => csvCell(row[field])).join(",")).join("\r\n")}`;
      return new Response(text, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": contentDisposition(filename), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Server-Timing": serverTiming } });
    }
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "English Vocabulary Roster";
    const sheet = workbook.addWorksheet("Roster", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = request.fields.map((field) => ({ header: field, key: field, width: Math.max(16, field.length + 4), style: { numFmt: "@" } }));
    for (const row of result.projected) sheet.addRow(Object.fromEntries(request.fields.map((field) => [field, safeSpreadsheetText(row[field])])))
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, result.rows.length + 1), column: request.fields.length } };
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": contentDisposition(filename), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Server-Timing": serverTiming } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ROSTER_EXPORT_FAILED";
    const status = code === "EXPORT_TOO_LARGE" ? 413 : code === "ACADEMIC_YEAR_NOT_FOUND" ? 404 : 409;
    return codeResponse(["EXPORT_TOO_LARGE", "ACADEMIC_YEAR_NOT_FOUND"].includes(code) ? code : "ROSTER_EXPORT_FAILED", status);
  }
}

export async function GET() {
  return codeResponse("METHOD_NOT_ALLOWED", 405);
}
