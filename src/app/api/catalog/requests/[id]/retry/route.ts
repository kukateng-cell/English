import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  CATALOG_PRIVATE_HEADERS,
  catalogResponse,
  catalogRouteError,
  requireCatalogActor,
} from "@/lib/catalog/api";
import {
  catalogGovernancePayloadFromUnknown,
  payloadFromRevision,
} from "@/lib/catalog/governance";
import { threeWayMergeCatalogPayload } from "@/lib/catalog/retry-merge";
import { evaluateStandaloneRetryEligibility } from "@/lib/catalog/work-items";

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
        beforePayloadSnapshot: true,
        afterPayloadSnapshot: true,
        baseRevision: true,
        reason: true,
        reviewNote: true,
        submissionProposalGroupId: true,
        supersededBy: { select: { id: true } },
      },
    });
    if (!request) return catalogResponse("CATALOG_REQUEST_NOT_FOUND", 404);
    if (request.proposerId !== auth.actor.userId || request.submissionProposalGroupId) {
      return catalogResponse("CATALOG_REQUEST_RETRY_FORBIDDEN", 403);
    }
    if (request.status !== "REJECTED") return catalogResponse("CATALOG_REQUEST_NOT_RETRYABLE", 409);
    if (request.supersededBy) {
      return NextResponse.json({ replay: true, successorId: request.supersededBy.id, senseKey: request.senseKey }, { headers: CATALOG_PRIVATE_HEADERS });
    }
    const currentSense = request.senseKey
      ? await prisma.wordSense.findUnique({
          where: { senseKey: request.senseKey },
          select: {
            status: true,
            approvedRevisionId: true,
            approvedRevision: true,
            revisions: { orderBy: { revision: "desc" }, take: 1 },
          },
        })
      : null;
    const eligibility = evaluateStandaloneRetryEligibility({
      kind: request.kind,
      senseKey: request.senseKey,
      currentIdentity: currentSense,
    });
    if (!eligibility.eligible) {
      return catalogResponse("CATALOG_REQUEST_RETRY_NO_LONGER_APPLICABLE", 409, { reason: eligibility.reason });
    }
    const proposal = catalogGovernancePayloadFromUnknown(request.afterPayloadSnapshot ?? request.payload);
    if (!proposal) return catalogResponse("CATALOG_PAYLOAD_INVALID", 422);
    const currentRevision = request.kind === "RETIRE" || request.kind === "REACTIVATE"
      ? currentSense?.approvedRevision ?? null
      : currentSense?.approvedRevision ?? currentSense?.revisions[0] ?? null;
    let payload = proposal;
    let conflicts: ReturnType<typeof threeWayMergeCatalogPayload>["conflicts"] = [];
    if (request.kind === "UPDATE") {
      const base = catalogGovernancePayloadFromUnknown(request.beforePayloadSnapshot);
      if (!base || !currentRevision) return catalogResponse("CATALOG_REQUEST_RETRY_STALE", 409);
      const merged = threeWayMergeCatalogPayload({
        base,
        proposal,
        current: payloadFromRevision(currentRevision),
      });
      payload = merged.payload;
      conflicts = merged.conflicts;
    } else if (request.kind === "RETIRE" || request.kind === "REACTIVATE") {
      if (!currentRevision) return catalogResponse("CATALOG_REQUEST_RETRY_STALE", 409);
      payload = payloadFromRevision(currentRevision);
    }
    const readyBatch = await prisma.catalogImportBatch.findFirst({
      where: { status: "READY" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const currentSourceRow = readyBatch && request.senseKey
      ? await prisma.catalogImportRow.findFirst({
          where: { batchId: readyBatch.id, senseKey: request.senseKey },
          select: { id: true },
        })
      : null;
    return NextResponse.json({
      replay: false,
      retry: {
        supersedesRequestId: request.id,
        kind: request.kind,
        senseKey: request.senseKey,
        sourceRowId: currentSourceRow?.id ?? null,
        expectedRevision: request.kind === "CREATE" ? null : currentRevision?.revision ?? null,
        currentStatus: currentSense?.status ?? "DRAFT",
        payload,
        conflicts,
        previousReason: request.reason,
        reviewNote: request.reviewNote,
      },
    }, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) {
    return catalogRouteError(error);
  }
}
