import { readLimitedBody } from "@/lib/catalog/body";
import { NextResponse } from "next/server";
import { Prisma, prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { isSameOriginMutation } from "@/lib/csrf";
import { catalogAccess, requireCatalogReviewerInTransaction } from "@/lib/catalog/access";
import { reviewCatalogChange } from "@/lib/catalog/change-application";
import { catalogRequestTerminalStatus } from "@/lib/catalog/review-policy";
import { isRetryableTransactionConflict } from "@/lib/transaction-retry";
import { consumeCatalogGovernanceLimit } from "@/lib/catalog-limiter";
import { getClientIp } from "@/lib/login-limiter";

function headers() {
  return {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

function response(code: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ code, ...extra }, { status, headers: headers() });
}

async function resolvedReplay(id: string): Promise<NextResponse | null> {
  try {
    const current = await prisma.catalogChangeRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        kind: true,
        reviewNote: true,
        reviewedAt: true,
        resultRevisionId: true,
      },
    });
    if (!current || !catalogRequestTerminalStatus(current.status)) return null;
    return NextResponse.json({
      replay: true,
      request: {
        id: current.id,
        status: current.status,
        kind: current.kind,
        reviewNote: current.reviewNote,
        reviewedAt: current.reviewedAt?.toISOString() ?? null,
      },
      canonicalMutation: false,
      resultRevisionId: current.resultRevisionId,
    }, { headers: headers() });
  } catch {
    return null;
  }
}

export function createCatalogReviewPatch(dependencies: {
  requireRole: typeof requireRole;
  consumeCatalogGovernanceLimit: typeof consumeCatalogGovernanceLimit;
} = { requireRole, consumeCatalogGovernanceLimit }) {
  const { requireRole, consumeCatalogGovernanceLimit } = dependencies;
  return async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(req)) return response("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) {
    return response(
      auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 401 ? "AUTH_REQUIRED" : "ROLE_FORBIDDEN",
      auth.status,
    );
  }
  const access = await catalogAccess(auth);
  if (!access.canReview) return response("CATALOG_REVIEW_FORBIDDEN", 403);
  const limit = await consumeCatalogGovernanceLimit(auth.userId, getClientIp(req.headers));
  if (!limit.ok) {
    const limited = response(limit.backendUnavailable ? "RATE_LIMIT_BACKEND_UNAVAILABLE" : "CATALOG_RATE_LIMITED", limit.backendUnavailable ? 503 : 429);
    limited.headers.set("Retry-After", String(limit.retryAfterSec));
    return limited;
  }
  let body: Record<string, unknown>;
  try {
    const rawBody = new TextDecoder().decode(await readLimitedBody(req, 32 * 1024, "CATALOG_INPUT_TOO_LARGE"));
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body");
    body = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === "CATALOG_INPUT_TOO_LARGE") return response("CATALOG_INPUT_TOO_LARGE", 413);
    return response("CATALOG_INPUT_INVALID", 422);
  }
  const decision = body.decision === "APPROVE" || body.decision === "REJECT" ? body.decision : null;
  const expectedRevision = Number(body.expectedRevision);
  const reviewNote = typeof body.reviewNote === "string" ? body.reviewNote.trim() : "";
  const { id } = await params;
  if (!decision || !Number.isInteger(expectedRevision) || expectedRevision < 0 || reviewNote.length > 2000) {
    return response("CATALOG_INPUT_INVALID", 422);
  }
  if (decision === "REJECT" && reviewNote.length < 3) return response("CATALOG_REVIEW_NOTE_REQUIRED", 422);

  try {
    const result = await prisma.$transaction(async (tx) => {
      await requireCatalogReviewerInTransaction(tx, auth.userId);
      return reviewCatalogChange(tx, {
        requestId: id,
        reviewerId: auth.userId,
        expectedRevision,
        decision,
        reviewNote,
        batchMode: false,
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    });
    return NextResponse.json(result, { headers: headers() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (isRetryableTransactionConflict(error)) return await resolvedReplay(id) ?? response("CATALOG_REQUEST_STALE", 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return await resolvedReplay(id) ?? response("CATALOG_REQUEST_STALE", 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return response("CATALOG_IDENTITY_CONFLICT", 409);
    if (message === "CATALOG_REQUEST_NOT_FOUND") return response(message, 404);
    if (message === "CATALOG_REVIEW_FORBIDDEN") return response(message, 403);
    if (message === "CATALOG_BATCH_REVIEW_REQUIRED") return response(message, 409);
    if ([
      "CATALOG_REQUEST_STALE", "CATALOG_REVISION_STALE", "CATALOG_SELF_REVIEW_FORBIDDEN",
      "CATALOG_ALREADY_RETIRED", "CATALOG_NOT_RETIRED", "CATALOG_NOT_ACTIVE",
      "CATALOG_PENDING_SENSE_CONFLICT", "CATALOG_ALREADY_EXISTS",
    ].includes(message)) return response(message, 409);
    if (message.startsWith("CATALOG_PAYLOAD_REJECTED:")) {
      return response("CATALOG_PAYLOAD_REJECTED", 422, { detail: message.slice("CATALOG_PAYLOAD_REJECTED:".length) });
    }
    if ([
      "CATALOG_NO_ENABLED_DIRECTION", "CATALOG_NOT_READY", "CATALOG_SENSE_NOT_FOUND",
      "CATALOG_IDENTITY_MISSING", "CATALOG_APPROVED_REVISION_MISSING", "CATALOG_APPROVED_REVISION_NOT_READY",
      "CATALOG_LEMMA_CHANGE_REQUIRES_NEW_SENSE", "CATALOG_ENTRY_IDENTITY_CONFLICT",
    ].includes(message)) return response(message, 422);
    console.error("[catalog] review failed", error instanceof Error ? { name: error.name } : { name: "UnknownError" });
    return response("CATALOG_REVIEW_FAILED", 500);
  }
}
}

export const PATCH = createCatalogReviewPatch();
