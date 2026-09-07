import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSameOriginMutation } from "@/lib/csrf";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { readRecentAuthGrantSnapshot } from "@/lib/recent-auth";
import { checkLimit, getClientIp } from "@/lib/login-limiter";
import { securityEventData } from "@/lib/security-events";
import { exportLearningRewards, readRewardRequest, recheckRewardAccess } from "@/lib/learning-reward-analytics";
import { serializeLearningRewardCsv, serializeLearningRewardDailyXlsx, serializeLearningRewardXlsx } from "@/lib/learning-reward-export";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

function errorResponse(code: string, status: number) { return NextResponse.json({ code }, { status, headers }); }
function authError(status: number) { return errorResponse(status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : status === 403 ? "ROLE_FORBIDDEN" : "AUTH_REQUIRED", status); }
function contentDisposition(filename: string) { return `attachment; filename="${filename.replaceAll('"', "")}"`; }
function limiterPseudonym(domain: string, value: string) {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "development-only-reward-export-limiter-secret";
  return createHmac("sha256", secret).update(domain).update(":").update(value).digest("hex");
}

function mapError(code: string) {
  const status = ["PAYLOAD_TOO_LARGE", "REWARD_SCOPE_TOO_LARGE", "EXPORT_TOO_LARGE"].includes(code) ? 413
    : ["CLASS_NOT_FOUND", "STUDENT_NOT_FOUND"].includes(code) ? 404
      : ["QUERY_INVALID", "RANGE_OUTSIDE_CURRENT_YEAR"].includes(code) ? 422
        : code === "REWARD_SCOPE_STALE" ? 409
          : ["CURRENT_YEAR_UNAVAILABLE", "AUTH_BACKEND_UNAVAILABLE", "AUDIT_BACKEND_UNAVAILABLE", "ROSTER_MUTATION_STATE_MISSING"].includes(code) ? 503
            : code === "ROLE_FORBIDDEN" ? 403
              : ["AUTH_REQUIRED", "RECENT_AUTH_REQUIRED"].includes(code) ? 401
                : 500;
  return { status, code: status === 500 ? "EXPORT_FAILED" : code };
}

async function recordRewardExportAudit(input: { actorUserId: string; format: string; ip: string; rowCount: number }) {
  try {
    await prisma.securityEvent.create({
      data: securityEventData({
        actorUserId: input.actorUserId,
        subjectAccount: "learning-reward-export",
        eventType: "ROSTER_EXPORTED",
        ip: input.ip,
        metadata: { exportKind: "LEARNING_REWARD", format: input.format, rowCount: input.rowCount },
      }),
    });
  } catch {
    throw new Error("AUDIT_BACKEND_UNAVAILABLE");
  }
}

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return errorResponse("CSRF_ORIGIN_INVALID", 403);
  let auth: Awaited<ReturnType<typeof requireRole>>;
  try { auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN); } catch { return authError(503); }
  if (!auth.ok) return authError(auth.status);
  try {
    const readRecentAuth = async () => {
      try { return await readRecentAuthGrantSnapshot({ req, userId: auth.userId }); } catch { throw new Error("AUTH_BACKEND_UNAVAILABLE"); }
    };
    const initialAuth = await readRecentAuth();
    if (!initialAuth) return errorResponse("RECENT_AUTH_REQUIRED", 401);
    const ip = getClientIp(req.headers);
    const limit = await checkLimit(`learning-reward-export:${auth.role}:${limiterPseudonym("actor", auth.userId)}`, limiterPseudonym("ip", ip));
    if (!limit.ok) return errorResponse(limit.backendUnavailable ? "RATE_LIMIT_BACKEND_UNAVAILABLE" : "EXPORT_RATE_LIMITED", limit.backendUnavailable ? 503 : 429);
    const request = await readRewardRequest(req, { route: "EXPORT" });
    const result = await exportLearningRewards({ userId: auth.userId, role: auth.role, request });
    const finalAuth = await readRecentAuth();
    if (!finalAuth || finalAuth.sessionJti !== initialAuth.sessionJti || finalAuth.user.tokenVersion !== initialAuth.user.tokenVersion || finalAuth.user.credentialRevision !== initialAuth.user.credentialRevision || finalAuth.grant.reauthenticatedAt.getTime() !== initialAuth.grant.reauthenticatedAt.getTime() || finalAuth.grant.expiresAt.getTime() !== initialAuth.grant.expiresAt.getTime()) throw new Error("RECENT_AUTH_REQUIRED");
    const rowCount = request.format === "DAILY_XLSX" ? result.days.length : result.totals.length;
    const extension = request.format === "CSV" ? "csv" : "xlsx";
    const filename = `${request.format === "DAILY_XLSX" ? "learning-reward-daily" : "learning-reward"}-${result.requestedRange.fromDate}-${result.requestedRange.toDate}-${result.policy.weights.effort}-${result.policy.weights.outcome}.${extension}`;
    if (request.format === "CSV") {
      const text = serializeLearningRewardCsv(result);
      await recordRewardExportAudit({ actorUserId: auth.userId, format: request.format, ip, rowCount });
      await recheckRewardAccess({ userId: auth.userId, role: auth.role, scopeToken: result.scopeToken, scopeRevision: result.scopeRevision, academicYearId: result.academicYear.id });
      return new Response(text, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": contentDisposition(filename), "X-Export-Row-Count": String(rowCount) } });
    }
    const buffer = request.format === "DAILY_XLSX" ? await serializeLearningRewardDailyXlsx(result) : await serializeLearningRewardXlsx(result);
    await recordRewardExportAudit({ actorUserId: auth.userId, format: request.format!, ip, rowCount });
    await recheckRewardAccess({ userId: auth.userId, role: auth.role, scopeToken: result.scopeToken, scopeRevision: result.scopeRevision, academicYearId: result.academicYear.id });
    return new Response(new Uint8Array(buffer), { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": contentDisposition(filename), "X-Export-Row-Count": String(rowCount) } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "EXPORT_FAILED";
    const mapped = mapError(code);
    return errorResponse(mapped.code, mapped.status);
  }
}

export async function GET() { return errorResponse("METHOD_NOT_ALLOWED", 405); }
