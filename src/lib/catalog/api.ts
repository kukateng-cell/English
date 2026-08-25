import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { catalogAccess, type CatalogActor } from "./access";
import { consumeCatalogGovernanceLimit } from "@/lib/catalog-limiter";
import { getClientIp } from "@/lib/login-limiter";
import { Prisma } from "@/lib/prisma";
import { CatalogCsvError } from "./csv";
import { CatalogRetryPreviewBlockedError } from "./submission";
import { isRetryableTransactionConflict } from "@/lib/transaction-retry";

export const CATALOG_PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
} as const;

export function catalogResponse(code: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ code, ...extra }, { status, headers: CATALOG_PRIVATE_HEADERS });
}

export async function requireCatalogActor(req: Request, options: { review?: boolean; rateLimit?: boolean } = {}): Promise<
  | { ok: true; actor: CatalogActor; canReview: boolean }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) {
    return {
      ok: false,
      response: catalogResponse(auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 401 ? "AUTH_REQUIRED" : "ROLE_FORBIDDEN", auth.status),
    };
  }
  const access = await catalogAccess(auth);
  if (options.review && !access.canReview) return { ok: false, response: catalogResponse("CATALOG_REVIEW_FORBIDDEN", 403) };
  if (options.rateLimit) {
    const limit = await consumeCatalogGovernanceLimit(auth.userId, getClientIp(req));
    if (!limit.ok) {
      const response = catalogResponse(limit.backendUnavailable ? "RATE_LIMIT_BACKEND_UNAVAILABLE" : "CATALOG_RATE_LIMITED", limit.backendUnavailable ? 503 : 429);
      response.headers.set("Retry-After", String(limit.retryAfterSec));
      return { ok: false, response };
    }
  }
  return { ok: true, actor: auth, canReview: access.canReview };
}

export async function parseJsonObject(req: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > maxBytes) throw new Error("CATALOG_INPUT_TOO_LARGE");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CATALOG_INPUT_INVALID");
  return value as Record<string, unknown>;
}

export async function readLimitedBody(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("CATALOG_CSV_TOO_LARGE");
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("body limit exceeded");
      throw new Error("CATALOG_CSV_TOO_LARGE");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function catalogRouteError(error: unknown): NextResponse {
  const code = error instanceof CatalogCsvError ? error.code : error instanceof Error ? error.message : "CATALOG_REQUEST_FAILED";
  if (error instanceof CatalogRetryPreviewBlockedError) {
    return catalogResponse(error.message, 409, { rows: error.rows });
  }
  if (isRetryableTransactionConflict(error)) return catalogResponse("CATALOG_REQUEST_STALE", 409);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return catalogResponse("CATALOG_IDENTITY_CONFLICT", 409);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return catalogResponse("CATALOG_REQUEST_STALE", 409);
  if (error instanceof SyntaxError) return catalogResponse("CATALOG_INPUT_INVALID", 422);
  if (code === "CATALOG_HISTORY_FORBIDDEN") return catalogResponse("CATALOG_HISTORY_NOT_FOUND", 404);
  if (code === "CATALOG_BATCH_NOT_FOUND" || code === "CATALOG_GROUP_NOT_FOUND" || code === "CATALOG_REQUEST_NOT_FOUND" || code === "CATALOG_HISTORY_NOT_FOUND" || code === "CATALOG_FEEDBACK_NOT_FOUND" || code === "CATALOG_SENSE_NOT_FOUND") return catalogResponse(code, 404);
  if (code.endsWith("_FORBIDDEN") || code === "CATALOG_SELF_REVIEW_FORBIDDEN") return catalogResponse(code, 403);
  if (code === "RECENT_AUTH_REQUIRED") return catalogResponse(code, 401);
  if (code.includes("TOO_LARGE")) return catalogResponse(code, 413);
  if (code === "CATALOG_BATCH_EXPIRED") return catalogResponse(code, 410);
  if (code === "CATALOG_CHANGE_PENDING" || code === "CATALOG_BATCH_RETRY_NO_LONGER_APPLICABLE") {
    return catalogResponse(code, 409);
  }
  if (code.startsWith("CATALOG_CSV_") || code.endsWith("_INVALID") || code.endsWith("_REQUIRED") || code === "CATALOG_BATCH_HAS_ERRORS" || code === "CATALOG_BATCH_NEEDS_RESOLUTION" || code === "CATALOG_BATCH_EMPTY") {
    return catalogResponse(code, 422, error instanceof CatalogCsvError ? { message: error.message } : undefined);
  }
  if (code === "IDEMPOTENCY_CONFLICT" || code === "CATALOG_SUBMITTED_PAYLOAD_IMMUTABLE" || code.includes("STALE") || code.includes("NOT_EDITABLE") || code.includes("NOT_SUBMITTABLE") || code.includes("NOT_REVIEWABLE") || code.includes("NOT_RETRYABLE") || code.includes("NOT_FINALIZABLE") || code.includes("NOT_CANCELLABLE") || code.includes("INCOMPLETE") || code.includes("ALREADY_CLAIMED") || code.includes("ALREADY_SUPERSEDED") || code.includes("CLAIM_REQUIRED") || code === "CATALOG_BATCH_REVIEW_REQUIRED" || code === "CATALOG_EXPORT_SELECTION_PENDING") {
    return catalogResponse(code, 409);
  }
  if (code === "CATALOG_NOT_READY") return catalogResponse(code, 503);
  console.error("[catalog] governance request failed", { errorType: error instanceof Error ? error.name : typeof error });
  return catalogResponse("CATALOG_REQUEST_FAILED", 500);
}
