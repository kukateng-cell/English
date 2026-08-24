import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  CATALOG_PRIVATE_HEADERS,
  catalogResponse,
  catalogRouteError,
  requireCatalogActor,
} from "@/lib/catalog/api";
import { catalogGovernancePayloadFromUnknown } from "@/lib/catalog/governance";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCatalogActor(req);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const request = await prisma.catalogChangeRequest.findUnique({
      where: { id },
      select: {
        id: true,
        proposerId: true,
        kind: true,
        status: true,
        senseKey: true,
        sourceImportRowId: true,
        payload: true,
        reason: true,
        reviewNote: true,
        submissionProposalGroupId: true,
        supersededBy: { select: { id: true } },
        sense: {
          select: {
            status: true,
            approvedRevision: { select: { revision: true } },
          },
        },
      },
    });
    if (!request) return catalogResponse("CATALOG_REQUEST_NOT_FOUND", 404);
    if (request.proposerId !== auth.actor.userId || request.submissionProposalGroupId) {
      return catalogResponse("CATALOG_REQUEST_RETRY_FORBIDDEN", 403);
    }
    if (request.status !== "REJECTED") return catalogResponse("CATALOG_REQUEST_NOT_RETRYABLE", 409);
    if (request.supersededBy) {
      return catalogResponse("CATALOG_REQUEST_ALREADY_SUPERSEDED", 409, { successorId: request.supersededBy.id });
    }
    const payload = catalogGovernancePayloadFromUnknown(request.payload);
    if (!payload) return catalogResponse("CATALOG_PAYLOAD_INVALID", 422);
    return NextResponse.json({
      retry: {
        supersedesRequestId: request.id,
        kind: request.kind,
        senseKey: request.senseKey,
        sourceRowId: request.sourceImportRowId,
        expectedRevision: request.kind === "CREATE" ? null : request.sense?.approvedRevision?.revision ?? null,
        currentStatus: request.sense?.status ?? "DRAFT",
        payload,
        previousReason: request.reason,
        reviewNote: request.reviewNote,
      },
    }, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) {
    return catalogRouteError(error);
  }
}
