import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { readRecentAuthGrantSnapshot } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { checkLimit, getClientIp } from "@/lib/login-limiter";
import { securityEventData } from "@/lib/security-events";
import { exportLearningAnalytics, readLearningAnalyticsExportRequest } from "@/lib/learning-analytics";
import { mapAnalyticsExportError, serializeAnalyticsCsv, serializeAnalyticsXlsx } from "@/lib/learning-analytics-export-http";

const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
function errorResponse(code: string, status: number) { return NextResponse.json({ code }, { status, headers }); }
function contentDisposition(filename: string) { return `attachment; filename="${filename.replaceAll('"', "")}"`; }
function authError(status: number) { return errorResponse(status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : status === 403 ? "ROLE_FORBIDDEN" : "AUTH_REQUIRED", status); }
function limiterPseudonym(domain: string, value: string) {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "development-only-export-limiter-secret";
  return createHmac("sha256", secret).update(domain).update(":").update(value).digest("hex");
}
type ExportAuditInput = {
  actorUserId: string;
  request: Awaited<ReturnType<typeof readLearningAnalyticsExportRequest>>;
  ip: string;
  rowCount: number;
};

export type ExportRouteDependencies = {
  requireRole: typeof requireRole;
  isSameOriginMutation: typeof isSameOriginMutation;
  readRecentAuthGrantSnapshot: typeof readRecentAuthGrantSnapshot;
  checkLimit: typeof checkLimit;
  getClientIp: typeof getClientIp;
  readLearningAnalyticsExportRequest: typeof readLearningAnalyticsExportRequest;
  exportLearningAnalytics: typeof exportLearningAnalytics;
  serializeAnalyticsCsv: typeof serializeAnalyticsCsv;
  serializeAnalyticsXlsx: typeof serializeAnalyticsXlsx;
  recordExportAudit: (input: ExportAuditInput) => Promise<void>;
};

async function recordExportAudit(input: ExportAuditInput) {
  try {
    await prisma.securityEvent.create({ data: securityEventData({ actorUserId: input.actorUserId, subjectAccount: `learning-analytics-export:${input.request.scope.toLowerCase()}`, eventType: "ROSTER_EXPORTED", ip: input.ip, metadata: { exportKind: "LEARNING_ANALYTICS", scope: input.request.scope, format: input.request.format, granularity: input.request.comparisonGranularity, rowCount: input.rowCount } }) });
  } catch {
    // Do not deliver a PII report without its audit record.
    throw new Error("AUDIT_BACKEND_UNAVAILABLE");
  }
}

const defaultDependencies: ExportRouteDependencies = {
  requireRole,
  isSameOriginMutation,
  readRecentAuthGrantSnapshot,
  checkLimit,
  getClientIp,
  readLearningAnalyticsExportRequest,
  exportLearningAnalytics,
  serializeAnalyticsCsv,
  serializeAnalyticsXlsx,
  recordExportAudit,
};

export function createLearningAnalyticsExportPost(dependencies: ExportRouteDependencies = defaultDependencies) {
  return async function POST(req: Request) {
    if (!dependencies.isSameOriginMutation(req)) return errorResponse("CSRF_ORIGIN_INVALID", 403);
    let auth: Awaited<ReturnType<typeof requireRole>>;
    try {
      auth = await dependencies.requireRole(ROLES.TEACHER, ROLES.ADMIN);
    } catch {
      return authError(503);
    }
    if (!auth.ok) return authError(auth.status);
    try {
      const readRecentAuth = async () => {
        try {
          return await dependencies.readRecentAuthGrantSnapshot({ req, userId: auth.userId });
        } catch {
          throw new Error("AUTH_BACKEND_UNAVAILABLE");
        }
      };
      const initialRecentAuth = await readRecentAuth();
    if (!initialRecentAuth) return errorResponse("RECENT_AUTH_REQUIRED", 401);
    const ip = dependencies.getClientIp(req.headers);
    const limit = await dependencies.checkLimit(`learning-analytics-export:${auth.role}:${limiterPseudonym("actor", auth.userId)}`, limiterPseudonym("ip", ip));
    if (!limit.ok) return errorResponse(limit.backendUnavailable ? "RATE_LIMIT_BACKEND_UNAVAILABLE" : "EXPORT_RATE_LIMITED", limit.backendUnavailable ? 503 : 429);
    const request = await dependencies.readLearningAnalyticsExportRequest(req);
    const result = await dependencies.exportLearningAnalytics({ userId: auth.userId, role: auth.role, request });
    const finalRecentAuth = await readRecentAuth();
    if (!finalRecentAuth || finalRecentAuth.sessionJti !== initialRecentAuth.sessionJti || finalRecentAuth.user.tokenVersion !== initialRecentAuth.user.tokenVersion || finalRecentAuth.user.credentialRevision !== initialRecentAuth.user.credentialRevision || finalRecentAuth.grant.reauthenticatedAt.getTime() !== initialRecentAuth.grant.reauthenticatedAt.getTime() || finalRecentAuth.grant.expiresAt.getTime() !== initialRecentAuth.grant.expiresAt.getTime()) throw new Error("RECENT_AUTH_REQUIRED");
    const writeAudit = () => dependencies.recordExportAudit({ actorUserId: auth.userId, request, ip, rowCount: result.rowCount });
    const filename = `${request.scope.toLowerCase()}-learning-analytics-${new Date().toISOString().slice(0, 10)}.${request.format.toLowerCase()}`;
    if (request.format === "CSV") {
      const text = dependencies.serializeAnalyticsCsv(result);
      await writeAudit();
      return new Response(text, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": contentDisposition(filename), "X-Export-Row-Count": String(result.rowCount), "X-Export-Scope": request.scope } });
    }
    const buffer = await dependencies.serializeAnalyticsXlsx(result);
    await writeAudit();
    return new Response(new Uint8Array(buffer), { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": contentDisposition(filename), "X-Export-Row-Count": String(result.rowCount), "X-Export-Scope": request.scope } });
    } catch (error) {
      const code = error instanceof Error ? error.message : "EXPORT_FAILED";
      const mapped = mapAnalyticsExportError(code);
      return errorResponse(mapped.code, mapped.status);
    }
  };
}

export const POST = createLearningAnalyticsExportPost();

export async function GET() { return errorResponse("METHOD_NOT_ALLOWED", 405); }
