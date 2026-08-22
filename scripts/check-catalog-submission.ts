import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma";
import { catalogRowsToCsv, type CatalogSourceRow } from "../src/lib/catalog/csv";
import { revisionContentDigest, type CatalogGovernancePayload } from "../src/lib/catalog/governance";
import {
  claimCatalogSubmissionBatch,
  createCorrectiveCatalogSubmissionPreview,
  createCatalogSubmissionPreview,
  finalizeCatalogSubmissionBatch,
  requestCatalogSubmissionResolution,
  resolveCatalogSubmissionGroup,
  reviewCatalogSubmissionGroup,
  submitCatalogSubmissionBatch,
} from "../src/lib/catalog/submission-server";

dotenv.config({ path: ".env.local", override: true });
if (!process.env.MIGRATE_URL) throw new Error("MIGRATE_URL is required");
const environment = process.env.DATABASE_ENVIRONMENT;
if (!environment || environment === "production" || process.env.CONFIRM_DATABASE_ENVIRONMENT !== environment) {
  throw new Error("check:catalog-submission requires matching non-production DATABASE_ENVIRONMENT and CONFIRM_DATABASE_ENVIRONMENT");
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATE_URL }) });

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const catalogKey = `check_catalog_${suffix}`;
const senseKey = `check_sense_${suffix}`;
let batchId: string | null = null;
let correctiveBatchId: string | null = null;
let createBatchId: string | null = null;
let resolutionBatchId: string | null = null;
let duplicateBatchId: string | null = null;
let draftBatchId: string | null = null;
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

async function cleanupBatchFixture(cleanupBatchId: string) {
    const batch = await prisma.catalogSubmissionBatch.findUnique({ where: { id: cleanupBatchId }, include: { proposalGroups: { include: { changeRequest: true } } } });
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
  const staleBatches = await prisma.catalogSubmissionBatch.findMany({
    where: { fileName: { in: ["catalog-governance-check.csv", "corrective-catalog-governance-check.csv"] } },
    select: { id: true },
  });
  for (const stale of staleBatches) await cleanupBatchFixture(stale.id);
  const staleSenses = await prisma.wordSense.findMany({ where: { senseKey: { startsWith: "check_sense_" } }, select: { id: true } });
  for (const stale of staleSenses) await cleanupSenseFixture(stale.id);
  await prisma.recentAuthGrant.deleteMany({ where: { id: { startsWith: "catalog-check-grant-" } } });
  await prisma.user.deleteMany({ where: { accountName: { startsWith: "catalog-check-" } } });
}

async function cleanup() {
  for (const cleanupBatchId of [correctiveBatchId, duplicateBatchId, resolutionBatchId, createBatchId, batchId, draftBatchId].filter((value): value is string => Boolean(value))) {
    await cleanupBatchFixture(cleanupBatchId);
  }
  if (senseId) {
    await cleanupSenseFixture(senseId);
  }
  if (createSenseId) await cleanupSenseFixture(createSenseId, true);
  if (grantIds.length) await prisma.recentAuthGrant.deleteMany({ where: { id: { in: grantIds } } });
  if (temporaryActorIds.length) await prisma.user.deleteMany({ where: { id: { in: temporaryActorIds } } });
}

async function main() {
  const metadata = await prisma.databaseMetadata.findUnique({ where: { key: "environment" }, select: { value: true } });
  if (metadata && metadata.value !== environment) throw new Error("DatabaseMetadata.environment does not match DATABASE_ENVIRONMENT");
  await cleanupStaleFixtures();
  const actors = await prisma.user.findMany({
    where: { status: "ACTIVE", OR: [{ role: "ADMIN" }, { role: "TEACHER", teacherProfile: { canManageWordCatalog: true } }] },
    orderBy: { id: "asc" },
    take: 3,
    select: { id: true, tokenVersion: true, credentialRevision: true },
  });
  while (actors.length < 3) {
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
  const [proposer, reviewer, unclaimedReviewer] = actors as [typeof actors[number], typeof actors[number], typeof actors[number]];
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
  const draftPreview = await createCatalogSubmissionPreview({ actorId: proposer.id, operationId: randomUUID(), fileName: "catalog-governance-check.csv", bytes: new TextEncoder().encode(catalogRowsToCsv([{ ...sourceRow(draftPayload), catalog_status: "DRAFT" }])) });
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
  const bytes = new TextEncoder().encode(catalogRowsToCsv([sourceRow(updatedPayload)]));
  const preview = await createCatalogSubmissionPreview({ actorId: proposer.id, operationId: randomUUID(), fileName: "catalog-governance-check.csv", bytes });
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
  const child = submitted.batch.groups[0]?.changeRequest;
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
    await prisma.catalogSubmissionProposalGroup.update({ where: { id: submitted.batch.groups[0]!.id }, data: { finalProposalPayload: { ...updatedPayload, definitionZh: "tampered" } } });
  } catch {
    payloadBlocked = true;
  }
  if (!payloadBlocked) throw new Error("submitted proposal payload guard was bypassed");
  const claimed = await claimCatalogSubmissionBatch({ batchId, actorId: reviewer.id, expectedRevision: submitted.batch.revision, release: false });
  let acknowledgementRequired = false;
  try {
    await reviewCatalogSubmissionGroup({ batchId, groupId: claimed.groups[0]!.id, actorId: reviewer.id, expectedBatchRevision: claimed.revision, expectedGroupRevision: claimed.groups[0]!.revision, decision: "APPROVE", reviewNote: "missing acknowledgement" });
  } catch (error) {
    acknowledgementRequired = error instanceof Error && error.message === "CATALOG_REVIEW_ACKNOWLEDGEMENT_REQUIRED";
  }
  if (!acknowledgementRequired) throw new Error("review acknowledgement guard was bypassed");
  const reviewed = await reviewCatalogSubmissionGroup({ batchId, groupId: claimed.groups[0]!.id, actorId: reviewer.id, expectedBatchRevision: claimed.revision, expectedGroupRevision: claimed.groups[0]!.revision, decision: "APPROVE", reviewNote: "database check approved", acknowledgedPayloadDigest: claimed.groups[0]!.payloadDigest });
  if (reviewed.batch.status !== "REVIEWED") throw new Error("review did not reach REVIEWED");
  const reauthenticatedAt = new Date();
  const expiresAt = new Date(reauthenticatedAt.getTime() + 15 * 60_000);
  const wrongGrantId = `catalog-check-grant-wrong-${suffix}`;
  grantIds.push(wrongGrantId);
  await prisma.recentAuthGrant.create({ data: { id: wrongGrantId, userId: unclaimedReviewer.id, tokenVersion: unclaimedReviewer.tokenVersion, credentialRevision: unclaimedReviewer.credentialRevision, reauthenticatedAt, expiresAt } });
  let finalizerClaimRequired = false;
  try {
    await finalizeCatalogSubmissionBatch({ batchId, actorId: unclaimedReviewer.id, expectedRevision: reviewed.batch.revision, operationId: randomUUID(), recentAuth: { grantId: wrongGrantId, tokenVersion: unclaimedReviewer.tokenVersion, credentialRevision: unclaimedReviewer.credentialRevision, reauthenticatedAt, expiresAt } });
  } catch (error) {
    finalizerClaimRequired = error instanceof Error && error.message === "CATALOG_REVIEW_CLAIM_REQUIRED";
  }
  if (!finalizerClaimRequired) throw new Error("finalizer claim guard was bypassed");
  const grantId = `catalog-check-grant-${suffix}`;
  grantIds.push(grantId);
  await prisma.recentAuthGrant.create({ data: { id: grantId, userId: reviewer.id, tokenVersion: reviewer.tokenVersion, credentialRevision: reviewer.credentialRevision, reauthenticatedAt, expiresAt } });
  const finalized = await finalizeCatalogSubmissionBatch({ batchId, actorId: reviewer.id, expectedRevision: reviewed.batch.revision, operationId: randomUUID(), recentAuth: { grantId, tokenVersion: reviewer.tokenVersion, credentialRevision: reviewer.credentialRevision, reauthenticatedAt, expiresAt } });
  if (finalized.batch.status !== "COMMITTED" || finalized.batch.groups[0]?.changeRequest?.status !== "APPROVED") throw new Error("finalize did not atomically commit");
  const finalizedRequest = await prisma.catalogChangeRequest.findUnique({ where: { id: child.id }, select: { beforePayloadSnapshot: true, afterPayloadSnapshot: true } });
  if (!finalizedRequest?.beforePayloadSnapshot || !finalizedRequest.afterPayloadSnapshot) throw new Error("complete history payload snapshots are missing");
  const history = await prisma.catalogHistoryFeedEntry.count({ where: { submissionBatchId: batchId } });
  if (history !== 1) throw new Error("batch history feed entry missing");
  const corrective = await createCorrectiveCatalogSubmissionPreview({ sourceBatchId: batchId, actorId: reviewer.id, operationId: randomUUID() });
  correctiveBatchId = corrective.batch.id;
  if (corrective.batch.status !== "PREVIEW" || corrective.batch.supersedesBatchId !== batchId || corrective.batch.groups[0]?.requestedAction !== "UPDATE") throw new Error("corrective preview contract failed");
  const correctivePayload = corrective.batch.groups[0]?.finalProposalPayload as { definitionZh?: string } | undefined;
  if (correctivePayload?.definitionZh !== basePayload.definitionZh) throw new Error("corrective preview did not restore the previous payload");

  const createPayload: CatalogGovernancePayload = { ...basePayload, term: `checkcreate${suffix}`, lemma: `checkcreate${suffix}`, definitionZh: "新增測試詞", acceptedAnswersZh: ["新增測試詞"], exampleEn: "This is a newly created catalog check word.", exampleZh: "這是一個新增詞庫檢查詞。" };
  const createPreview = await createCatalogSubmissionPreview({ actorId: proposer.id, operationId: randomUUID(), fileName: "catalog-governance-check.csv", bytes: new TextEncoder().encode(catalogRowsToCsv([sourceRow(createPayload, "CREATE")])) });
  createBatchId = createPreview.batch.id;
  const createSubmitted = await submitCatalogSubmissionBatch({ batchId: createBatchId, actorId: proposer.id, expectedRevision: createPreview.batch.revision, operationId: randomUUID(), reason: "CREATE database governance check" });

  const resolutionPayload: CatalogGovernancePayload = { ...basePayload, term: `checkresolution${suffix}`, lemma: `checkresolution${suffix}`, definitionZh: "修正流程測試詞", acceptedAnswersZh: ["修正流程測試詞"], exampleEn: "This word checks the resolution workflow.", exampleZh: "這個詞檢查修正流程。" };
  const resolutionPreview = await createCatalogSubmissionPreview({ actorId: proposer.id, operationId: randomUUID(), fileName: "catalog-governance-check.csv", bytes: new TextEncoder().encode(catalogRowsToCsv([sourceRow(resolutionPayload, "CREATE")])) });
  resolutionBatchId = resolutionPreview.batch.id;

  const createRow = await prisma.catalogSubmissionRow.findFirstOrThrow({ where: { batchId: createBatchId, proposalGroupId: { not: null } }, select: { id: true } });
  const createAuthor = await prisma.catalogSubmissionProposalAuthor.findFirstOrThrow({ where: { proposalGroup: { batchId: createBatchId } }, select: { id: true } });
  let rowReparentBlocked = false;
  try { await prisma.catalogSubmissionRow.update({ where: { id: createRow.id }, data: { batchId: resolutionBatchId, proposalGroupId: resolutionPreview.batch.groups[0]!.id } }); } catch { rowReparentBlocked = true; }
  if (!rowReparentBlocked) throw new Error("submitted row re-parent guard was bypassed");
  let authorReparentBlocked = false;
  try { await prisma.catalogSubmissionProposalAuthor.update({ where: { id: createAuthor.id }, data: { proposalGroupId: resolutionPreview.batch.groups[0]!.id } }); } catch { authorReparentBlocked = true; }
  if (!authorReparentBlocked) throw new Error("submitted author re-parent guard was bypassed");

  const createClaimed = await claimCatalogSubmissionBatch({ batchId: createBatchId, actorId: reviewer.id, expectedRevision: createSubmitted.batch.revision, release: false });
  const createReviewed = await reviewCatalogSubmissionGroup({ batchId: createBatchId, groupId: createClaimed.groups[0]!.id, actorId: reviewer.id, expectedBatchRevision: createClaimed.revision, expectedGroupRevision: createClaimed.groups[0]!.revision, decision: "APPROVE", reviewNote: "CREATE check approved", acknowledgedPayloadDigest: createClaimed.groups[0]!.payloadDigest });
  const createFinalized = await finalizeCatalogSubmissionBatch({ batchId: createBatchId, actorId: reviewer.id, expectedRevision: createReviewed.batch.revision, operationId: randomUUID(), recentAuth: { grantId, tokenVersion: reviewer.tokenVersion, credentialRevision: reviewer.credentialRevision, reauthenticatedAt, expiresAt } });
  createSenseId = createFinalized.batch.groups[0]?.changeRequest?.resultRevisionId ? (await prisma.catalogChangeRequest.findUniqueOrThrow({ where: { id: createFinalized.batch.groups[0]!.changeRequest!.id }, select: { senseId: true } })).senseId : null;
  if (createFinalized.batch.status !== "COMMITTED" || !createSenseId) throw new Error("batch CREATE did not atomically bind and commit the new sense");
  let terminalReopenBlocked = false;
  try { await prisma.catalogSubmissionBatch.update({ where: { id: createBatchId }, data: { status: "PREVIEW" } }); } catch { terminalReopenBlocked = true; }
  if (!terminalReopenBlocked) throw new Error("terminal batch lifecycle guard was bypassed");

  const resolutionSubmitted = await submitCatalogSubmissionBatch({ batchId: resolutionBatchId, actorId: proposer.id, expectedRevision: resolutionPreview.batch.revision, operationId: randomUUID(), reason: "resolution request database check" });
  const resolutionClaimed = await claimCatalogSubmissionBatch({ batchId: resolutionBatchId, actorId: reviewer.id, expectedRevision: resolutionSubmitted.batch.revision, release: false });
  const resolutionStale = await requestCatalogSubmissionResolution({ batchId: resolutionBatchId, groupId: resolutionClaimed.groups[0]!.id, actorId: reviewer.id, expectedBatchRevision: resolutionClaimed.revision, expectedGroupRevision: resolutionClaimed.groups[0]!.revision, reason: "needs content correction" });
  if (resolutionStale.status !== "STALE" || resolutionStale.groups[0]!.resolution !== resolutionClaimed.groups[0]!.resolution) throw new Error("request-resolution did not preserve submitted payload and stale the batch");

  const duplicateBase: CatalogGovernancePayload = { ...basePayload, term: `checkduplicate${suffix}`, lemma: `checkduplicate${suffix}`, definitionZh: "重複來源測試詞", acceptedAnswersZh: ["重複來源測試詞"], exampleEn: "This is source row two.", exampleZh: "這是來源第二行。" };
  const duplicateAlternative: CatalogGovernancePayload = { ...duplicateBase, exampleEn: "This is source row three.", exampleZh: "這是來源第三行。" };
  const duplicateRows = [{ ...sourceRow(duplicateBase, "CREATE"), sourceRow: 2 }, { ...sourceRow(duplicateAlternative, "CREATE"), sourceRow: 3 }];
  const duplicatePreview = await createCatalogSubmissionPreview({ actorId: proposer.id, operationId: randomUUID(), fileName: "catalog-governance-check.csv", bytes: new TextEncoder().encode(catalogRowsToCsv(duplicateRows)) });
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
  if (duplicateResolved.status !== "PREVIEW" || (duplicateResolved.groups[0]!.finalProposalPayload as { exampleEn?: string }).exampleEn !== duplicateAlternative.exampleEn) throw new Error("explicit duplicate source selection was not preserved");

  console.log(JSON.stringify({ ready: true, draftBeforePayloadVisible: true, terminalAttachBlocked, bridgeBlocked, payloadBlocked, acknowledgementRequired, finalizerClaimRequired, rowReparentBlocked, authorReparentBlocked, terminalReopenBlocked, sourceSelectionRequired, createFinalStatus: createFinalized.batch.status, resolutionStatus: resolutionStale.status, duplicateStatus: duplicateResolved.status, finalStatus: finalized.batch.status, childStatus: finalized.batch.groups[0]?.changeRequest?.status, historyEntries: history, correctiveStatus: corrective.batch.status }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "catalog submission DB check failed"); process.exitCode = 1; }).finally(async () => { await cleanup().catch((error) => console.error("cleanup failed", error instanceof Error ? error.message : error)); await prisma.$disconnect(); });
