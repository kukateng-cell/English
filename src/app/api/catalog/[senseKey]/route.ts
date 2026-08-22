import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { catalogAccess } from "@/lib/catalog/access";
import { payloadFromRevision, type CatalogGovernancePayload } from "@/lib/catalog/governance";

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

function sourcePayload(value: unknown): CatalogGovernancePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const list = (item: unknown) => Array.isArray(item) ? item.filter((value): value is string => typeof value === "string") : [];
  if (typeof row.term !== "string" || typeof row.lemma !== "string" || typeof row.partOfSpeech !== "string" || typeof row.level !== "string" || typeof row.category !== "string" || typeof row.definitionZh !== "string") return null;
  if (row.level !== "A1" && row.level !== "A2" && row.level !== "B1" && row.level !== "B2") return null;
  return {
    term: row.term,
    lemma: row.lemma,
    partOfSpeech: row.partOfSpeech,
    level: row.level,
    category: row.category,
    definitionZh: row.definitionZh,
    acceptedAnswersZh: list(row.acceptedAnswersZh),
    phoneticIpa: typeof row.phoneticIpa === "string" ? row.phoneticIpa : null,
    exampleEn: typeof row.exampleEn === "string" ? row.exampleEn : null,
    exampleZh: typeof row.exampleZh === "string" ? row.exampleZh : null,
    acceptedFormsEn: list(row.acceptedFormsEn),
    synonymsEn: list(row.synonymsEn),
    antonymsEn: list(row.antonymsEn),
    enableEnToZh: row.enableEnToZh === true,
    distractorZh: list(row.distractorZh),
    enableZhToEn: row.enableZhToEn === true,
    distractorEn: list(row.distractorEn),
    sourceReference: typeof row.sourceReference === "string" ? row.sourceReference : null,
    contributorRef: typeof row.contributorRef === "string" ? row.contributorRef : null,
    changeNote: typeof row.changeNote === "string" ? row.changeNote : null,
    retirementReason: typeof row.retirementReason === "string" ? row.retirementReason : null,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ senseKey: string }> }) {
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return response(auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 401 ? "AUTH_REQUIRED" : "ROLE_FORBIDDEN", auth.status);
  const access = await catalogAccess(auth);
  const { senseKey } = await params;
  try {
    const batch = await prisma.catalogImportBatch.findFirst({ where: { status: "READY" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
    const sourceRow = batch ? await prisma.catalogImportRow.findFirst({ where: { batchId: batch.id, senseKey }, select: { id: true, sourceFile: true, sourceRow: true, catalogKey: true, senseKey: true, issues: true, sourceData: true, primaryDisposition: true, eligibilityResult: true, changeRequests: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, kind: true, status: true, revision: true, payload: true, reason: true, proposerId: true, createdAt: true } } } }) : null;
    const sense = await prisma.wordSense.findUnique({ where: { senseKey }, include: { catalogEntry: { select: { catalogKey: true } }, revisions: { orderBy: { revision: "desc" }, take: 1, select: revisionSelect }, approvedRevision: { select: revisionSelect }, changeRequests: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, kind: true, status: true, revision: true, payload: true, reason: true, proposerId: true, createdAt: true } } } });
    const pendingStandalone = !sourceRow && !sense
      ? await prisma.catalogChangeRequest.findFirst({ where: { senseKey, status: "PENDING", kind: "CREATE", senseId: null, sourceImportRowId: null, ...(access.canReview ? {} : { proposerId: auth.userId }) }, select: { id: true, kind: true, status: true, revision: true, payload: true, reason: true, proposerId: true, createdAt: true, catalogKey: true, senseKey: true } })
      : null;
    if (!sourceRow && !sense && !pendingStandalone) return response("CATALOG_SENSE_NOT_FOUND", 404);
    const latestRevision = sense?.revisions[0];
    const revision = sense?.approvedRevision ?? latestRevision;
    const payload = revision ? payloadFromRevision(revision) : sourcePayload(sourceRow?.sourceData ?? pendingStandalone?.payload);
    const pendingRequest = sense?.changeRequests[0] ?? sourceRow?.changeRequests[0] ?? pendingStandalone;
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
      issues: sourceRow?.issues ?? null,
      payload,
      pendingRequest: pendingRequest ? { ...pendingRequest, createdAt: pendingRequest.createdAt.toISOString() } : null,
    }, { headers: headers() });
  } catch (error) {
    console.error("[catalog] detail failed", error instanceof Error ? { name: error.name } : { name: "UnknownError" });
    return response("CATALOG_READ_FAILED", 500);
  }
}
