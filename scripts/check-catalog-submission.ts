import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma";
import { CATALOG_GOVERNANCE_HEADERS, catalogRowsToCsv, type CatalogSourceRow } from "../src/lib/catalog/csv";
import { revisionContentDigest, type CatalogGovernancePayload } from "../src/lib/catalog/governance";
import { catalogBatchNeedsRevisionWhere } from "../src/lib/catalog/work-items";
import {
  claimCatalogSubmissionBatch,
  cancelCatalogSubmissionBatch,
  createCorrectiveCatalogSubmissionPreview,
  createCatalogSubmissionPreview,
  createRetryCatalogSubmissionPreview,
  finalizeCatalogSubmissionBatch,
  getCatalogSubmissionBatch,
  requestCatalogSubmissionResolution,
  resolveCatalogSubmissionGroup,
  reviewCatalogSubmissionGroup,
  submitCatalogSubmissionBatch,
  transferCatalogSubmissionClaim,
} from "../src/lib/catalog/submission-server";

dotenv.config({ path: ".env.local", override: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const environment = process.env.DATABASE_ENVIRONMENT;
if (!environment || environment === "production" || process.env.CONFIRM_DATABASE_ENVIRONMENT !== environment) {
  throw new Error("check:catalog-submission requires matching non-production DATABASE_ENVIRONMENT and CONFIRM_DATABASE_ENVIRONMENT");
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const catalogKey = `check_catalog_${suffix}`;
const senseKey = `check_sense_${suffix}`;
const CATALOG_CHECKER_FILE_NAME = "__catalog_checker__catalog-governance-check.csv";
const CATALOG_CHECKER_FILE_NAME_PATTERN = /^(?:(?:retry|corrective)-)*(?:__catalog_checker__)?catalog-governance-check\.csv$/u;
let batchId: string | null = null;
let correctiveBatchId: string | null = null;
let secondCorrectiveBatchId: string | null = null;
let createBatchId: string | null = null;
let resolutionBatchId: string | null = null;
let retryBatchId: string | null = null;
let retryRestartBatchId: string | null = null;
let retryExpiredRestartBatchId: string | null = null;
let blockedRetrySourceBatchId: string | null = null;
let pendingRetryBlockerBatchId: string | null = null;
let recoveredRetryBatchId: string | null = null;
let duplicateBatchId: string | null = null;
let draftBatchId: string | null = null;
let conflictUnionBatchId: string | null = null;
let claimRecoveryBatchId: string | null = null;
let authorClaimRecoveryBatchId: string | null = null;
let senseId: string | null = null;
let createSenseId: string | null = null;
const grantIds: string[] = [];
const temporaryActorIds: string[] = [];

const basePayload: CatalogGovernancePayload = {
  term: `checkword${suffix}`,
  lemma: `checkword${suffix}`,
  partOfSpeech: "noun",
  level: "A1",
  category: "other",
  definitionZh: "測試詞",
  acceptedAnswersZh: ["測試詞"],
  phoneticIpa: "/tɛst/",
  exampleEn: "This is a catalog check word.",
  exampleZh: "這是一個詞庫檢查詞。",
  acceptedFormsEn: [],
  synonymsEn: [],
  antonymsEn: [],
  enableEnToZh: true,
  distractorZh: ["測試句", "測試表", "測試頁", "測試組", "測試檔"],
  enableZhToEn: true,
  distractorEn: ["checkline", "checkpage", "checkfile", "checkgroup", "checkform"],
  sourceReference: null,
  contributorRef: null,
  changeNote: "initial DB checker fixture",
  retirementReason: null,
};

function sourceRow(payload: CatalogGovernancePayload, action: "CREATE" | "UPDATE" = "UPDATE"): CatalogSourceRow {
  return {
    sourceFile: "catalog-governance-check.csv", sourceRow: 2,
    schema_version: "word-catalog-v1", requested_action: action,
    catalog_key: action === "UPDATE" ? catalogKey : "", sense_key: action === "UPDATE" ? senseKey : "", record_revision: action === "UPDATE" ? "1" : "", catalog_status: action === "UPDATE" ? "ACTIVE" : "",
    term: payload.term, lemma: payload.lemma, part_of_speech: payload.partOfSpeech,
    level: payload.level, category: payload.category, definition_zh: payload.definitionZh,
    accepted_answers_zh: payload.acceptedAnswersZh.join("|"), prompt_en: "", prompt_zh: "",
    phonetic_ipa: payload.phoneticIpa ?? "", example_en: payload.exampleEn ?? "", example_zh: payload.exampleZh ?? "",
    accepted_forms_en: payload.acceptedFormsEn.join("|"), synonyms_en: payload.synonymsEn.join("|"), antonyms_en: payload.antonymsEn.join("|"),
    enable_en_to_zh: "TRUE", distractor_zh_1: payload.distractorZh[0]!, distractor_zh_2: payload.distractorZh[1]!, distractor_zh_3: payload.distractorZh[2]!, distractor_zh_4: payload.distractorZh[3]!, distractor_zh_5: payload.distractorZh[4]!, distractor_zh_6: "",
    enable_zh_to_en: "TRUE", distractor_en_1: payload.distractorEn[0]!, distractor_en_2: payload.distractorEn[1]!, distractor_en_3: payload.distractorEn[2]!, distractor_en_4: payload.distractorEn[3]!, distractor_en_5: payload.distractorEn[4]!, distractor_en_6: "",
    source_reference: payload.sourceReference ?? "", contributor_ref: payload.contributorRef ?? "", change_note: payload.changeNote ?? "", retirement_reason: "",
  };
}

async function cleanupBatchFixtureLeaf(cleanupBatchId: string) {
    const batch = await prisma.catalogSubmissionBatch.findUnique({ where: { id: cleanupBatchId }, include: { proposalGroups: { include: { changeRequest: true } } } });
    if (!batch) return;
    const requestIds = batch?.proposalGroups.flatMap((group) => group.changeRequest ? [group.changeRequest.id] : []) ?? [];
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.catalog_fixture_cleanup', 'on', true)`;
      await tx.catalogHistoryFeedEntry.deleteMany({ where: { OR: [{ submissionBatchId: cleanupBatchId }, { requestId: { in: requestIds } }] } });
      await tx.catalogAuditEvent.deleteMany({ where: { OR: [{ submissionBatchId: cleanupBatchId }, { requestId: { in: requestIds } }] } });
      await tx.catalogSubmissionOperationReceipt.deleteMany({ where: { batchId: cleanupBatchId } });
      await tx.catalogChangeRequest.deleteMany({ where: { id: { in: requestIds } } });
      await tx.catalogSubmissionRow.deleteMany({ where: { batchId: cleanupBatchId } });
      await tx.catalogSubmissionProposalAuthor.deleteMany({ where: { proposalGroup: { batchId: cleanupBatchId } } });
      await tx.catalogSubmissionProposalGroup.deleteMany({ where: { batchId: cleanupBatchId } });
      await tx.catalogSubmissionBatch.deleteMany({ where: { id: cleanupBatchId } });
    });
}

async function cleanupBatchTree(cleanupBatchId: string, visited = new Set<string>()): Promise<void> {
  if (visited.has(cleanupBatchId)) return;
  visited.add(cleanupBatchId);
  const batch = await prisma.catalogSubmissionBatch.findUnique({
    where: { id: cleanupBatchId },
    select: {
      retriedBy: { select: { id: true } },
      supersededBy: { select: { id: true } },
    },
  });
  if (!batch) return;
  if (batch.retriedBy) await cleanupBatchTree(batch.retriedBy.id, visited);
  for (const child of batch.supersededBy) await cleanupBatchTree(child.id, visited);
  await cleanupBatchFixtureLeaf(cleanupBatchId);
}

async function cleanupSenseFixture(cleanupSenseId: string, force = false) {
  const target = await prisma.wordSense.findUnique({ where: { id: cleanupSenseId }, select: { senseKey: true, catalogEntryId: true } });
  if (!target || (!force && !target.senseKey.startsWith("check_sense_"))) return;
  await prisma.$transaction(async (tx) => {
    await tx.word.deleteMany({ where: { senseId: cleanupSenseId } });
    await tx.wordSense.updateMany({ where: { id: cleanupSenseId }, data: { approvedRevisionId: null, status: "DRAFT" } });
    await tx.wordSenseRevision.deleteMany({ where: { senseId: cleanupSenseId } });
    await tx.wordSense.deleteMany({ where: { id: cleanupSenseId } });
    await tx.catalogEntry.deleteMany({ where: { id: target.catalogEntryId, ...(force ? {} : { catalogKey: { startsWith: "check_catalog_" } }), senses: { none: {} } } });
  });
}

async function cleanupStaleFixtures() {
  const candidates = await prisma.catalogSubmissionBatch.findMany({
    where: { fileName: { endsWith: "catalog-governance-check.csv" } },
    select: { id: true, fileName: true },
  });
  const staleBatches = candidates.filter((batch) => CATALOG_CHECKER_FILE_NAME_PATTERN.test(batch.fileName));
  const visited = new Set<string>();
  for (const stale of staleBatches) await cleanupBatchTree(stale.id, visited);
  const staleSenses = await prisma.wordSense.findMany({ where: { senseKey: { startsWith: "check_sense_" } }, select: { id: true } });
  for (const stale of staleSenses) await cleanupSenseFixture(stale.id);
  await prisma.recentAuthGrant.deleteMany({ where: { id: { startsWith: "catalog-check-grant-" } } });
  await prisma.user.deleteMany({ where: { accountName: { startsWith: "catalog-check-" } } });
}

async function cleanup() {
  const visited = new Set<string>();
  for (const cleanupBatchId of [authorClaimRecoveryBatchId, claimRecoveryBatchId, secondCorrectiveBatchId, correctiveBatchId, duplicateBatchId, recoveredRetryBatchId, pendingRetryBlockerBatchId, blockedRetrySourceBatchId, retryExpiredRestartBatchId, retryRestartBatchId, retryBatchId, resolutionBatchId, createBatchId, batchId, conflictUnionBatchId, draftBatchId].filter((value): value is string => Boolean(value))) {
    await cleanupBatchTree(cleanupBatchId, visited);
  }
  if (senseId) {
    await cleanupSenseFixture(senseId);
  }
  if (createSenseId) await cleanupSenseFixture(createSenseId, true);
  if (grantIds.length) await prisma.recentAuthGrant.deleteMany({ where: { id: { in: grantIds } } });
  if (temporaryActorIds.length) await prisma.user.deleteMany({ where: { id: { in: temporaryActorIds } } });
}

async function main() {
  if (
    !CATALOG_CHECKER_FILE_NAME_PATTERN.test("catalog-governance-check.csv")
    || !CATALOG_CHECKER_FILE_NAME_PATTERN.test("retry-retry-catalog-governance-check.csv")
    || !CATALOG_CHECKER_FILE_NAME_PATTERN.test(CATALOG_CHECKER_FILE_NAME)
    || CATALOG_CHECKER_FILE_NAME_PATTERN.test("my-catalog-governance-check.csv")
  ) {
    throw new Error("catalog checker reserved filename pattern is unsafe");
  }
  const metadata = await prisma.databaseMetadata.findUnique({ where: { key: "environment" }, select: { value: true } });
  if (metadata?.value !== environment) throw new Error("DatabaseMetadata.environment does not match DATABASE_ENVIRONMENT");
  await cleanupStaleFixtures();
  const actors = await prisma.user.findMany({
    where: { status: "ACTIVE", OR: [{ role: "ADMIN" }, { role: "TEACHER", teacherProfile: { canManageWordCatalog: true } }] },
    orderBy: { id: "asc" },
    take: 4,
    select: { id: true, tokenVersion: true, credentialRevision: true },
  });
  while (actors.length < 4) {
    const actor = await prisma.user.create({
      data: {
        accountName: `catalog-check-${suffix}-${actors.length}`,
        passwordHash: "catalog-check-not-a-login-secret",
        role: "ADMIN",
        status: "ACTIVE",
        mustChangePassword: true,
      },
      select: { id: true, tokenVersion: true, credentialRevision: true },
    });
    temporaryActorIds.push(actor.id);
    actors.push(actor);
  }
  const [proposer, reviewer, unclaimedReviewer, competingReviewer] = actors as [typeof actors[number], typeof actors[number], typeof actors[number], typeof actors[number]];
  const revokedReviewerAccount = `catalog-check-revoked-${suffix}`;
  const revokedReviewer = await prisma.user.create({
    data: {
      accountName: revokedReviewerAccount,
      accountNameCanonical: revokedReviewerAccount,
      passwordHash: "catalog-check-not-a-login-secret",
      legacyName: "Catalog revoked reviewer check",
      role: "TEACHER",
      status: "ACTIVE",
      mustChangePassword: true,
      teacherProfile: {
        create: {
          legalName: "Catalog revoked reviewer check",
          canManageWordCatalog: true,
        },
      },
    },
    select: { id: true },
  });
  temporaryActorIds.push(revokedReviewer.id);
  const ready = await prisma.catalogRevision.findFirst({ where: { status: "READY" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (!ready) throw new Error("READY catalog revision missing");
  const entry = await prisma.catalogEntry.create({ data: { catalogKey, lemma: basePayload.lemma, normalizedLemma: basePayload.lemma } });
  const sense = await prisma.wordSense.create({ data: { catalogEntryId: entry.id, senseKey, term: basePayload.term, normalizedTerm: basePayload.term, pos: basePayload.partOfSpeech, level: basePayload.level, category: basePayload.category, status: "DRAFT" } });
  senseId = sense.id;
  const revision = await prisma.wordSenseRevision.create({ data: {
    senseId: sense.id, revision: 1, term: basePayload.term, lemma: basePayload.lemma, pos: basePayload.partOfSpeech,
    level: basePayload.level, category: basePayload.category, definitionZh: basePayload.definitionZh,
    acceptedAnswersZh: basePayload.acceptedAnswersZh, phoneticIpa: basePayload.phoneticIpa, exampleEn: basePayload.exampleEn,
    exampleZh: basePayload.exampleZh, acceptedFormsEn: basePayload.acceptedFormsEn, synonymsEn: [], antonymsEn: [],
    enableEnToZh: true, distractorZh: basePayload.distractorZh, enableZhToEn: true, distractorEn: basePayload.distractorEn,
    contentDigest: revisionContentDigest(basePayload), changeNote: basePayload.changeNote, catalogRevisionId: ready.id,
  } });
  const draftPayload = { ...basePayload, definitionZh: "草稿詞庫測試詞", acceptedAnswersZh: ["草稿詞庫測試詞"] };
  const draftPreview = await createCatalogSubmissionPreview({ actorId: proposer.id, operationId: randomUUID(), fileName: CATALOG_CHECKER_FILE_NAME, bytes: new TextEncoder().encode(catalogRowsToCsv([{ ...sourceRow(draftPayload), catalog_status: "DRAFT" }], CATALOG_GOVERNANCE_HEADERS)) });
  draftBatchId = draftPreview.batch.id;
  if ((draftPreview.batch.groups[0]?.baseProposalPayload as { definitionZh?: string } | null)?.definitionZh !== basePayload.definitionZh) throw new Error("DRAFT target preview omitted the latest revision before payload");
  await prisma.wordSense.update({ where: { id: sense.id }, data: { status: "ACTIVE", approvedRevisionId: revision.id } });
  await prisma.word.create({ data: {
    senseId: sense.id, senseKey, contentRevisionId: revision.id, catalogRevisionId: ready.id, term: basePayload.term,
    phonetic: basePayload.phoneticIpa, pos: basePayload.partOfSpeech, definition: basePayload.definitionZh, level: basePayload.level,
    category: basePayload.category, examples: [{ en: basePayload.exampleEn!, zh: basePayload.exampleZh! }], synonyms: [], antonyms: [],
    acceptedAnswers: basePayload.acceptedAnswersZh, acceptedForms: [], distractorZh: basePayload.distractorZh, distractorEn: basePayload.distractorEn,
    enableEnToZh: true, enableZhToEn: true,
  } });

  const updatedPayload = { ...basePayload, definitionZh: "詞庫測試詞", acceptedAnswersZh: ["詞庫測試詞"], changeNote: "approved DB checker update" };
  const bytes = new TextEncoder().encode(catalogRowsToCsv([sourceRow(updatedPayload)], CATALOG_GOVERNANCE_HEADERS));
  const preview = await createCatalogSubmissionPreview({ actorId: proposer.id, operationId: randomUUID(), fileName: CATALOG_CHECKER_FILE_NAME, bytes });
  batchId = preview.batch.id;
  if (preview.batch.status !== "PREVIEW" || preview.batch.groups.length !== 1) throw new Error("preview contract failed");
  let terminalAttachBlocked = false;
  try {
    await prisma.catalogChangeRequest.create({ data: {
      operationId: randomUUID(), requestFingerprint: `terminal-attach-${suffix}`, kind: "UPDATE", status: "REJECTED",
      senseId: sense.id, senseKey, catalogKey, submissionProposalGroupId: preview.batch.groups[0]!.id,
      proposerId: proposer.id, baseRevision: 1, baseStatus: "ACTIVE", payload: updatedPayload,
    } });
  } catch {
    terminalAttachBlocked = true;
  }
  if (!terminalAttachBlocked) throw new Error("terminal child attach guard was bypassed");
  const submitted = await submitCatalogSubmissionBatch({ batchId, actorId: proposer.id, expectedRevision: preview.batch.revision, operationId: randomUUID(), reason: "database governance check" });
  const submittedBatch = await getCatalogSubmissionBatch({ batchId, actorId: proposer.id, canReview: false });
  const child = submittedBatch.groups[0]?.changeRequest;
  if (!child) throw new Error("submit did not create one child request");
  let bridgeBlocked = false;
  try {
    await prisma.catalogChangeRequest.update({ where: { id: child.id }, data: { status: "REJECTED" } });
  } catch {
    bridgeBlocked = true;
  }
  if (!bridgeBlocked) throw new Error("batch child transition guard was bypassed");
  let payloadBlocked = false;
  try {
    await prisma.catalogSubmissionProposalGroup.update({ where: { id: submittedBatch.groups[0]!.id }, data: { finalProposalPayload: { ...updatedPayload, definitionZh: "tampered" } } });
  } catch {
    payloadBlocked = true;
  }
  if (!payloadBlocked) throw new Error("submitted proposal payload guard was bypassed");
  let retryConflictMetadataBlocked = false;
  try {
    await prisma.catalogSubmissionProposalGroup.update({
      where: { id: submittedBatch.groups[0]!.id },
      data: { retryMergeConflictFields: ["definitionZh"] },
    });
  } catch {
    retryConflictMetadataBlocked = true;
  }
  if (!retryConflictMetadataBlocked) throw new Error("submitted retry conflict metadata guard was bypassed");
  await claimCatalogSubmissionBatch({ batchId, actorId: reviewer.id, expectedRevision: submitted.patch.revision, release: false });
  const claimed = await getCatalogSubmissionBatch({ batchId, actorId: reviewer.id, canReview: true });
  let acknowledgementRequired = false;
  try {
    await reviewCatalogSubmissionGroup({ batchId, groupId: claimed.groups[0]!.id, actorId: reviewer.id, expectedBatchRevision: claimed.revision, expectedGroupRevision: claimed.groups[0]!.revision, decision: "APPROVE", reviewNote: "missing acknowledgement" });
  } catch (error) {
    acknowledgementRequired = error instanceof Error && error.message === "CATALOG_REVIEW_ACKNOWLEDGEMENT_REQUIRED";
  }
  if (!acknowledgementRequired) throw new Error("review acknowledgement guard was bypassed");
  const reviewed = await reviewCatalogSubmissionGroup({ batchId, groupId: claimed.groups[0]!.id, actorId: reviewer.id, expectedBatchRevision: claimed.revision, expectedGroupRevision: claimed.groups[0]!.revision, decision: "APPROVE", reviewNote: "database check approved", acknowledgedPayloadDigest: claimed.groups[0]!.payloadDigest });
  if (reviewed.patch.batch.status !== "REVIEWED") throw new Error("review did not reach REVIEWED");
  const reauthenticatedAt = new Date();
  const expiresAt = new Date(reauthenticatedAt.getTime() + 15 * 60_000);
  const wrongGrantId = `catalog-check-grant-wrong-${suffix}`;
  grantIds.push(wrongGrantId);
  await prisma.recentAuthGrant.create({ data: { id: wrongGrantId, userId: unclaimedReviewer.id, tokenVersion: unclaimedReviewer.tokenVersion, credentialRevision: unclaimedReviewer.credentialRevision, reauthenticatedAt, expiresAt } });
  let finalizerClaimRequired = false;
  try {
    await finalizeCatalogSubmissionBatch({ batchId, actorId: unclaimedReviewer.id, expectedRevision: reviewed.patch.revision, operationId: randomUUID(), recentAuth: { grantId: wrongGrantId, tokenVersion: unclaimedReviewer.tokenVersion, credentialRevision: unclaimedReviewer.credentialRevision, reauthenticatedAt, expiresAt } });
  } catch (error) {
    finalizerClaimRequired = error instanceof Error && error.message === "CATALOG_REVIEW_CLAIM_REQUIRED";
  }
  if (!finalizerClaimRequired) throw new Error("finalizer claim guard was bypassed");
  const grantId = `catalog-check-grant-${suffix}`;
  grantIds.push(grantId);
  await prisma.recentAuthGrant.create({ data: { id: grantId, userId: reviewer.id, tokenVersion: reviewer.tokenVersion, credentialRevision: reviewer.credentialRevision, reauthenticatedAt, expiresAt } });
  const finalized = await finalizeCatalogSubmissionBatch({ batchId, actorId: reviewer.id, expectedRevision: reviewed.patch.revision, operationId: randomUUID(), recentAuth: { grantId, tokenVersion: reviewer.tokenVersion, credentialRevision: reviewer.credentialRevision, reauthenticatedAt, expiresAt } });
  const finalizedBatch = await getCatalogSubmissionBatch({ batchId, actorId: reviewer.id, canReview: true });
  if (finalized.patch.batch.status !== "COMMITTED" || finalizedBatch.groups[0]?.changeRequest?.status !== "APPROVED") throw new Error("finalize did not atomically commit");
  const finalizedRequest = await prisma.catalogChangeRequest.findUnique({ where: { id: child.id }, select: { beforePayloadSnapshot: true, afterPayloadSnapshot: true } });
  if (!finalizedRequest?.beforePayloadSnapshot || !finalizedRequest.afterPayloadSnapshot) throw new Error("complete history payload snapshots are missing");
  const history = await prisma.catalogHistoryFeedEntry.count({ where: { submissionBatchId: batchId } });
  if (history !== 1) throw new Error("batch history feed entry missing");
  const approvedAfterFinalize = await prisma.wordSense.findUniqueOrThrow({
    where: { id: sense.id },
    select: { approvedRevision: { select: { revision: true } } },
  });
  const blockedRetryPayload: CatalogGovernancePayload = {
    ...updatedPayload,
    definitionZh: "被 pending 修改暫時阻擋的 retry",
    acceptedAnswersZh: ["被 pending 修改暫時阻擋的 retry"],
  };
  const blockedRetrySourcePreview = await createCatalogSubmissionPreview({
    actorId: proposer.id,
    operationId: randomUUID(),
    fileName: CATALOG_CHECKER_FILE_NAME,
    bytes: new TextEncoder().encode(catalogRowsToCsv([{
      ...sourceRow(blockedRetryPayload),
      record_revision: String(approvedAfterFinalize.approvedRevision!.revision),
    }], CATALOG_GOVERNANCE_HEADERS)),
  });
  blockedRetrySourceBatchId = blockedRetrySourcePreview.batch.id;
  const blockedRetrySubmitted = await submitCatalogSubmissionBatch({
    batchId: blockedRetrySourceBatchId,
    actorId: proposer.id,
    expectedRevision: blockedRetrySourcePreview.batch.revision,
    operationId: randomUUID(),
    reason: "prepare stale retry source for pending blocker regression",
  });
  await claimCatalogSubmissionBatch({
    batchId: blockedRetrySourceBatchId,
    actorId: reviewer.id,
    expectedRevision: blockedRetrySubmitted.patch.revision,
    release: false,
  });
  const blockedRetryClaimed = await getCatalogSubmissionBatch({ batchId: blockedRetrySourceBatchId, actorId: reviewer.id, canReview: true });
  await requestCatalogSubmissionResolution({
    batchId: blockedRetrySourceBatchId,
    groupId: blockedRetryClaimed.groups[0]!.id,
    actorId: reviewer.id,
    expectedBatchRevision: blockedRetryClaimed.revision,
    expectedGroupRevision: blockedRetryClaimed.groups[0]!.revision,
    reason: "make source retryable before introducing a pending blocker",
  });

  const pendingBlockerPayload: CatalogGovernancePayload = {
    ...updatedPayload,
    exampleEn: "A pending request temporarily blocks creation of a retry successor.",
  };
  const pendingBlockerPreview = await createCatalogSubmissionPreview({
    actorId: proposer.id,
    operationId: randomUUID(),
    fileName: CATALOG_CHECKER_FILE_NAME,
    bytes: new TextEncoder().encode(catalogRowsToCsv([{
      ...sourceRow(pendingBlockerPayload),
      record_revision: String(approvedAfterFinalize.approvedRevision!.revision),
    }], CATALOG_GOVERNANCE_HEADERS)),
  });
  pendingRetryBlockerBatchId = pendingBlockerPreview.batch.id;
  const pendingBlockerSubmitted = await submitCatalogSubmissionBatch({
    batchId: pendingRetryBlockerBatchId,
    actorId: proposer.id,
    expectedRevision: pendingBlockerPreview.batch.revision,
    operationId: randomUUID(),
    reason: "hold a pending request against the retry target",
  });
  const blockedSourceActionable = await prisma.catalogSubmissionBatch.count({
    where: { AND: [{ id: blockedRetrySourceBatchId }, catalogBatchNeedsRevisionWhere(proposer.id)] },
  });
  if (blockedSourceActionable !== 0) throw new Error("pending target did not hide the blocked retry source from work items");
  let retryBlockedRows: Array<{ rowNumber: number; errors: string[] }> | null = null;
  try {
    await createRetryCatalogSubmissionPreview({
      sourceBatchId: blockedRetrySourceBatchId,
      actorId: proposer.id,
      operationId: randomUUID(),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CATALOG_BATCH_RETRY_BLOCKED" && "rows" in error) {
      retryBlockedRows = error.rows as Array<{ rowNumber: number; errors: string[] }>;
    }
  }
  if (!retryBlockedRows?.some((row) => row.errors.includes("UPDATE target already has a pending request"))) {
    throw new Error("retry preview did not report its pending target blocker");
  }
  const blockedSourceAfterFailure = await prisma.catalogSubmissionBatch.findUniqueOrThrow({
    where: { id: blockedRetrySourceBatchId },
    select: { retriedBy: { select: { id: true } } },
  });
  if (blockedSourceAfterFailure.retriedBy) throw new Error("blocked retry created an unusable successor");

  await claimCatalogSubmissionBatch({
    batchId: pendingRetryBlockerBatchId,
    actorId: reviewer.id,
    expectedRevision: pendingBlockerSubmitted.patch.revision,
    release: false,
  });
  const pendingBlockerClaimed = await getCatalogSubmissionBatch({ batchId: pendingRetryBlockerBatchId, actorId: reviewer.id, canReview: true });
  await requestCatalogSubmissionResolution({
    batchId: pendingRetryBlockerBatchId,
    groupId: pendingBlockerClaimed.groups[0]!.id,
    actorId: reviewer.id,
    expectedBatchRevision: pendingBlockerClaimed.revision,
    expectedGroupRevision: pendingBlockerClaimed.groups[0]!.revision,
    reason: "release pending blocker after retry regression",
  });
  const unblockedSourceActionable = await prisma.catalogSubmissionBatch.count({
    where: { AND: [{ id: blockedRetrySourceBatchId }, catalogBatchNeedsRevisionWhere(proposer.id)] },
  });
  if (unblockedSourceActionable !== 1) throw new Error("retry source did not become actionable after pending blocker finished");
  const recoveredRetry = await createRetryCatalogSubmissionPreview({
    sourceBatchId: blockedRetrySourceBatchId,
    actorId: proposer.id,
    operationId: randomUUID(),
  });
  recoveredRetryBatchId = recoveredRetry.batch.id;
  if (recoveredRetry.batch.retryOfBatchId !== blockedRetrySourceBatchId || recoveredRetry.batch.groups.length !== 1) {
    throw new Error("retry source did not create a valid successor after pending blocker finished");
  }
  const conflictUnionPayload: CatalogGovernancePayload = {
    ...updatedPayload,
    definitionZh: "多行衝突合併測試詞",
    acceptedAnswersZh: ["多行衝突合併測試詞"],
    exampleEn: "Two retry rows preserve every unresolved conflict field.",
    exampleZh: "兩個重試資料列會保留所有未解決衝突欄位。",
  };
  const conflictUnionRows = [2, 3].map((rowNumber) => ({
    ...sourceRow(conflictUnionPayload),
    sourceRow: rowNumber,
    record_revision: String(approvedAfterFinalize.approvedRevision!.revision),
  }));
  const conflictUnionPreview = await createCatalogSubmissionPreview({
    actorId: proposer.id,
    operationId: randomUUID(),
    fileName: CATALOG_CHECKER_FILE_NAME,
    bytes: new TextEncoder().encode(catalogRowsToCsv(conflictUnionRows, CATALOG_GOVERNANCE_HEADERS)),
    retryMergeConflicts: new Map([
      [2, ["definitionZh"]],
      [3, ["exampleEn"]],
    ]),
  });
  conflictUnionBatchId = conflictUnionPreview.batch.id;
  if (
    conflictUnionPreview.batch.groups.length !== 1
    || conflictUnionPreview.batch.status !== "NEEDS_RESOLUTION"
    || JSON.stringify(conflictUnionPreview.batch.groups[0]?.retryMergeConflictFields) !== JSON.stringify(["definitionZh", "exampleEn"])
  ) {
    throw new Error("multi-row retry conflicts were not unioned on the proposal group");
  }
  const corrective = await createCorrectiveCatalogSubmissionPreview({ sourceBatchId: batchId, actorId: reviewer.id, operationId: randomUUID() });
  correctiveBatchId = corrective.batch.id;
  if (corrective.batch.status !== "PREVIEW" || corrective.batch.supersedesBatchId !== batchId || corrective.batch.groups[0]?.requestedAction !== "UPDATE") throw new Error("corrective preview contract failed");
  const correctivePayload = corrective.batch.groups[0]?.finalProposalPayload as { definitionZh?: string } | undefined;
  if (correctivePayload?.definitionZh !== basePayload.definitionZh) throw new Error("corrective preview did not restore the previous payload");
  await cancelCatalogSubmissionBatch({
    batchId: corrective.batch.id,
    actorId: reviewer.id,
    expectedRevision: corrective.batch.revision,
  });
  const secondCorrective = await createCorrectiveCatalogSubmissionPreview({ sourceBatchId: batchId, actorId: reviewer.id, operationId: randomUUID() });
  secondCorrectiveBatchId = secondCorrective.batch.id;
  if (secondCorrective.batch.supersedesBatchId !== batchId) throw new Error("cancelled corrective preview permanently blocked a later corrective preview");

  const createPayload: CatalogGovernancePayload = { ...basePayload, term: `checkcreate${suffix}`, lemma: `checkcreate${suffix}`, definitionZh: "新增測試詞", acceptedAnswersZh: ["新增測試詞"], exampleEn: "This is a newly created catalog check word.", exampleZh: "這是一個新增詞庫檢查詞。" };
  const createPreview = await createCatalogSubmissionPreview({ actorId: proposer.id, operationId: randomUUID(), fileName: CATALOG_CHECKER_FILE_NAME, bytes: new TextEncoder().encode(catalogRowsToCsv([sourceRow(createPayload, "CREATE")], CATALOG_GOVERNANCE_HEADERS)) });
  createBatchId = createPreview.batch.id;
  const createSubmitted = await submitCatalogSubmissionBatch({ batchId: createBatchId, actorId: proposer.id, expectedRevision: createPreview.batch.revision, operationId: randomUUID(), reason: "CREATE database governance check" });

  const resolutionPayload: CatalogGovernancePayload = { ...basePayload, term: `checkresolution${suffix}`, lemma: `checkresolution${suffix}`, definitionZh: "修正流程測試詞", acceptedAnswersZh: ["修正流程測試詞"], exampleEn: "This word checks the resolution workflow.", exampleZh: "這個詞檢查修正流程。" };
  const resolutionPreview = await createCatalogSubmissionPreview({ actorId: proposer.id, operationId: randomUUID(), fileName: CATALOG_CHECKER_FILE_NAME, bytes: new TextEncoder().encode(catalogRowsToCsv([sourceRow(resolutionPayload, "CREATE")], CATALOG_GOVERNANCE_HEADERS)) });
  resolutionBatchId = resolutionPreview.batch.id;

  const createRow = await prisma.catalogSubmissionRow.findFirstOrThrow({ where: { batchId: createBatchId, proposalGroupId: { not: null } }, select: { id: true } });
  const createAuthor = await prisma.catalogSubmissionProposalAuthor.findFirstOrThrow({ where: { proposalGroup: { batchId: createBatchId } }, select: { id: true } });
  let rowReparentBlocked = false;
  try { await prisma.catalogSubmissionRow.update({ where: { id: createRow.id }, data: { batchId: resolutionBatchId, proposalGroupId: resolutionPreview.batch.groups[0]!.id } }); } catch { rowReparentBlocked = true; }
  if (!rowReparentBlocked) throw new Error("submitted row re-parent guard was bypassed");
  let authorReparentBlocked = false;
  try { await prisma.catalogSubmissionProposalAuthor.update({ where: { id: createAuthor.id }, data: { proposalGroupId: resolutionPreview.batch.groups[0]!.id } }); } catch { authorReparentBlocked = true; }
  if (!authorReparentBlocked) throw new Error("submitted author re-parent guard was bypassed");

  await claimCatalogSubmissionBatch({ batchId: createBatchId, actorId: reviewer.id, expectedRevision: createSubmitted.patch.revision, release: false });
  const createClaimed = await getCatalogSubmissionBatch({ batchId: createBatchId, actorId: reviewer.id, canReview: true });
  const createReviewed = await reviewCatalogSubmissionGroup({ batchId: createBatchId, groupId: createClaimed.groups[0]!.id, actorId: reviewer.id, expectedBatchRevision: createClaimed.revision, expectedGroupRevision: createClaimed.groups[0]!.revision, decision: "APPROVE", reviewNote: "CREATE check approved", acknowledgedPayloadDigest: createClaimed.groups[0]!.payloadDigest });
  const createFinalized = await finalizeCatalogSubmissionBatch({ batchId: createBatchId, actorId: reviewer.id, expectedRevision: createReviewed.patch.revision, operationId: randomUUID(), recentAuth: { grantId, tokenVersion: reviewer.tokenVersion, credentialRevision: reviewer.credentialRevision, reauthenticatedAt, expiresAt } });
  const createFinalizedBatch = await getCatalogSubmissionBatch({ batchId: createBatchId, actorId: reviewer.id, canReview: true });
  createSenseId = createFinalizedBatch.groups[0]?.changeRequest?.resultRevisionId ? (await prisma.catalogChangeRequest.findUniqueOrThrow({ where: { id: createFinalizedBatch.groups[0]!.changeRequest!.id }, select: { senseId: true } })).senseId : null;
  if (createFinalized.patch.batch.status !== "COMMITTED" || !createSenseId) throw new Error("batch CREATE did not atomically bind and commit the new sense");
  let terminalReopenBlocked = false;
  try { await prisma.catalogSubmissionBatch.update({ where: { id: createBatchId }, data: { status: "PREVIEW" } }); } catch { terminalReopenBlocked = true; }
  if (!terminalReopenBlocked) throw new Error("terminal batch lifecycle guard was bypassed");

  const resolutionSubmitted = await submitCatalogSubmissionBatch({ batchId: resolutionBatchId, actorId: proposer.id, expectedRevision: resolutionPreview.batch.revision, operationId: randomUUID(), reason: "resolution request database check" });
  await claimCatalogSubmissionBatch({ batchId: resolutionBatchId, actorId: reviewer.id, expectedRevision: resolutionSubmitted.patch.revision, release: false });
  const resolutionClaimed = await getCatalogSubmissionBatch({ batchId: resolutionBatchId, actorId: reviewer.id, canReview: true });
  const resolutionStale = await requestCatalogSubmissionResolution({ batchId: resolutionBatchId, groupId: resolutionClaimed.groups[0]!.id, actorId: reviewer.id, expectedBatchRevision: resolutionClaimed.revision, expectedGroupRevision: resolutionClaimed.groups[0]!.revision, reason: "needs content correction" });
  const resolutionStaleBatch = await getCatalogSubmissionBatch({ batchId: resolutionBatchId, actorId: reviewer.id, canReview: true });
  if (resolutionStale.batch.status !== "STALE" || resolutionStaleBatch.groups[0]!.resolution !== resolutionClaimed.groups[0]!.resolution) throw new Error("request-resolution did not preserve submitted payload and stale the batch");
  const retryOperationId = randomUUID();
  const retryResults = await Promise.all([
    createRetryCatalogSubmissionPreview({ sourceBatchId: resolutionBatchId, actorId: proposer.id, operationId: retryOperationId }),
    createRetryCatalogSubmissionPreview({ sourceBatchId: resolutionBatchId, actorId: proposer.id, operationId: retryOperationId }),
  ]);
  const retryPreview = retryResults[0]!;
  if (retryResults.filter((result) => result.replay).length !== 1 || retryResults[0]!.batch.id !== retryResults[1]!.batch.id) {
    throw new Error("concurrent retry idempotency did not replay the committed successor");
  }
  retryBatchId = retryPreview.batch.id;
  if (retryPreview.batch.status !== "PREVIEW" || retryPreview.batch.retryOfBatchId !== resolutionBatchId || retryPreview.batch.groups.length !== resolutionStaleBatch.groups.length) {
    throw new Error(`request-resolution retry preview did not preserve immutable lineage: ${JSON.stringify({ status: retryPreview.batch.status, retryOfBatchId: retryPreview.batch.retryOfBatchId, expectedBatchId: resolutionBatchId, groups: retryPreview.batch.groups.length, expectedGroups: resolutionStaleBatch.groups.length, rows: retryPreview.batch.rows })}`);
  }
  if ((retryPreview.batch.groups[0]?.finalProposalPayload as { definitionZh?: string } | undefined)?.definitionZh !== resolutionPayload.definitionZh) {
    throw new Error("request-resolution retry preview did not preserve the proposed payload");
  }
  const retryConflictGroup = retryPreview.batch.groups[0];
  if (!retryConflictGroup) throw new Error("retry conflict fixture group is missing");
  await prisma.$transaction([
    prisma.catalogSubmissionProposalGroup.update({
      where: { id: retryConflictGroup.id },
      data: {
        resolution: null,
        resolutionReason: "retry merge conflict: definitionZh",
        retryMergeConflictFields: ["definitionZh"],
        revision: { increment: 1 },
      },
    }),
    prisma.catalogSubmissionBatch.update({
      where: { id: retryPreview.batch.id },
      data: { status: "NEEDS_RESOLUTION", revision: { increment: 1 } },
    }),
  ]);
  const conflictRetry = await getCatalogSubmissionBatch({ batchId: retryPreview.batch.id, actorId: proposer.id, canReview: false });
  if (
    conflictRetry.status !== "NEEDS_RESOLUTION"
    || !Array.isArray(conflictRetry.groups[0]?.retryMergeConflictFields)
    || conflictRetry.groups[0]?.retryMergeConflictFields[0] !== "definitionZh"
  ) {
    throw new Error("retry merge conflict metadata was not persisted");
  }
  const escalatedConflict = await resolveCatalogSubmissionGroup({
    batchId: retryPreview.batch.id,
    groupId: conflictRetry.groups[0]!.id,
    actorId: proposer.id,
    canReview: false,
    expectedBatchRevision: conflictRetry.revision,
    expectedGroupRevision: conflictRetry.groups[0]!.revision,
    resolution: "ESCALATE",
    reason: "preserve unresolved retry conflict for reviewer escalation",
  });
  if (
    escalatedConflict.batch.status !== "NEEDS_RESOLUTION"
    || escalatedConflict.group?.value.resolution !== "ESCALATE"
    || JSON.stringify(escalatedConflict.group.value.retryMergeConflictFields) !== JSON.stringify(["definitionZh"])
  ) {
    throw new Error("escalating a retry conflict cleared its unresolved metadata");
  }
  const staleSourceStillActionable = await prisma.catalogSubmissionBatch.count({
    where: { id: resolutionBatchId, status: { in: ["STALE", "REJECTED"] }, retriedBy: null },
  });
  if (staleSourceStillActionable !== 0) throw new Error("retried source remained actionable after successor creation");
  const duplicateRetry = await createRetryCatalogSubmissionPreview({ sourceBatchId: resolutionBatchId, actorId: proposer.id, operationId: randomUUID() });
  const duplicateRetryReplayed = duplicateRetry.replay && duplicateRetry.batch.id === retryPreview.batch.id;
  if (!duplicateRetryReplayed) throw new Error("request-resolution source did not replay the existing retry successor");
  const cancelledRetry = await cancelCatalogSubmissionBatch({
    batchId: retryPreview.batch.id,
    actorId: proposer.id,
    expectedRevision: escalatedConflict.revision,
  });
  if (cancelledRetry.batch.status !== "CANCELLED") throw new Error("retry preview cancellation failed");
  const cancelledRetryActionable = await prisma.catalogSubmissionBatch.count({
    where: { AND: [{ id: retryPreview.batch.id }, catalogBatchNeedsRevisionWhere(proposer.id)] },
  });
  if (cancelledRetryActionable !== 1) throw new Error("cancelled retry successor did not return to the revision work queue");
  const restartOperationId = randomUUID();
  const restartedResults = await Promise.all([
    createRetryCatalogSubmissionPreview({ sourceBatchId: retryPreview.batch.id, actorId: proposer.id, operationId: restartOperationId }),
    createRetryCatalogSubmissionPreview({ sourceBatchId: retryPreview.batch.id, actorId: proposer.id, operationId: restartOperationId }),
  ]);
  retryRestartBatchId = restartedResults[0]!.batch.id;
  if (
    restartedResults.filter((result) => result.replay).length !== 1
    || restartedResults[0]!.batch.id !== restartedResults[1]!.batch.id
    || restartedResults[0]!.batch.retryOfBatchId !== retryPreview.batch.id
  ) {
    throw new Error("cancelled retry did not create exactly one next-generation successor");
  }
  if (
    restartedResults[0]!.batch.status !== "NEEDS_RESOLUTION"
    || restartedResults[0]!.batch.groups[0]?.resolution !== null
    || !Array.isArray(restartedResults[0]!.batch.groups[0]?.retryMergeConflictFields)
    || restartedResults[0]!.batch.groups[0]?.retryMergeConflictFields[0] !== "definitionZh"
  ) {
    throw new Error("cancelled retry lost unresolved merge conflict metadata");
  }
  let unresolvedRetrySubmitted = false;
  try {
    await submitCatalogSubmissionBatch({
      batchId: retryRestartBatchId,
      actorId: proposer.id,
      expectedRevision: restartedResults[0]!.batch.revision,
      operationId: randomUUID(),
      reason: "unresolved conflict must not submit",
    });
  } catch (error) {
    unresolvedRetrySubmitted = error instanceof Error && error.message === "CATALOG_BATCH_NEEDS_RESOLUTION";
  }
  if (!unresolvedRetrySubmitted) throw new Error("unresolved retry merge conflict was submit-able");
  await prisma.$transaction(async (tx) => {
    await tx.catalogSubmissionBatch.update({
      where: { id: retryRestartBatchId! },
      data: { status: "FINALIZING", revision: { increment: 1 } },
    });
    await tx.catalogSubmissionBatch.update({
      where: { id: retryRestartBatchId! },
      data: { status: "EXPIRED", revision: { increment: 1 } },
    });
  });
  const expiredRestart = await createRetryCatalogSubmissionPreview({
    sourceBatchId: retryRestartBatchId,
    actorId: proposer.id,
    operationId: randomUUID(),
  });
  retryExpiredRestartBatchId = expiredRestart.batch.id;
  if (
    expiredRestart.batch.status !== "NEEDS_RESOLUTION"
    || expiredRestart.batch.retryOfBatchId !== retryRestartBatchId
    || expiredRestart.batch.groups[0]?.resolution !== null
    || !Array.isArray(expiredRestart.batch.groups[0]?.retryMergeConflictFields)
    || expiredRestart.batch.groups[0]?.retryMergeConflictFields[0] !== "definitionZh"
  ) {
    throw new Error("expired retry lost unresolved merge conflict metadata");
  }
  const resolvedExpiredRestart = await resolveCatalogSubmissionGroup({
    batchId: expiredRestart.batch.id,
    groupId: expiredRestart.batch.groups[0]!.id,
    actorId: proposer.id,
    canReview: false,
    expectedBatchRevision: expiredRestart.batch.revision,
    expectedGroupRevision: expiredRestart.batch.groups[0]!.revision,
    resolution: "KEEP_SEPARATE",
    reason: "explicitly resolve inherited retry merge conflict",
  });
  if (
    resolvedExpiredRestart.batch.status !== "PREVIEW"
    || resolvedExpiredRestart.group?.value.retryMergeConflictFields !== null
  ) {
    throw new Error("completed retry resolution did not clear conflict metadata");
  }
  const restartedSourceStillActionable = await prisma.catalogSubmissionBatch.count({
    where: { AND: [{ id: retryPreview.batch.id }, catalogBatchNeedsRevisionWhere(proposer.id)] },
  });
  if (restartedSourceStillActionable !== 0) throw new Error("restarted retry source remained actionable after successor creation");

  const retryTreeIds = [resolutionBatchId, retryBatchId, retryRestartBatchId, retryExpiredRestartBatchId];
  await cleanupBatchTree(resolutionBatchId);
  const retryTreeRemainder = await prisma.catalogSubmissionBatch.count({ where: { id: { in: retryTreeIds } } });
  if (retryTreeRemainder !== 0) throw new Error("recursive retry lineage cleanup left descendant batches behind");
  resolutionBatchId = null;
  retryBatchId = null;
  retryRestartBatchId = null;
  retryExpiredRestartBatchId = null;

  const duplicateBase: CatalogGovernancePayload = { ...basePayload, term: `checkduplicate${suffix}`, lemma: `checkduplicate${suffix}`, definitionZh: "重複來源測試詞", acceptedAnswersZh: ["重複來源測試詞"], exampleEn: "This is source row two.", exampleZh: "這是來源第二行。" };
  const duplicateAlternative: CatalogGovernancePayload = { ...duplicateBase, exampleEn: "This is source row three.", exampleZh: "這是來源第三行。" };
  const duplicateRows = [{ ...sourceRow(duplicateBase, "CREATE"), sourceRow: 2 }, { ...sourceRow(duplicateAlternative, "CREATE"), sourceRow: 3 }];
  const duplicatePreview = await createCatalogSubmissionPreview({ actorId: proposer.id, operationId: randomUUID(), fileName: CATALOG_CHECKER_FILE_NAME, bytes: new TextEncoder().encode(catalogRowsToCsv(duplicateRows, CATALOG_GOVERNANCE_HEADERS)) });
  duplicateBatchId = duplicatePreview.batch.id;
  if (duplicatePreview.batch.status !== "NEEDS_RESOLUTION" || duplicatePreview.batch.groups[0]?.sourceRows.length !== 2) throw new Error("different duplicate rows did not require explicit resolution");
  let sourceSelectionRequired = false;
  try {
    await resolveCatalogSubmissionGroup({ batchId: duplicateBatchId, groupId: duplicatePreview.batch.groups[0]!.id, actorId: proposer.id, canReview: false, expectedBatchRevision: duplicatePreview.batch.revision, expectedGroupRevision: duplicatePreview.batch.groups[0]!.revision, resolution: "MERGE", reason: "select source", payload: duplicateBase });
  } catch (error) {
    sourceSelectionRequired = error instanceof Error && error.message === "CATALOG_SOURCE_SELECTION_REQUIRED";
  }
  if (!sourceSelectionRequired) throw new Error("different duplicate rows could merge without explicit source acknowledgement");
  const duplicateResolved = await resolveCatalogSubmissionGroup({ batchId: duplicateBatchId, groupId: duplicatePreview.batch.groups[0]!.id, actorId: proposer.id, canReview: false, expectedBatchRevision: duplicatePreview.batch.revision, expectedGroupRevision: duplicatePreview.batch.groups[0]!.revision, resolution: "MERGE", reason: "adopt row three", sourceSelectionMode: "SOURCE_ROW", selectedSourceRowNumber: 3, acknowledgedSourceSetDigest: duplicatePreview.batch.groups[0]!.sourceSetDigest });
  if (duplicateResolved.batch.status !== "PREVIEW" || (duplicateResolved.group?.value.finalProposalPayload as { exampleEn?: string }).exampleEn !== duplicateAlternative.exampleEn) throw new Error("explicit duplicate source selection was not preserved");

  const claimRecoveryPayload: CatalogGovernancePayload = {
    ...basePayload,
    term: `checkclaim${suffix}`,
    lemma: `checkclaim${suffix}`,
    definitionZh: "失效審核權限接管測試詞",
    acceptedAnswersZh: ["失效審核權限接管測試詞"],
    exampleEn: "This word checks recovery from a revoked review claim.",
    exampleZh: "這個詞檢查失效審核權限的接管流程。",
  };
  const claimRecoveryPreview = await createCatalogSubmissionPreview({
    actorId: proposer.id,
    operationId: randomUUID(),
    fileName: CATALOG_CHECKER_FILE_NAME,
    bytes: new TextEncoder().encode(catalogRowsToCsv([sourceRow(claimRecoveryPayload, "CREATE")], CATALOG_GOVERNANCE_HEADERS)),
  });
  claimRecoveryBatchId = claimRecoveryPreview.batch.id;
  const claimRecoverySubmitted = await submitCatalogSubmissionBatch({
    batchId: claimRecoveryBatchId,
    actorId: proposer.id,
    expectedRevision: claimRecoveryPreview.batch.revision,
    operationId: randomUUID(),
    reason: "revoked reviewer claim recovery database check",
  });
  const firstClaim = await claimCatalogSubmissionBatch({
    batchId: claimRecoveryBatchId,
    actorId: revokedReviewer.id,
    expectedRevision: claimRecoverySubmitted.patch.revision,
    release: false,
  });
  await prisma.teacherProfile.update({
    where: { userId: revokedReviewer.id },
    data: { canManageWordCatalog: false },
  });
  const replacementClaim = await claimCatalogSubmissionBatch({
    batchId: claimRecoveryBatchId,
    actorId: unclaimedReviewer.id,
    expectedRevision: firstClaim.revision,
    release: false,
  });
  if (replacementClaim.batch.reviewerId !== unclaimedReviewer.id) {
    throw new Error("revoked reviewer claim could not be safely taken over");
  }
  const replacementAudit = await prisma.catalogAuditEvent.findFirst({
    where: {
      submissionBatchId: claimRecoveryBatchId,
      actorUserId: unclaimedReviewer.id,
      action: "REVIEW_CLAIMED",
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });
  if ((replacementAudit?.metadata as { replacedInvalidClaim?: boolean } | null)?.replacedInvalidClaim !== true) {
    throw new Error("revoked reviewer takeover audit metadata is missing");
  }

  const authorClaimPayload: CatalogGovernancePayload = {
    ...basePayload,
    term: `checkauthorclaim${suffix}`,
    lemma: `checkauthorclaim${suffix}`,
    definitionZh: "內容作者審核接管測試詞",
    acceptedAnswersZh: ["內容作者審核接管測試詞"],
    exampleEn: "This word checks recovery from a conflicted review claim.",
    exampleZh: "這個詞檢查內容作者衝突審核的接管流程。",
  };
  const authorClaimPreview = await createCatalogSubmissionPreview({
    actorId: proposer.id,
    operationId: randomUUID(),
    fileName: CATALOG_CHECKER_FILE_NAME,
    bytes: new TextEncoder().encode(catalogRowsToCsv([sourceRow(authorClaimPayload, "CREATE")], CATALOG_GOVERNANCE_HEADERS)),
  });
  authorClaimRecoveryBatchId = authorClaimPreview.batch.id;
  const authorClaimGroup = authorClaimPreview.batch.groups[0];
  if (!authorClaimGroup) throw new Error("author claim recovery proposal group is missing");
  const authorClaimStoredGroup = await prisma.catalogSubmissionProposalGroup.findUniqueOrThrow({
    where: { id: authorClaimGroup.id },
    select: { payloadDigest: true },
  });
  await prisma.catalogSubmissionProposalAuthor.create({
    data: {
      proposalGroupId: authorClaimGroup.id,
      actorUserId: reviewer.id,
      payloadDigest: authorClaimStoredGroup.payloadDigest,
      contributionKind: "RESOLUTION_EDIT",
    },
  });
  const authorClaimSubmitted = await submitCatalogSubmissionBatch({
    batchId: authorClaimRecoveryBatchId,
    actorId: proposer.id,
    expectedRevision: authorClaimPreview.batch.revision,
    operationId: randomUUID(),
    reason: "proposal author claim recovery database check",
  });
  let authorClaimRejected = false;
  try {
    await claimCatalogSubmissionBatch({
      batchId: authorClaimRecoveryBatchId,
      actorId: reviewer.id,
      expectedRevision: authorClaimSubmitted.patch.revision,
      release: false,
    });
  } catch (error) {
    authorClaimRejected = error instanceof Error && error.message === "CATALOG_SELF_REVIEW_FORBIDDEN";
  }
  if (!authorClaimRejected) throw new Error("proposal author was allowed to claim review");
  const legacyConflictedClaim = await prisma.catalogSubmissionBatch.update({
    where: { id: authorClaimRecoveryBatchId },
    data: { reviewerId: reviewer.id, status: "REVIEWING", revision: { increment: 1 } },
    select: { revision: true },
  });
  const competingClaims = await Promise.allSettled([unclaimedReviewer, competingReviewer].map((candidate) => claimCatalogSubmissionBatch({
    batchId: authorClaimRecoveryBatchId!,
    actorId: candidate.id,
    expectedRevision: legacyConflictedClaim.revision,
    release: false,
  })));
  const successfulClaims = competingClaims.flatMap((result, index) => result.status === "fulfilled"
    ? [{ claim: result.value, actorId: [unclaimedReviewer, competingReviewer][index]!.id }]
    : []);
  if (successfulClaims.length !== 1 || successfulClaims[0]!.claim.batch.reviewerId !== successfulClaims[0]!.actorId) {
    throw new Error("conflicted proposal author claim did not have exactly one concurrent takeover winner");
  }
  const authorReplacementActorId = successfulClaims[0]!.actorId;
  const authorReplacementAudit = await prisma.catalogAuditEvent.findFirst({
    where: {
      submissionBatchId: authorClaimRecoveryBatchId,
      actorUserId: authorReplacementActorId,
      action: "REVIEW_CLAIMED",
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });
  if ((authorReplacementAudit?.metadata as { replacedInvalidClaim?: boolean } | null)?.replacedInvalidClaim !== true) {
    throw new Error("conflicted proposal author takeover audit metadata is missing");
  }

  const transferRaceBase = await prisma.catalogSubmissionBatch.update({
    where: { id: authorClaimRecoveryBatchId },
    data: { reviewerId: reviewer.id, status: "REVIEWING", revision: { increment: 1 } },
    select: { revision: true },
  });
  const transferTakeoverRace = await Promise.allSettled([
    transferCatalogSubmissionClaim({
      batchId: authorClaimRecoveryBatchId,
      actorId: reviewer.id,
      nextReviewerId: unclaimedReviewer.id,
      expectedRevision: transferRaceBase.revision,
    }),
    claimCatalogSubmissionBatch({
      batchId: authorClaimRecoveryBatchId,
      actorId: unclaimedReviewer.id,
      expectedRevision: transferRaceBase.revision,
      release: false,
    }),
  ]);
  const transferTakeoverSuccesses = transferTakeoverRace.filter((result) => result.status === "fulfilled");
  const transferTakeoverErrors = transferTakeoverRace.flatMap((result) => result.status === "rejected"
    ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
    : []);
  if (
    transferTakeoverSuccesses.length !== 1
    || transferTakeoverErrors.length !== 1
    || transferTakeoverErrors[0] !== "CATALOG_BATCH_STALE"
  ) {
    throw new Error(`transfer/takeover race did not converge through revision CAS: ${JSON.stringify(transferTakeoverErrors)}`);
  }
  const transferRaceWinner = await prisma.catalogSubmissionBatch.findUniqueOrThrow({
    where: { id: authorClaimRecoveryBatchId },
    select: { reviewerId: true },
  });
  if (transferRaceWinner.reviewerId !== unclaimedReviewer.id) {
    throw new Error("transfer/takeover race selected an unexpected reviewer");
  }

  console.log(JSON.stringify({ ready: true, draftBeforePayloadVisible: true, terminalAttachBlocked, bridgeBlocked, payloadBlocked, retryConflictMetadataBlocked, acknowledgementRequired, finalizerClaimRequired, rowReparentBlocked, authorReparentBlocked, terminalReopenBlocked, sourceSelectionRequired, duplicateRetryReplayed, cancelledRetryRestarted: true, blockedRetryRecovered: true, revokedReviewerTakeover: true, proposalAuthorClaimRejected: true, proposalAuthorClaimTakeover: true, transferTakeoverRace: true, createFinalStatus: createFinalized.patch.batch.status, resolutionStatus: resolutionStale.batch.status, retryStatus: retryPreview.batch.status, duplicateStatus: duplicateResolved.batch.status, finalStatus: finalized.patch.batch.status, childStatus: finalizedBatch.groups[0]?.changeRequest?.status, historyEntries: history, correctiveStatus: corrective.batch.status }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "catalog submission DB check failed"); process.exitCode = 1; }).finally(async () => { await cleanup().catch((error) => console.error("cleanup failed", error instanceof Error ? error.message : error)); await prisma.$disconnect(); });
