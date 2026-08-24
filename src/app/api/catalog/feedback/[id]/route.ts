import { NextResponse } from "next/server";
import { Prisma, prisma } from "@/lib/prisma";
import { isSameOriginMutation } from "@/lib/csrf";
import {
  CATALOG_PRIVATE_HEADERS,
  catalogResponse,
  catalogRouteError,
  parseJsonObject,
  requireCatalogActor,
} from "@/lib/catalog/api";
import { requireCatalogReviewerInTransaction } from "@/lib/catalog/access";
import { canResolveCatalogFeedback, parseCatalogFeedbackResolution } from "@/lib/catalog/feedback";
import { isRetryableTransactionConflict } from "@/lib/transaction-retry";

const MAX_BODY_BYTES = 8 * 1024;

async function readResolutionReplay(input: {
  id: string;
  actorId: string;
  status: "RESOLVED" | "DISMISSED";
  resolutionNote: string;
  expectedRevision: number;
}) {
  const feedback = await prisma.catalogFeedback.findUnique({
    where: { id: input.id },
    select: { id: true, resolverId: true, status: true, revision: true, resolutionNote: true, resolvedAt: true },
  });
  if (
    feedback
    && feedback.resolverId === input.actorId
    && feedback.status === input.status
    && feedback.resolutionNote === input.resolutionNote
    && feedback.revision === input.expectedRevision + 1
  ) {
    return {
      id: feedback.id,
      status: feedback.status,
      revision: feedback.revision,
      resolutionNote: feedback.resolutionNote,
      resolvedAt: feedback.resolvedAt,
    };
  }
  return null;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(req)) return catalogResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireCatalogActor(req, { review: true, rateLimit: true });
  if (!auth.ok) return auth.response;
  try {
    const input = parseCatalogFeedbackResolution(await parseJsonObject(req, MAX_BODY_BYTES));
    const { id } = await params;
    let result: {
      id: string;
      status: string;
      revision: number;
      resolutionNote: string | null;
      resolvedAt: Date | null;
    };
    try {
      result = await prisma.$transaction(async (tx) => {
      await requireCatalogReviewerInTransaction(tx, auth.actor.userId);
      const feedback = await tx.catalogFeedback.findUnique({
        where: { id },
        select: {
          id: true,
          reporterId: true,
          resolverId: true,
          status: true,
          revision: true,
          resolutionNote: true,
          resolvedAt: true,
        },
      });
      if (!feedback) throw new Error("CATALOG_FEEDBACK_NOT_FOUND");
      if (feedback.status !== "OPEN") {
        if (
          feedback.resolverId === auth.actor.userId
          && feedback.status === input.status
          && feedback.resolutionNote === input.resolutionNote
          && feedback.revision === input.expectedRevision + 1
        ) {
          return {
            id: feedback.id,
            status: feedback.status,
            revision: feedback.revision,
            resolutionNote: feedback.resolutionNote,
            resolvedAt: feedback.resolvedAt,
          };
        }
        throw new Error("CATALOG_FEEDBACK_NOT_REVIEWABLE");
      }
      if (!canResolveCatalogFeedback({
        actorId: auth.actor.userId,
        reporterId: feedback.reporterId,
        canReview: true,
        status: feedback.status,
      })) {
        throw new Error(feedback.reporterId === auth.actor.userId
          ? "CATALOG_SELF_REVIEW_FORBIDDEN"
          : "CATALOG_FEEDBACK_NOT_REVIEWABLE");
      }
      if (feedback.revision !== input.expectedRevision) throw new Error("CATALOG_FEEDBACK_STALE");
      const updated = await tx.catalogFeedback.updateMany({
        where: { id, status: "OPEN", revision: input.expectedRevision },
        data: {
          status: input.status,
          resolutionNote: input.resolutionNote,
          resolverId: auth.actor.userId,
          resolvedAt: new Date(),
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error("CATALOG_FEEDBACK_STALE");
      return tx.catalogFeedback.findUniqueOrThrow({
        where: { id },
        select: { id: true, status: true, revision: true, resolutionNote: true, resolvedAt: true },
      });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isRetryableTransactionConflict(error)) throw error;
      const replay = await readResolutionReplay({ id, actorId: auth.actor.userId, ...input });
      if (!replay) throw error;
      result = replay;
    }
    return NextResponse.json({
      feedback: { ...result, resolvedAt: result.resolvedAt?.toISOString() ?? null },
    }, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) {
    return catalogRouteError(error);
  }
}
