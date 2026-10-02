import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { catalogAccess } from "@/lib/catalog/access";
import { catalogGovernancePayloadFromUnknown, payloadFromRevision } from "@/lib/catalog/governance";
import { catalogPendingRequestForActor } from "@/lib/catalog/pending-visibility";
import { catalogStructuredIssuesFromImportRow } from "@/lib/catalog/workspace-read";
import { CATALOG_STRUCTURED_ISSUE_VERSION } from "@/lib/catalog/validation-issue-contract";

function headers() {
  return { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
}

function response(code: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ code, ...extra }, { status, headers: headers() });
}

const revisionSelect = {
  id: true,
  revision: true,
  term: true,
  lemma: true,
  pos: true,
  level: true,
  category: true,
  definitionZh: true,
  acceptedAnswersZh: true,
  phoneticIpa: true,
  exampleEn: true,
  exampleZh: true,
  acceptedFormsEn: true,
  synonymsEn: true,
  antonymsEn: true,
  enableEnToZh: true,
  distractorZh: true,
  enableZhToEn: true,
  distractorEn: true,
  sourceReference: true,
  contributorRef: true,
  changeNote: true,
  retirementReason: true,
} as const;

export async function GET(_req: Request, { params }: { params: Promise<{ senseKey: string }> }) {
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return response(auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 401 ? "AUTH_REQUIRED" : "ROLE_FORBIDDEN", auth.status);
  const access = await catalogAccess(auth);
  const { senseKey } = await params;
  try {
    const batch = await prisma.catalogImportBatch.findFirst({ where: { status: "READY" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
    const sourceRow = batch ? await prisma.catalogImportRow.findFirst({ where: { batchId: batch.id, senseKey }, select: { id: true, sourceFile: true, sourceRow: true, catalogKey: true, senseKey: true, issues: true, sourceData: true, primaryDisposition: true, eligibilityResult: true, changeRequests: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, kind: true, status: true, revision: true, payload: true, afterPayloadSnapshot: true, reason: true, proposerId: true, createdAt: true } } } }) : null;
    const sense = await prisma.wordSense.findUnique({ where: { senseKey }, include: { catalogEntry: { select: { catalogKey: true } }, revisions: { orderBy: { revision: "desc" }, take: 1, select: revisionSelect }, approvedRevision: { select: revisionSelect }, changeRequests: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, kind: true, status: true, revision: true, payload: true, afterPayloadSnapshot: true, reason: true, proposerId: true, createdAt: true } } } });
    const pendingStandalone = !sourceRow && !sense
      ? await prisma.catalogChangeRequest.findFirst({ where: { senseKey, status: "PENDING", kind: "CREATE", senseId: null, sourceImportRowId: null, ...(access.canReview ? {} : { proposerId: auth.userId }) }, select: { id: true, kind: true, status: true, revision: true, payload: true, afterPayloadSnapshot: true, reason: true, proposerId: true, createdAt: true, catalogKey: true, senseKey: true } })
      : null;
    if (!sourceRow && !sense && !pendingStandalone) return response("CATALOG_SENSE_NOT_FOUND", 404);
    const latestRevision = sense?.revisions[0];
    const revision = sense?.approvedRevision ?? latestRevision;
    const payload = revision ? payloadFromRevision(revision) : catalogGovernancePayloadFromUnknown(sourceRow?.sourceData ?? pendingStandalone?.payload);
    const pendingRequest = sense?.changeRequests[0] ?? sourceRow?.changeRequests[0] ?? pendingStandalone;
    const visiblePendingRequest = catalogPendingRequestForActor(
      pendingRequest,
      auth.userId,
      access.canReview,
    );
    const pendingPayload = visiblePendingRequest && !("restricted" in visiblePendingRequest)
      ? catalogGovernancePayloadFromUnknown(visiblePendingRequest.payload)
        ?? catalogGovernancePayloadFromUnknown(visiblePendingRequest.afterPayloadSnapshot)
        ?? payload
      : null;
    return NextResponse.json({
      id: sourceRow?.id ?? null,
      senseKey,
      catalogKey: sourceRow?.catalogKey ?? sense?.catalogEntry.catalogKey ?? pendingStandalone?.catalogKey ?? null,
      sourceFile: sourceRow?.sourceFile ?? null,
      sourceRow: sourceRow?.sourceRow ?? null,
      status: sense?.status ?? "DRAFT",
      revision: sense?.approvedRevision?.revision ?? latestRevision?.revision ?? null,
      latestRevision: latestRevision?.revision ?? null,
      approvedRevisionId: sense?.approvedRevisionId ?? null,
      hasSense: Boolean(sense),
      primaryDisposition: sourceRow?.primaryDisposition ?? "CREATED_DRAFT",
      eligibilityResult: sourceRow?.eligibilityResult ?? "DRAFT_BLOCKED",
      structuredIssueVersion: CATALOG_STRUCTURED_ISSUE_VERSION,
      structuredIssues: sense?.approvedRevisionId
        ? []
        : catalogStructuredIssuesFromImportRow(sourceRow?.issues, payload),
      payload,
      pendingRequest: visiblePendingRequest
        ? "restricted" in visiblePendingRequest
          ? visiblePendingRequest
          : { ...visiblePendingRequest, payload: pendingPayload, createdAt: visiblePendingRequest.createdAt.toISOString() }
        : null,
    }, { headers: headers() });
  } catch (error) {
    console.error("[catalog] detail failed", error instanceof Error ? { name: error.name } : { name: "UnknownError" });
    return response("CATALOG_READ_FAILED", 500);
  }
}
