import { NextResponse } from "next/server";
import { Prisma, prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { isSameOriginMutation } from "@/lib/csrf";
import { catalogAccess } from "@/lib/catalog/access";
import {
  normalizeCatalogText,
  normalizeCatalogRow,
} from "@/lib/catalog/csv";
import {
  parseCatalogGovernancePayload,
  payloadFromRevision,
  payloadToSourceRow,
  revisionContentDigest,
  validateCatalogGovernancePayload,
  type CatalogGovernancePayload,
} from "@/lib/catalog/governance";
import { isRetryableTransactionConflict } from "@/lib/transaction-retry";

function headers() {
  return { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
}

function response(code: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ code, ...extra }, { status, headers: headers() });
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function projectionData(payload: CatalogGovernancePayload, senseId: string, senseKey: string, revisionId: string, catalogRevisionId: string): Prisma.WordUncheckedCreateInput {
  return {
    id: undefined,
    senseId,
    senseKey,
    contentRevisionId: revisionId,
    catalogRevisionId,
    term: payload.term,
    phonetic: payload.phoneticIpa,
    pos: payload.partOfSpeech,
    definition: payload.definitionZh,
    level: payload.level,
    category: payload.category,
    examples: payload.exampleEn && payload.exampleZh ? jsonValue([{ en: payload.exampleEn, zh: payload.exampleZh }]) : jsonValue([]),
    synonyms: payload.synonymsEn,
    antonyms: payload.antonymsEn,
    acceptedAnswers: payload.acceptedAnswersZh,
    acceptedForms: payload.acceptedFormsEn,
    distractorZh: payload.distractorZh,
    distractorEn: payload.distractorEn,
    enableEnToZh: payload.enableEnToZh,
    enableZhToEn: payload.enableZhToEn,
  };
}

function reviewSummary(request: { id: string; status: string; kind: string; reviewNote: string | null; reviewedAt: Date | null }) {
  return { id: request.id, status: request.status, kind: request.kind, reviewNote: request.reviewNote, reviewedAt: request.reviewedAt?.toISOString() ?? null };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(req)) return response("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return response(auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 401 ? "AUTH_REQUIRED" : "ROLE_FORBIDDEN", auth.status);
  const access = await catalogAccess(auth);
  if (!access.canReview) return response("CATALOG_REVIEW_FORBIDDEN", 403);
  const rawBody = await req.text().catch(() => "");
  if (Buffer.byteLength(rawBody, "utf8") > 32 * 1024) return response("CATALOG_INPUT_TOO_LARGE", 413);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body");
    body = parsed as Record<string, unknown>;
  } catch {
    return response("CATALOG_INPUT_INVALID", 422);
  }
  const decision = body.decision === "APPROVE" || body.decision === "REJECT" ? body.decision : null;
  const expectedRevision = Number(body.expectedRevision);
  const reviewNote = typeof body.reviewNote === "string" ? body.reviewNote.trim() : "";
  const { id } = await params;
  if (!decision || !Number.isInteger(expectedRevision) || expectedRevision < 0 || reviewNote.length > 2000) return response("CATALOG_INPUT_INVALID", 422);
  if (decision === "REJECT" && reviewNote.length < 3) return response("CATALOG_REVIEW_NOTE_REQUIRED", 422);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const request = await tx.catalogChangeRequest.findUnique({
        where: { id },
        include: {
          sense: { include: { catalogEntry: true, revisions: { orderBy: { revision: "desc" }, take: 1 }, approvedRevision: true } },
          sourceImportRow: true,
        },
      });
      if (!request) throw new Error("CATALOG_REQUEST_NOT_FOUND");
      if (request.status !== "PENDING") return { replay: true, request: reviewSummary(request) };
      if (request.revision !== expectedRevision) throw new Error("CATALOG_REQUEST_STALE");
      if (request.proposerId === auth.userId) throw new Error("CATALOG_SELF_REVIEW_FORBIDDEN");
      if (decision === "REJECT") {
        const updated = await tx.catalogChangeRequest.update({ where: { id, revision: expectedRevision, status: "PENDING" }, data: { status: "REJECTED", reviewerId: auth.userId, reviewNote, reviewedAt: new Date(), revision: { increment: 1 } }, select: { id: true, status: true, kind: true, reviewNote: true, reviewedAt: true } });
        await tx.catalogAuditEvent.create({ data: { requestId: id, actorUserId: auth.userId, senseId: request.senseId, action: "REJECTED", fromStatus: "PENDING", toStatus: "REJECTED", revision: request.sense?.revisions[0]?.revision ?? null, metadata: { reviewNote } } });
        return { replay: false, request: reviewSummary(updated) };
      }

      const latest = request.sense?.revisions[0] ?? null;
      const baseRevision = request.sense?.approvedRevision?.revision ?? latest?.revision ?? null;
      if (request.baseRevision !== baseRevision) throw new Error("CATALOG_REVISION_STALE");
      const catalogRevision = await tx.catalogRevision.findFirst({ where: { status: "READY" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      if (!catalogRevision) throw new Error("CATALOG_NOT_READY");
      let approvedSenseId = request.senseId;
      let approvedSenseKey = request.senseKey ?? request.sense?.senseKey ?? request.sourceImportRow?.senseKey ?? null;

      if (request.kind === "RETIRE") {
        if (!request.sense || request.sense.status === "RETIRED") throw new Error("CATALOG_ALREADY_RETIRED");
        if (request.sense.status !== "ACTIVE" || !request.sense.approvedRevisionId) throw new Error("CATALOG_NOT_ACTIVE");
        const updated = await tx.wordSense.update({ where: { id: request.sense.id }, data: { status: "RETIRED", updatedAt: new Date() }, select: { id: true, status: true } });
        await tx.catalogChangeRequest.update({ where: { id, revision: expectedRevision, status: "PENDING" }, data: { status: "APPROVED", reviewerId: auth.userId, reviewNote: reviewNote || null, reviewedAt: new Date(), revision: { increment: 1 } } });
        await tx.catalogAuditEvent.create({ data: { requestId: id, actorUserId: auth.userId, senseId: updated.id, action: "RETIRED", fromStatus: request.sense.status, toStatus: "RETIRED", revision: latest?.revision ?? null, metadata: { reason: request.reason, reviewNote } } });
        return { replay: false, request: { id, status: "APPROVED", kind: request.kind, reviewNote: reviewNote || null, reviewedAt: new Date().toISOString() } };
      }

      if (request.kind === "REACTIVATE") {
        if (!request.sense || request.sense.status !== "RETIRED" || !request.sense.approvedRevisionId) throw new Error("CATALOG_NOT_RETIRED");
        if (!request.sense.approvedRevision) throw new Error("CATALOG_APPROVED_REVISION_MISSING");
        const updated = await tx.wordSense.update({ where: { id: request.sense.id }, data: { status: "ACTIVE", updatedAt: new Date() }, select: { id: true, status: true } });
        const approvedPayload = payloadFromRevision(request.sense.approvedRevision);
        const projection = projectionData(approvedPayload, request.sense.id, request.sense.senseKey, request.sense.approvedRevision.id, catalogRevision.id);
        await tx.word.upsert({ where: { senseId: request.sense.id }, create: projection, update: { ...projection, id: undefined } });
        await tx.catalogChangeRequest.update({ where: { id, revision: expectedRevision, status: "PENDING" }, data: { status: "APPROVED", reviewerId: auth.userId, reviewNote: reviewNote || null, reviewedAt: new Date(), revision: { increment: 1 } } });
        await tx.catalogAuditEvent.create({ data: { requestId: id, actorUserId: auth.userId, senseId: updated.id, action: "REACTIVATED", fromStatus: request.sense.status, toStatus: "ACTIVE", revision: latest?.revision ?? null, metadata: { reviewNote } } });
        return { replay: false, request: { id, status: "APPROVED", kind: request.kind, reviewNote: reviewNote || null, reviewedAt: new Date().toISOString() } };
      }

      let payload: CatalogGovernancePayload;
      let validationWarnings: string[] = [];
      try {
        payload = parseCatalogGovernancePayload(request.payload);
      } catch (error) {
        throw new Error(`CATALOG_PAYLOAD_REJECTED:${error instanceof Error ? error.message : "invalid payload"}`);
      }
      const identity = {
        catalogKey: request.catalogKey ?? request.sourceImportRow?.catalogKey ?? request.sense?.catalogEntry.catalogKey ?? "",
        senseKey: request.senseKey ?? request.sourceImportRow?.senseKey ?? request.sense?.senseKey ?? "",
        sourceFile: request.sourceImportRow?.sourceFile ?? "governance",
        sourceRow: request.sourceImportRow?.sourceRow ?? 0,
      };
      if (!identity.catalogKey || !identity.senseKey) throw new Error("CATALOG_IDENTITY_MISSING");
      const siblings = await tx.wordSense.findMany({ where: { normalizedTerm: normalizeCatalogText(payload.term), ...(request.sense ? { senseKey: { not: request.sense.senseKey } } : {}) }, include: { catalogEntry: { select: { catalogKey: true } }, revisions: { orderBy: { revision: "desc" }, take: 1 }, approvedRevision: true } });
      const siblingRows = siblings.flatMap((sibling) => {
        const siblingRevision = sibling.approvedRevision ?? sibling.revisions[0];
        if (!siblingRevision) return [];
        const siblingPayload = payloadFromRevision(siblingRevision);
        return [normalizeCatalogRow(payloadToSourceRow(siblingPayload, { catalogKey: sibling.catalogEntry.catalogKey, senseKey: sibling.senseKey, sourceFile: "sibling", sourceRow: 0 }, siblingRevision.revision), 0)];
      });
      const validation = validateCatalogGovernancePayload(payload, identity, (latest?.revision ?? 0) + 1, siblingRows);
      if (validation.errors.length) throw new Error(`CATALOG_PAYLOAD_REJECTED:${JSON.stringify(validation.errors)}`);
      validationWarnings = validation.warnings;
      if (!payload.enableEnToZh && !payload.enableZhToEn) throw new Error("CATALOG_NO_ENABLED_DIRECTION");

      if (request.kind === "CREATE") {
        const pendingCreates = await tx.catalogChangeRequest.findMany({ where: { status: "PENDING", kind: "CREATE", id: { not: id } }, select: { senseKey: true, payload: true } });
        const sameSense = (candidate: unknown) => {
          if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
          const value = candidate as Record<string, unknown>;
          const candidateLemma = typeof value.lemma === "string" ? value.lemma : typeof value.term === "string" ? value.term : "";
          const candidateDefinition = typeof value.definitionZh === "string" ? value.definitionZh : "";
          const candidatePos = typeof value.partOfSpeech === "string" ? value.partOfSpeech : typeof value.pos === "string" ? value.pos : "";
          return normalizeCatalogText(candidateLemma) === normalizeCatalogText(payload.lemma)
            && normalizeCatalogText(candidateDefinition) === normalizeCatalogText(payload.definitionZh)
            && normalizeCatalogText(candidatePos) === normalizeCatalogText(payload.partOfSpeech);
        };
        if (pendingCreates.some((candidate) => candidate.senseKey === identity.senseKey || sameSense(candidate.payload))) throw new Error("CATALOG_PENDING_SENSE_CONFLICT");
      }

      if (request.kind === "CREATE") {
        if (request.sense) throw new Error("CATALOG_ALREADY_EXISTS");
        const entry = await tx.catalogEntry.upsert({ where: { catalogKey: identity.catalogKey }, create: { catalogKey: identity.catalogKey, lemma: payload.lemma, normalizedLemma: normalizeCatalogText(payload.lemma) }, update: { lemma: payload.lemma, normalizedLemma: normalizeCatalogText(payload.lemma) } });
        const sense = await tx.wordSense.create({ data: { catalogEntryId: entry.id, senseKey: identity.senseKey, term: payload.term, normalizedTerm: normalizeCatalogText(payload.term), pos: payload.partOfSpeech, level: payload.level, category: payload.category, status: "DRAFT" } });
        approvedSenseId = sense.id;
        approvedSenseKey = sense.senseKey;
        const revision = await tx.wordSenseRevision.create({ data: { senseId: sense.id, revision: 1, term: payload.term, lemma: payload.lemma, pos: payload.partOfSpeech, level: payload.level, category: payload.category, definitionZh: payload.definitionZh, acceptedAnswersZh: payload.acceptedAnswersZh, phoneticIpa: payload.phoneticIpa, exampleEn: payload.exampleEn, exampleZh: payload.exampleZh, acceptedFormsEn: payload.acceptedFormsEn, synonymsEn: payload.synonymsEn, antonymsEn: payload.antonymsEn, enableEnToZh: payload.enableEnToZh, distractorZh: payload.distractorZh, enableZhToEn: payload.enableZhToEn, distractorEn: payload.distractorEn, contentDigest: revisionContentDigest(payload), catalogRevisionId: catalogRevision.id, changeNote: request.reason ?? null } });
        await tx.wordSense.update({ where: { id: sense.id }, data: { status: "ACTIVE", approvedRevisionId: revision.id } });
        await tx.word.create({ data: projectionData(payload, sense.id, sense.senseKey, revision.id, catalogRevision.id) });
      } else {
        if (!request.sense || !latest) throw new Error("CATALOG_SENSE_NOT_FOUND");
        const revision = await tx.wordSenseRevision.create({ data: { senseId: request.sense.id, revision: latest.revision + 1, term: payload.term, lemma: payload.lemma, pos: payload.partOfSpeech, level: payload.level, category: payload.category, definitionZh: payload.definitionZh, acceptedAnswersZh: payload.acceptedAnswersZh, phoneticIpa: payload.phoneticIpa, exampleEn: payload.exampleEn, exampleZh: payload.exampleZh, acceptedFormsEn: payload.acceptedFormsEn, synonymsEn: payload.synonymsEn, antonymsEn: payload.antonymsEn, enableEnToZh: payload.enableEnToZh, distractorZh: payload.distractorZh, enableZhToEn: payload.enableZhToEn, distractorEn: payload.distractorEn, contentDigest: revisionContentDigest(payload), catalogRevisionId: catalogRevision.id, changeNote: request.reason ?? null } });
        const nextStatus = request.sense.status === "RETIRED" ? "RETIRED" : "ACTIVE";
        await tx.wordSense.update({ where: { id: request.sense.id }, data: { term: payload.term, normalizedTerm: normalizeCatalogText(payload.term), pos: payload.partOfSpeech, level: payload.level, category: payload.category, status: nextStatus, approvedRevisionId: revision.id } });
        const projection = projectionData(payload, request.sense.id, request.sense.senseKey, revision.id, catalogRevision.id);
        await tx.word.upsert({ where: { senseId: request.sense.id }, create: projection, update: { ...projection, id: undefined } });
      }

      if (request.sourceImportRowId) {
        await tx.catalogImportRow.update({
          where: { id: request.sourceImportRowId },
          data: { primaryDisposition: "CREATED_DRAFT", eligibilityResult: "LOCAL_ELIGIBLE", issues: { errors: [], warnings: validationWarnings } },
        });
      }

      const updated = await tx.catalogChangeRequest.update({ where: { id, revision: expectedRevision, status: "PENDING" }, data: { senseId: approvedSenseId, status: "APPROVED", reviewerId: auth.userId, reviewNote: reviewNote || null, reviewedAt: new Date(), proposedRevision: request.kind === "CREATE" ? 1 : (latest?.revision ?? 0) + 1, revision: { increment: 1 } }, select: { id: true, status: true, kind: true, reviewNote: true, reviewedAt: true } });
      await tx.catalogAuditEvent.create({ data: { requestId: id, actorUserId: auth.userId, senseId: approvedSenseId, action: "APPROVED", fromStatus: request.baseStatus, toStatus: "ACTIVE", revision: updated.status === "APPROVED" ? (request.kind === "CREATE" ? 1 : (latest?.revision ?? 0) + 1) : null, metadata: { reviewNote, senseKey: approvedSenseKey, sourceIssues: request.sourceImportRow?.issues ?? null } } });
      return { replay: false, request: reviewSummary(updated) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
    return NextResponse.json(result, { headers: headers() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (isRetryableTransactionConflict(error)) return response("CATALOG_REQUEST_STALE", 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return response("CATALOG_REQUEST_STALE", 409);
    if (message === "CATALOG_REQUEST_NOT_FOUND") return response(message, 404);
    if (["CATALOG_REQUEST_STALE", "CATALOG_REVISION_STALE", "CATALOG_SELF_REVIEW_FORBIDDEN", "CATALOG_ALREADY_RETIRED", "CATALOG_NOT_RETIRED", "CATALOG_NOT_ACTIVE", "CATALOG_PENDING_SENSE_CONFLICT", "CATALOG_ALREADY_EXISTS"].includes(message)) return response(message, 409);
    if (message.startsWith("CATALOG_PAYLOAD_REJECTED:")) return response("CATALOG_PAYLOAD_REJECTED", 422, { detail: message.slice("CATALOG_PAYLOAD_REJECTED:".length) });
    if (["CATALOG_NO_ENABLED_DIRECTION", "CATALOG_NOT_READY", "CATALOG_SENSE_NOT_FOUND", "CATALOG_IDENTITY_MISSING", "CATALOG_APPROVED_REVISION_MISSING"].includes(message)) return response(message, 422);
    console.error("[catalog] review failed", error instanceof Error ? { name: error.name } : { name: "UnknownError" });
    return response("CATALOG_REVIEW_FAILED", 500);
  }
}
