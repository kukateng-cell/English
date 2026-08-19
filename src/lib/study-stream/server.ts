import { randomUUID } from "node:crypto";
import { Prisma, prisma } from "@/lib/prisma";
import type {
  ObjectiveEvidenceTarget,
  ObjectiveQuestionSnapshot,
  StudySession,
  StudyStreamItem,
  Word,
} from "@/generated/prisma";
import { fetchUnitProgress } from "@/lib/unit-progress-server";
import { normalizeLevel, unitCategoryToStorage, type LevelCode } from "@/lib/units";
import { checkInStudyDay } from "@/lib/streak";
import { checkAchievements } from "@/lib/achievements";
import { createInitialState, updateSM2, type Quality } from "@/lib/sm2";
import {
  admitWork,
  requiresEvidenceObligation,
  verificationTimes,
} from "@/lib/learning-policy/admission";
import { mapObjectiveFirstResponse } from "@/lib/learning-policy/quality";
import {
  RETRIEVAL_V1_POLICY,
  type CandidateRecord,
  type ProbePurpose,
  type SelfRating,
  type StreamItemKind,
  type StreamMode,
  type WorkKind,
  type WorkRecord,
} from "@/lib/learning-policy/types";
import {
  buildObjectiveQuestion,
  toPublicObjectiveQuestion,
  type ObjectiveQuestionSnapshotData,
  type QuestionWord,
} from "@/lib/learning-policy/question";
import { selectNextItem } from "@/lib/learning-policy/scheduler";
import {
  actionFingerprint,
  createStudyStreamCredential,
  digestStudyStreamCredential,
  STUDY_STREAM_CREDENTIAL_TTL_MS,
  STUDY_STREAM_FLOW_VERSION,
  type PublicStreamActionResponse,
  type PublicStreamItemBase,
  type PublicStreamResponse,
  type PublicStreamUnitSummary,
  type StudyStreamActionInput,
} from "@/lib/study-stream/contracts";
import {
  isRetryableTransactionConflict,
  waitForTransactionRetry,
} from "@/lib/transaction-retry";
import { withCurrentCatalogWord } from "@/lib/catalog/runtime";

const STREAM_SESSION_TTL_MS = 30 * 60_000;
const STREAM_ITEM_LEASE_MS = 15 * 60_000;
const MAX_TRANSACTION_ATTEMPTS = 5;
const MAX_CANDIDATES = 80;
const MAX_CREDENTIAL_LINEAGE_GRANTS = 8;

type StreamTransaction = Prisma.TransactionClient;

export class StudyStreamError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 429 | 503,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "StudyStreamError";
  }
}

interface StreamScope {
  mode: StreamMode;
  level: LevelCode | null;
  category: string | null;
  where: Prisma.WordWhereInput;
}

interface StreamQueryOptions {
  mode?: string | null;
  level?: string | null;
  category?: string | null;
  itemCredential?: string | null;
}

interface StreamItemWithRelations extends StudyStreamItem {
  word: Word | null;
  objectiveEvidenceTarget: ObjectiveEvidenceTarget | null;
  objectiveQuestionSnapshot: ObjectiveQuestionSnapshot | null;
}

interface StoredFeedback {
  selectedOptionId: string;
  correctOptionId: string;
  quality: number;
  isCorrect: boolean;
  acknowledged: boolean;
}

interface LearningCardAnswer {
  term: string;
  phonetic: string | null;
  definition: string;
  pos: string | null;
  examples: Array<{ en: string; zh: string }>;
}

interface ActionTransactionResult {
  response: PublicStreamActionResponse;
  duplicate: boolean;
}

interface CredentialGrant {
  digest: string;
  issuedAt: number;
  expiresAt: number;
  parentDigest: string | null;
}

type AdmissionDisposition = "accepted" | "already-active" | "debt-cap" | "not-required";

interface AdmissionOutcome {
  disposition: AdmissionDisposition;
  obligationId: string | null;
}

async function lockStreamUser(tx: StreamTransaction, userId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`,
  );
  if (rows.length !== 1) throw new StudyStreamError(403, "学习账户不存在或已失效");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCredentialDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function parseCredentialLineage(value: Prisma.JsonValue | null): CredentialGrant[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const parentDigest = entry.parentDigest;
    if (
      !isCredentialDigest(entry.digest) ||
      typeof entry.issuedAt !== "number" || !Number.isFinite(entry.issuedAt) ||
      typeof entry.expiresAt !== "number" || !Number.isFinite(entry.expiresAt) ||
      (parentDigest !== null && !isCredentialDigest(parentDigest))
    ) return [];
    return [{
      digest: entry.digest,
      issuedAt: entry.issuedAt,
      expiresAt: entry.expiresAt,
      parentDigest,
    }];
  }).slice(-MAX_CREDENTIAL_LINEAGE_GRANTS);
}

function initialCredentialLineage(
  digest: string,
  issuedAt: Date,
  expiresAt: Date,
): Prisma.InputJsonValue {
  return [{
    digest,
    issuedAt: issuedAt.getTime(),
    expiresAt: expiresAt.getTime(),
    parentDigest: null,
  }];
}

function rotatedCredentialLineage(
  item: StudyStreamItem,
  newDigest: string,
  issuedAt: Date,
  expiresAt: Date,
  parentDigest: string,
): Prisma.InputJsonValue {
  const now = issuedAt.getTime();
  // Keep a bounded history even after a grant expires. Normal action
  // validation still checks grant expiry; the explicit recovery path uses
  // only this digest match after it has revalidated the owning user, item,
  // session and typed operation. Dropping an expired predecessor here would
  // make a browser refresh irrecoverably invalidate its durable outbox row.
  const known = parseCredentialLineage(item.credentialLineage);
  const current = known.some((grant) => grant.digest === item.credentialDigest)
    ? known
    : [...known, {
        digest: item.credentialDigest,
        issuedAt: now,
        expiresAt: item.credentialExpiresAt.getTime(),
        parentDigest: null,
      }];
  const next = [...current, {
    digest: newDigest,
    issuedAt: now,
    expiresAt: expiresAt.getTime(),
    parentDigest,
  }];
  const unique = new Map<string, CredentialGrant>();
  for (const grant of next) unique.set(grant.digest, grant);
  return [...unique.values()].slice(-MAX_CREDENTIAL_LINEAGE_GRANTS) as unknown as Prisma.InputJsonValue;
}

function matchesCredentialDigest(
  item: StudyStreamItem,
  suppliedCredential: string,
): boolean {
  const digest = digestStudyStreamCredential(suppliedCredential);
  return digest === item.credentialDigest || parseCredentialLineage(item.credentialLineage)
    .some((grant) => grant.digest === digest);
}

function acceptsCredential(
  item: StudyStreamItem,
  suppliedCredential: string,
  now: Date,
): boolean {
  const digest = digestStudyStreamCredential(suppliedCredential);
  if (digest === item.credentialDigest && item.credentialExpiresAt > now) return true;
  return parseCredentialLineage(item.credentialLineage)
    .some((grant) => grant.digest === digest && grant.expiresAt > now.getTime());
}

function asFeedback(value: unknown): StoredFeedback | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.selectedOptionId !== "string" ||
    typeof value.correctOptionId !== "string" ||
    typeof value.quality !== "number" ||
    typeof value.isCorrect !== "boolean" ||
    typeof value.acknowledged !== "boolean"
  ) {
    return null;
  }
  return {
    selectedOptionId: value.selectedOptionId,
    correctOptionId: value.correctOptionId,
    quality: value.quality,
    isCorrect: value.isCorrect,
    acknowledged: value.acknowledged,
  };
}

function asStoredActionResponse(value: Prisma.JsonValue | null): PublicStreamActionResponse | null {
  if (!isRecord(value) || value.ok !== true || typeof value.operationId !== "string") return null;
  return value as unknown as PublicStreamActionResponse;
}

function parseExamples(value: Prisma.JsonValue | null): Array<{ en: string; zh: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((example) => {
    if (!isRecord(example) || typeof example.en !== "string" || typeof example.zh !== "string") return [];
    return [{ en: example.en, zh: example.zh }];
  }).slice(0, 2);
}

function learningCardAnswer(word: Word | null): LearningCardAnswer | null {
  if (!word) return null;
  return {
    term: word.term,
    phonetic: word.phonetic,
    definition: word.definition,
    pos: word.pos,
    examples: parseExamples(word.examples),
  };
}

function scopeFilters(filters: Set<string>): Prisma.WordWhereInput[] {
  return [...filters].map((key) => {
    const separator = key.indexOf("::");
    return withCurrentCatalogWord({
      level: normalizeLevel(key.slice(0, separator)),
      category: key.slice(separator + 2) === "未分类" ? null : key.slice(separator + 2),
    });
  });
}

async function resolveScope(
  userId: string,
  tx: StreamTransaction,
  input: StreamQueryOptions,
): Promise<StreamScope> {
  const rawMode = input.mode?.trim() || "global";
  if (rawMode !== "global" && rawMode !== "unit") {
    throw new StudyStreamError(400, "学习模式无效");
  }
  const mode = rawMode as StreamMode;
  const level = input.level ? normalizeLevel(input.level) : null;
  const category = input.category === null || input.category === undefined
    ? null
    : unitCategoryToStorage(input.category.trim());
  const progress = await fetchUnitProgress(userId, tx);
  const unlocked = new Set<string>();
  for (const aggregation of progress) {
    for (const unit of aggregation.units) {
      if (unit.unlocked) unlocked.add(`${aggregation.level}::${unit.name}`);
    }
  }

  if (mode === "unit") {
    if (!level || !input.category || input.category.trim().length === 0) {
      throw new StudyStreamError(400, "unit mode 需要 level 及 category");
    }
    const key = `${level}::${input.category.trim()}`;
    if (!unlocked.has(key)) throw new StudyStreamError(403, "该单元尚未解锁");
    return {
      mode,
      level,
      category,
      where: withCurrentCatalogWord({ level, category }),
    };
  }

  const filters = scopeFilters(unlocked);
  if (filters.length === 0) {
    return { mode, level: null, category: null, where: { id: "__no_unlocked_words__" } };
  }
  return { mode, level: null, category: null, where: { OR: filters } };
}

function workKind(value: string): WorkKind {
  return value === "REMEDIATION" ? "REMEDIATION" : "EVIDENCE_OBLIGATION";
}

function toWorkRecord(row: {
  id: string;
  userId: string;
  wordId: string | null;
  senseId: string | null;
  kind: string;
  status: string;
  admittedAt: Date;
  eligibleAt: Date;
  expiresAt: Date;
  sourceOperationId: string | null;
  updatedAt: Date;
}): WorkRecord | null {
  if (!row.wordId) return null;
  return {
    id: row.id,
    learnerId: row.userId,
    wordId: row.wordId,
    senseId: row.senseId,
    kind: workKind(row.kind),
    status: row.status as WorkRecord["status"],
    admittedAt: row.admittedAt.getTime(),
    eligibleAt: row.eligibleAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
    lastServedAt: row.updatedAt.getTime(),
    sourceOperationId: row.sourceOperationId,
  };
}

async function expireWork(tx: StreamTransaction, userId: string, now: Date): Promise<void> {
  await tx.evidenceObligation.updateMany({
    where: {
      userId,
      status: { in: ["PENDING", "LEASED"] },
      expiresAt: { lte: now },
    },
    data: { status: "EXPIRED", activeKey: null, terminalReason: "age-limit" },
  });
}

async function activeWork(
  tx: StreamTransaction,
  userId: string,
  scope: StreamScope,
  now: Date,
): Promise<WorkRecord[]> {
  const rows = await tx.evidenceObligation.findMany({
    where: {
      userId,
      status: { in: ["PENDING", "LEASED"] },
      eligibleAt: { lte: now },
      expiresAt: { gt: now },
      wordId: { not: null },
      word: scope.where,
    },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    take: MAX_CANDIDATES,
  });
  return rows.flatMap((row) => {
    const work = toWorkRecord(row);
    return work ? [work] : [];
  });
}

function candidateForWork(
  row: WorkRecord,
  mode: StreamMode,
): CandidateRecord {
  const remediation = row.kind === "REMEDIATION";
  return {
    id: `work:${row.id}`,
    wordId: row.wordId,
    senseId: row.senseId,
    kind: remediation ? "LEARNING_CARD" : "OBJECTIVE_PROBE",
    purpose: remediation ? undefined : "EVIDENCE_OBLIGATION",
    workId: row.id,
    eligibleAt: row.eligibleAt,
    expiresAt: row.expiresAt,
    mode,
    selectionReason: remediation ? "remediation" : "evidence-obligation",
  };
}

async function buildCandidates(
  tx: StreamTransaction,
  userId: string,
  session: StudySession,
  scope: StreamScope,
  now: Date,
): Promise<{ candidates: CandidateRecord[]; active: WorkRecord[] }> {
  await expireWork(tx, userId, now);
  const active = await activeWork(tx, userId, scope, now);
  const candidates: CandidateRecord[] = active.map((work) => candidateForWork(work, scope.mode));
  const workWordIds = new Set(active.map((work) => work.wordId));

  const due = await tx.review.findMany({
    where: {
      userId,
      nextReviewDate: { lte: now },
      word: scope.where,
    },
    orderBy: [{ nextReviewDate: "asc" }, { id: "asc" }],
    take: MAX_CANDIDATES,
    select: { id: true, wordId: true, senseId: true },
  });
  const openTargets = await tx.objectiveEvidenceTarget.findMany({
    where: { userId, status: "OPEN", wordId: { not: null } },
    select: { wordId: true, purpose: true },
  });
  const openTargetKeys = new Set(openTargets.map((target) => `${target.purpose}:${target.wordId}`));
  for (const review of due) {
    if (workWordIds.has(review.wordId)) continue;
    if (openTargetKeys.has(`DUE_REVIEW:${review.wordId}`)) continue;
    candidates.push({
      id: `due:${review.id}`,
      wordId: review.wordId,
      senseId: review.senseId,
      kind: "OBJECTIVE_PROBE",
      purpose: "DUE_REVIEW",
      eligibleAt: now.getTime(),
      expiresAt: now.getTime() + RETRIEVAL_V1_POLICY.maxObligationAgeMs,
      mode: scope.mode,
      selectionReason: "due-review",
    });
  }

  const recent = await tx.studyStreamItem.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { wordId: true },
  });
  const recentWordIds = new Set(recent.flatMap((row) => row.wordId ? [row.wordId] : []));
  const newWords = await tx.word.findMany({
    where: {
      AND: [scope.where, { reviews: { none: { userId } } }],
    },
    orderBy: { term: "asc" },
    take: MAX_CANDIDATES,
  });
  for (const word of newWords) {
    if (workWordIds.has(word.id) || recentWordIds.has(word.id)) continue;
    candidates.push({
      id: `new:${word.id}`,
      wordId: word.id,
      senseId: word.senseId,
      kind: "LEARNING_CARD",
      mode: scope.mode,
      selectionReason: "new-word",
    });
  }

  if (candidates.every((candidate) => candidate.kind === "OBJECTIVE_PROBE")) {
    const ordinary = await tx.review.findMany({
      where: {
        userId,
        nextReviewDate: { gt: now },
        word: scope.where,
      },
      orderBy: [{ lastReviewedAt: "asc" }, { id: "asc" }],
      take: MAX_CANDIDATES,
      select: { id: true, wordId: true, senseId: true },
    });
    for (const review of ordinary) {
      if (workWordIds.has(review.wordId) || recentWordIds.has(review.wordId)) continue;
      candidates.push({
        id: `ordinary:${review.id}`,
        wordId: review.wordId,
        senseId: review.senseId,
        kind: "LEARNING_CARD",
        mode: scope.mode,
        selectionReason: "spaced-learning-card",
      });
    }
  }
  return { candidates, active };
}

function recentStreamShape(rows: Array<{ itemKind: string; usedAt: Date | null; feedbackAcknowledgedAt: Date | null }>): {
  consecutiveProbes: number;
  acknowledgedItemsSinceProbe: number;
} {
  let consecutiveProbes = 0;
  let acknowledgedItemsSinceProbe = 0;
  let seenProbe = false;
  for (const row of rows) {
    const acknowledged = row.usedAt !== null && (
      row.itemKind !== "OBJECTIVE_PROBE" || row.feedbackAcknowledgedAt !== null
    );
    if (!acknowledged) continue;
    if (!seenProbe && row.itemKind === "OBJECTIVE_PROBE") {
      consecutiveProbes += 1;
      seenProbe = true;
      continue;
    }
    if (!seenProbe) {
      acknowledgedItemsSinceProbe += 1;
      continue;
    }
    break;
  }
  return { consecutiveProbes, acknowledgedItemsSinceProbe };
}

function snapshotToData(snapshot: ObjectiveQuestionSnapshot): ObjectiveQuestionSnapshotData | null {
  if (
    (snapshot.direction !== "en-zh" && snapshot.direction !== "zh-en") ||
    !Array.isArray(snapshot.options) ||
    typeof snapshot.correctOptionId !== "string" ||
    snapshot.contentVersion !== RETRIEVAL_V1_POLICY.itemConstructionVersion ||
    snapshot.itemConstructionVersion !== RETRIEVAL_V1_POLICY.itemConstructionVersion ||
    snapshot.prompt.trim().length === 0 ||
    snapshot.wordTerm.trim().length === 0 ||
    snapshot.wordDefinition.trim().length === 0
  ) {
    return null;
  }
  const options = snapshot.options.flatMap((option) => {
    if (!isRecord(option) || typeof option.id !== "string" || typeof option.text !== "string") return [];
    return [{ id: option.id, text: option.text }];
  });
  const optionIds = new Set(options.map((option) => option.id));
  const optionTexts = new Set(options.map((option) => option.text.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US")));
  const correctCount = options.filter((option) => option.id === snapshot.correctOptionId).length;
  const expectedPrompt = snapshot.direction === "en-zh" ? snapshot.wordTerm : snapshot.wordDefinition;
  if (
    options.length !== 4 ||
    optionIds.size !== 4 ||
    optionTexts.size !== 4 ||
    correctCount !== 1 ||
    snapshot.prompt.normalize("NFKC").replace(/\s+/gu, " ").trim() !== expectedPrompt.normalize("NFKC").replace(/\s+/gu, " ").trim()
  ) return null;
  return {
    prompt: snapshot.prompt,
    wordTerm: snapshot.wordTerm,
    wordDefinition: snapshot.wordDefinition,
    direction: snapshot.direction,
    options,
    correctOptionId: snapshot.correctOptionId,
    itemConstructionVersion: snapshot.itemConstructionVersion as ObjectiveQuestionSnapshotData["itemConstructionVersion"],
  };
}

function questionWord(word: Word): QuestionWord {
  return {
    id: word.id,
    term: word.term,
    definition: word.definition,
    senseId: word.senseId,
    acceptedAnswers: word.acceptedAnswers,
    acceptedForms: word.acceptedForms,
    curatedDistractorsEn: word.distractorEn,
    curatedDistractorsZh: word.distractorZh,
    enableEnToZh: word.enableEnToZh,
    enableZhToEn: word.enableZhToEn,
    phonetic: word.phonetic,
    synonyms: word.synonyms,
    antonyms: word.antonyms,
  };
}

function objectiveFeedbackFromReceipt(
  receipt: Prisma.JsonValue | null,
  acknowledged: boolean,
): StoredFeedback | null {
  const feedback = isRecord(receipt) ? asFeedback(receipt.feedback) : null;
  return feedback ? { ...feedback, acknowledged } : null;
}

function toPublicItem(
  row: StreamItemWithRelations,
  credential: string,
  feedback: StoredFeedback | null = null,
): PublicStreamItemBase | null {
  if (!row.word) return null;
  if (row.itemKind !== "LEARNING_CARD" && row.itemKind !== "OBJECTIVE_PROBE") return null;
  const base: PublicStreamItemBase = {
    streamItemId: row.id,
    kind: row.itemKind as StreamItemKind,
    flowVersion: STUDY_STREAM_FLOW_VERSION,
    policyVersion: row.policyVersion as PublicStreamItemBase["policyVersion"],
    qualityPolicyVersion: RETRIEVAL_V1_POLICY.qualityPolicyVersion,
    itemConstructionVersion: RETRIEVAL_V1_POLICY.itemConstructionVersion,
    selectionReason: row.selectionReason,
    itemCredential: credential,
    credentialExpiresAt: row.credentialExpiresAt.toISOString(),
    clientRevision: row.clientRevision ?? 0,
    prompt: row.itemKind === "OBJECTIVE_PROBE"
      ? row.objectiveQuestionSnapshot?.prompt ?? ""
      : row.word.term,
    level: normalizeLevel(row.word.level),
    category: row.word.category,
  };

  if (row.itemKind === "LEARNING_CARD") {
    if (row.revealedAt) {
      const answer = learningCardAnswer(row.word);
      if (answer) base.learningCard = answer;
    }
    return base;
  }

  const snapshot = row.objectiveQuestionSnapshot
    ? snapshotToData(row.objectiveQuestionSnapshot)
    : null;
  if (!snapshot) return null;
  base.direction = snapshot.direction;
  base.objectiveQuestion = toPublicObjectiveQuestion(snapshot);
  base.probePurpose = (row.objectiveEvidenceTarget?.purpose ?? "DUE_REVIEW") as ProbePurpose;
  if (feedback) base.feedback = feedback;
  return base;
}

async function receiptFeedback(
  tx: StreamTransaction,
  userId: string,
  operationId: string | null,
  acknowledged: boolean,
): Promise<StoredFeedback | null> {
  if (!operationId) return null;
  const receipt = await tx.operationReceipt.findUnique({
    where: { userId_operationId: { userId, operationId } },
    select: { response: true },
  });
  return objectiveFeedbackFromReceipt(receipt?.response ?? null, acknowledged);
}

async function ensureCredential(
  tx: StreamTransaction,
  item: StreamItemWithRelations,
  suppliedCredential: string | null | undefined,
  now: Date,
): Promise<{ item: StreamItemWithRelations; credential: string }> {
  const suppliedDigest = suppliedCredential
    ? digestStudyStreamCredential(suppliedCredential)
    : null;
  const canReuse =
    suppliedCredential !== null &&
    suppliedCredential !== undefined &&
    suppliedDigest === item.credentialDigest &&
    item.credentialExpiresAt > now;
  const canReuseLineage =
    suppliedCredential !== null &&
    suppliedCredential !== undefined &&
    acceptsCredential(item, suppliedCredential, now);
  if (canReuse || canReuseLineage) {
    if (item.usedAt === null) {
      await tx.studyStreamItem.update({
        where: { id: item.id },
        data: { leaseExpiresAt: new Date(now.getTime() + STREAM_ITEM_LEASE_MS) },
      });
    }
    return { item, credential: suppliedCredential };
  }

  const credential = createStudyStreamCredential();
  const credentialExpiresAt = new Date(now.getTime() + STUDY_STREAM_CREDENTIAL_TTL_MS);
  const updated = await tx.studyStreamItem.update({
    where: { id: item.id },
    data: {
      credentialDigest: digestStudyStreamCredential(credential),
      credentialExpiresAt,
      credentialLineage: rotatedCredentialLineage(
        item,
        digestStudyStreamCredential(credential),
        now,
        credentialExpiresAt,
        item.credentialDigest,
      ),
      leaseExpiresAt: new Date(now.getTime() + STREAM_ITEM_LEASE_MS),
    },
    include: {
      word: true,
      objectiveEvidenceTarget: true,
      objectiveQuestionSnapshot: true,
    },
  });
  return { item: updated, credential };
}

async function getCurrentItem(
  tx: StreamTransaction,
  sessionId: string,
): Promise<StreamItemWithRelations | null> {
  return tx.studyStreamItem.findFirst({
    where: {
      sessionId,
      OR: [
        { usedAt: null, status: "LEASED" },
        { itemKind: "OBJECTIVE_PROBE", usedAt: { not: null }, feedbackAcknowledgedAt: null },
      ],
    },
    orderBy: { createdAt: "asc" },
    include: {
      word: true,
      objectiveEvidenceTarget: true,
      objectiveQuestionSnapshot: true,
    },
  });
}

async function ensureSession(
  tx: StreamTransaction,
  userId: string,
  scope: StreamScope,
  now: Date,
): Promise<StudySession> {
  const existing = await tx.studySession.findFirst({
    where: {
      userId,
      flowVersion: STUDY_STREAM_FLOW_VERSION,
      mode: scope.mode,
      scopeLevel: scope.level,
      scopeCategory: scope.category,
      retiredAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  return tx.studySession.create({
    data: {
      userId,
      queueFingerprint: `retrieval-v2:${scope.mode}:${scope.level ?? ""}:${scope.category ?? ""}`,
      expiresAt: new Date(now.getTime() + STREAM_SESSION_TTL_MS),
      flowVersion: STUDY_STREAM_FLOW_VERSION,
      learningPolicyVersion: RETRIEVAL_V1_POLICY.policyVersion,
      mode: scope.mode,
      catalogReadMode: "SENSE_V1",
      scopeLevel: scope.level,
      scopeCategory: scope.category,
      revision: 0,
    },
  });
}

async function createObjectiveTarget(
  tx: StreamTransaction,
  userId: string,
  session: StudySession,
  candidate: CandidateRecord,
): Promise<{
  target: ObjectiveEvidenceTarget;
  snapshot: ObjectiveQuestionSnapshot;
}> {
  const word = await tx.word.findUnique({ where: { id: candidate.wordId } });
  if (!word) throw new StudyStreamError(404, "学习词条不存在");
  const review = await tx.review.findUnique({
    where: { userId_wordId: { userId, wordId: word.id } },
    select: { revision: true },
  });
  const expectedRevision = review?.revision ?? 0;
  const purpose = candidate.purpose ?? "EVIDENCE_OBLIGATION";
  const activeKey = purpose === "EVIDENCE_OBLIGATION" && candidate.workId
    ? `obligation:${candidate.workId}`
    : `due:${userId}:${word.id}:${expectedRevision}`;
  let target = await tx.objectiveEvidenceTarget.findUnique({
    where: { activeKey },
  });
  if (
    target &&
    (target.status !== "OPEN" || target.expectedReviewRevision !== expectedRevision)
  ) {
    target = await tx.objectiveEvidenceTarget.update({
      where: { id: target.id },
      data: { status: "CANCELLED", activeKey: null, obligationId: null },
    });
    target = null;
  }
  if (!target) {
    target = await tx.objectiveEvidenceTarget.create({
      data: {
        userId,
        wordId: word.id,
        senseId: word.senseId,
        purpose,
        expectedReviewRevision: expectedRevision,
        policyVersion: RETRIEVAL_V1_POLICY.policyVersion,
        itemConstructionVersion: RETRIEVAL_V1_POLICY.itemConstructionVersion,
        status: "OPEN",
        activeKey,
        obligationId: purpose === "EVIDENCE_OBLIGATION" && candidate.workId ? candidate.workId : null,
      },
    });
  }

  let snapshot = await tx.objectiveQuestionSnapshot.findUnique({
    where: { targetId: target.id },
  });
  if (!snapshot) {
    const source = await tx.word.findMany({
      // Curated distractors come from the target row.  The source query is
      // only needed for sibling-sense answer exclusion, so do not cap it to
      // an arbitrary unlocked-word window that could miss run=經營.
      where: withCurrentCatalogWord({ term: word.term }),
      orderBy: { id: "asc" },
    });
    const built = buildObjectiveQuestion(
      questionWord(word),
      source.map(questionWord),
      `${session.id}:${target.id}:${expectedRevision}`,
    );
    if (!built) throw new StudyStreamError(409, "当前词条缺少安全的客观题选项", { code: "NO_VALID_OBJECTIVE_SNAPSHOT" });
    snapshot = await tx.objectiveQuestionSnapshot.create({
      data: {
        targetId: target.id,
        wordId: word.id,
        senseId: word.senseId,
        contentRevisionId: word.contentRevisionId,
        catalogRevisionId: word.catalogRevisionId,
        prompt: built.prompt,
        wordTerm: built.wordTerm,
        wordDefinition: built.wordDefinition,
        direction: built.direction,
        options: built.options as unknown as Prisma.InputJsonValue,
        correctOptionId: built.correctOptionId,
        contentVersion: RETRIEVAL_V1_POLICY.itemConstructionVersion,
        itemConstructionVersion: built.itemConstructionVersion,
      },
    });
  }
  return { target, snapshot };
}

async function createStreamItem(
  tx: StreamTransaction,
  userId: string,
  session: StudySession,
  candidate: CandidateRecord,
  now: Date,
): Promise<{ item: StreamItemWithRelations; credential: string }> {
  const credential = createStudyStreamCredential();
  const credentialExpiresAt = new Date(now.getTime() + STUDY_STREAM_CREDENTIAL_TTL_MS);
  let targetId: string | null = null;
  let snapshotId: string | null = null;
  if (candidate.kind === "OBJECTIVE_PROBE") {
    const objective = await createObjectiveTarget(tx, userId, session, candidate);
    targetId = objective.target.id;
    snapshotId = objective.snapshot.id;
  }
  const item = await tx.studyStreamItem.create({
    data: {
      sessionId: session.id,
      streamItemKey: `stream-${randomUUID()}`,
      wordId: candidate.wordId,
      senseId: candidate.senseId ?? null,
      itemKind: candidate.kind,
      selectionReason: candidate.selectionReason,
      policyVersion: RETRIEVAL_V1_POLICY.policyVersion,
      status: "LEASED",
      leaseExpiresAt: new Date(now.getTime() + STREAM_ITEM_LEASE_MS),
      credentialDigest: digestStudyStreamCredential(credential),
      credentialExpiresAt,
      credentialLineage: initialCredentialLineage(
        digestStudyStreamCredential(credential),
        now,
        credentialExpiresAt,
      ),
      clientRevision: session.revision,
      objectiveEvidenceTargetId: targetId,
      objectiveQuestionSnapshotId: snapshotId,
      workObligationId: candidate.workId ?? null,
    },
    include: {
      word: true,
      objectiveEvidenceTarget: true,
      objectiveQuestionSnapshot: true,
    },
  });
  if (candidate.workId) {
    const leased = await tx.evidenceObligation.updateMany({
      where: { id: candidate.workId, status: { in: ["PENDING", "LEASED"] } },
      data: {
        status: "LEASED",
        leaseOwnerSessionId: session.id,
        leaseExpiresAt: new Date(now.getTime() + STREAM_ITEM_LEASE_MS),
      },
    });
    if (leased.count !== 1) throw new StudyStreamError(409, "学习任务已被其他装置接手，请重新载入");
  }
  return { item, credential };
}

function streamResponse(
  session: StudySession,
  item: PublicStreamItemBase | null,
  resumedFeedback: boolean,
  unitSummary: PublicStreamUnitSummary | undefined,
): PublicStreamResponse {
  const response: PublicStreamResponse = {
    ok: true,
    assigned: true,
    session: {
      id: session.id,
      flowVersion: STUDY_STREAM_FLOW_VERSION,
      mode: session.mode as StreamMode,
      policyVersion: session.learningPolicyVersion as PublicStreamResponse["session"]["policyVersion"],
      revision: session.revision,
      expiresAt: session.expiresAt.toISOString(),
    },
    item,
    resumedFeedback,
  };
  if (unitSummary) response.unitSummary = unitSummary;
  return response;
}

async function getUnitSummary(
  tx: StreamTransaction,
  userId: string,
  scope: StreamScope,
): Promise<PublicStreamUnitSummary | undefined> {
  if (scope.mode !== "unit") return undefined;
  const words = await tx.word.findMany({
    where: scope.where,
    select: { id: true },
  });
  const wordIds = words.map((word) => word.id);
  if (wordIds.length === 0) {
    return {
      totalWordCount: 0,
      encounteredWordCount: 0,
      objectiveRecognitionCount: 0,
    };
  }
  const encountered = await tx.studyEncounter.findMany({
    where: { userId, wordId: { in: wordIds } },
    select: { wordId: true },
    distinct: ["wordId"],
  });
  const objectiveRecognitionCount = await tx.reviewEvent.count({
    where: {
      userId,
      wordId: { in: wordIds },
      eventKind: "REVIEW",
      evidenceKind: "OBJECTIVE_PROBE",
      flowVersion: STUDY_STREAM_FLOW_VERSION,
      objectiveEvidenceTargetId: { not: null },
      isHistorical: false,
    },
  });
  return {
    totalWordCount: wordIds.length,
    encounteredWordCount: encountered.filter((row) => row.wordId !== null).length,
    objectiveRecognitionCount,
  };
}

export async function getOrCreateStudyStream(
  userId: string,
  options: StreamQueryOptions = {},
): Promise<PublicStreamResponse> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const now = new Date();
          const scope = await resolveScope(userId, tx, options);
          // Serialise session creation and item leasing per learner. Serializable
          // retries still protect the database, while the explicit user lock
          // makes the cross-tab bootstrap invariant observable and bounded.
          await lockStreamUser(tx, userId);
          const session = await ensureSession(tx, userId, scope, now);
          const unitSummary = await getUnitSummary(tx, userId, scope);
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "StudySession" WHERE "id" = ${session.id} FOR UPDATE`,
          );
          const current = await getCurrentItem(tx, session.id);
          if (current) {
            const ensured = await ensureCredential(tx, current, options.itemCredential, now);
            const feedback = ensured.item.usedAt
              ? await receiptFeedback(tx, userId, ensured.item.operationId, ensured.item.feedbackAcknowledgedAt !== null)
              : null;
            const item = toPublicItem(ensured.item, ensured.credential, feedback);
            if (!item) throw new StudyStreamError(409, "学习项目已失效，请重新载入");
            return streamResponse(
              session,
              item,
              ensured.item.itemKind === "OBJECTIVE_PROBE" && ensured.item.usedAt !== null,
              unitSummary,
            );
          }

          const built = await buildCandidates(tx, userId, session, scope, now);
          const recent = await tx.studyStreamItem.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: "desc" },
            take: 20,
            select: { itemKind: true, usedAt: true, feedbackAcknowledgedAt: true },
          });
          const shape = recentStreamShape(recent);
          const excluded = new Set<string>();
          for (let selectionAttempt = 0; selectionAttempt < built.candidates.length; selectionAttempt += 1) {
            const candidates = built.candidates.filter((candidate) => !excluded.has(candidate.id));
            const decision = selectNextItem({
              mode: scope.mode,
              now: now.getTime(),
              consecutiveProbes: shape.consecutiveProbes,
              acknowledgedItemsSinceProbe: shape.acknowledgedItemsSinceProbe,
              lastWordId: null,
              activeWork: built.active,
              candidates,
            });
            if (!decision.candidate) break;
            try {
              const created = await createStreamItem(tx, userId, session, decision.candidate, now);
              const item = toPublicItem(created.item, created.credential);
              if (!item) throw new StudyStreamError(409, "学习项目已失效，请重新载入");
              return streamResponse(session, item, false, unitSummary);
            } catch (error) {
              if (!(error instanceof StudyStreamError) || error.details.code !== "NO_VALID_OBJECTIVE_SNAPSHOT") throw error;
              excluded.add(decision.candidate.id);
            }
          }
          return streamResponse(session, null, false, unitSummary);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const retryable = isRetryableTransactionConflict(error) || (
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
      );
      if (!retryable || attempt === MAX_TRANSACTION_ATTEMPTS) throw error;
      await waitForTransactionRetry(attempt - 1);
    }
  }
  throw new Error("Study stream transaction retry exhausted");
}

async function loadActionItem(
  tx: StreamTransaction,
  userId: string,
  input: StudyStreamActionInput,
  now: Date,
  options: {
    recoverExpiredSession?: boolean;
    recoverExpiredCredential?: boolean;
    recoverExpiredLease?: boolean;
  } = {},
): Promise<StreamItemWithRelations & { session: StudySession }> {
  const item = await tx.studyStreamItem.findFirst({
    where: {
      id: input.streamItemId,
      sessionId: input.studySessionId,
    },
    include: {
      word: true,
      objectiveEvidenceTarget: true,
      objectiveQuestionSnapshot: true,
      session: true,
    },
  });
  if (!item || item.session.userId !== userId || item.session.flowVersion !== STUDY_STREAM_FLOW_VERSION) {
    throw new StudyStreamError(403, "学习项目凭证无效或不属于当前账户");
  }
  const credentialMatches = matchesCredentialDigest(item, input.itemCredential);
  if (!credentialMatches) {
    throw new StudyStreamError(403, "学习项目凭证无效或已过期", { code: "ITEM_CREDENTIAL_INVALID" });
  }
  const credentialAccepted = acceptsCredential(item, input.itemCredential, now);
  if (item.session.retiredAt !== null) {
    throw new StudyStreamError(403, "学习 session 已过期或已撤销", { code: "SESSION_REVOKED" });
  }
  if (item.session.expiresAt <= now) {
    if (!options.recoverExpiredSession) {
      throw new StudyStreamError(403, "学习 session 已过期或已撤销", { code: "SESSION_EXPIRED" });
    }
    const recoveredExpiresAt = new Date(now.getTime() + STREAM_SESSION_TTL_MS);
    const recovered = await tx.studySession.updateMany({
      where: { id: item.session.id, userId, retiredAt: null, expiresAt: { lte: now } },
      data: { expiresAt: recoveredExpiresAt },
    });
    if (recovered.count !== 1) {
      throw new StudyStreamError(403, "学习 session 已过期或已撤销", { code: "SESSION_REVOKED" });
    }
    // Keep the in-transaction relation authoritative for revision updates and
    // response construction below; the user lock serialises recovery with
    // another tab/device using the same learner session.
    item.session = { ...item.session, expiresAt: recoveredExpiresAt };
  }
  if (!credentialAccepted && !options.recoverExpiredCredential) {
    throw new StudyStreamError(403, "学习项目凭证无效或已过期", { code: "ITEM_CREDENTIAL_EXPIRED" });
  }
  if (item.usedAt === null && item.leaseExpiresAt <= now) {
    if (!options.recoverExpiredLease) {
      throw new StudyStreamError(403, "学习项目租约已过期，请重新载入", { code: "EXPIRED_ITEM_LEASE" });
    }
    const recoveredLeaseExpiresAt = new Date(now.getTime() + STREAM_ITEM_LEASE_MS);
    const recoveredLease = await tx.studyStreamItem.updateMany({
      where: {
        id: item.id,
        sessionId: item.session.id,
        usedAt: null,
        leaseExpiresAt: { lte: now },
      },
      data: { leaseExpiresAt: recoveredLeaseExpiresAt },
    });
    if (recoveredLease.count !== 1) {
      throw new StudyStreamError(409, "学习项目已被其他装置更新，请重新载入", { code: "STALE_STREAM_ITEM" });
    }
    item.leaseExpiresAt = recoveredLeaseExpiresAt;
  }
  // Feedback acknowledgement is read-only and may legitimately be replayed
  // from a checkpoint created before the scored answer's revision was
  // published. The scored action itself remains strict CAS-protected.
  if (item.clientRevision !== input.clientKnownRevision && input.actionKind !== "FEEDBACK_ACK") {
    throw new StudyStreamError(409, "学习项目版本已更新", {
      code: "STALE_STREAM_ITEM",
      clientRevision: item.clientRevision,
    });
  }
  return item;
}

async function insertReceipt(
  tx: StreamTransaction,
  userId: string,
  input: StudyStreamActionInput,
  response: PublicStreamActionResponse,
  outcomeStatus: string,
  outcomeReference: string | null,
): Promise<void> {
  await tx.operationReceipt.create({
    data: {
      userId,
      operationId: input.operationId,
      flowVersion: STUDY_STREAM_FLOW_VERSION,
      actionKind: input.actionKind,
      requestFingerprint: actionFingerprint(input),
      outcomeStatus,
      outcomeReference,
      response: response as unknown as Prisma.InputJsonValue,
    },
  });
}

async function preflightReceipt(
  tx: StreamTransaction,
  userId: string,
  input: StudyStreamActionInput,
): Promise<ActionTransactionResult | null> {
  const receipt = await tx.operationReceipt.findUnique({
    where: { userId_operationId: { userId, operationId: input.operationId } },
    select: { requestFingerprint: true, flowVersion: true, actionKind: true, response: true },
  });
  if (!receipt) return null;
  if (
    receipt.requestFingerprint !== actionFingerprint(input) ||
    receipt.flowVersion !== STUDY_STREAM_FLOW_VERSION ||
    receipt.actionKind !== input.actionKind
  ) {
    throw new StudyStreamError(409, "operationId 已用于不同的学习操作");
  }
  const response = asStoredActionResponse(receipt.response);
  if (!response) throw new StudyStreamError(409, "学习操作回执已损坏，请重新载入");
  return { response, duplicate: true };
}

async function admissionWork(
  tx: StreamTransaction,
  userId: string,
  wordId: string,
  senseId: string | null,
  kind: WorkKind,
  now: Date,
  sourceOperationId: string,
): Promise<AdmissionOutcome> {
  await expireWork(tx, userId, now);
  const activeRows = await tx.evidenceObligation.findMany({
    where: { userId, status: { in: ["PENDING", "LEASED"] }, expiresAt: { gt: now } },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
  });
  const activeRecords = activeRows.flatMap((row) => {
    const record = toWorkRecord(row);
    return record ? [record] : [];
  });
  const times = kind === "EVIDENCE_OBLIGATION"
    ? verificationTimes(now.getTime())
    : { eligibleAt: now.getTime(), expiresAt: now.getTime() + RETRIEVAL_V1_POLICY.maxObligationAgeMs };
  const admitted = admitWork({
    learnerId: userId,
    wordId,
    kind,
    now: now.getTime(),
    eligibleAt: times.eligibleAt,
    sourceOperationId,
    activeWork: activeRecords,
  });
  if (!admitted.admitted || !admitted.record) {
    return {
      disposition: admitted.reason === "debt-cap" ? "debt-cap" : "already-active",
      obligationId: admitted.existing?.id ?? null,
    };
  }
  const obligation = await tx.evidenceObligation.create({
    data: {
      userId,
      wordId,
      senseId,
      kind,
      status: "PENDING",
      sourceOperationId,
      selectionReason: kind === "REMEDIATION" ? "self-forgot-remediation" : "self-recalled-verification",
      policyVersion: RETRIEVAL_V1_POLICY.policyVersion,
      eligibleAt: new Date(admitted.record.eligibleAt),
      expiresAt: new Date(admitted.record.expiresAt),
      activeKey: `${userId}:${kind}:${wordId}`,
    },
  });
  return { disposition: "accepted", obligationId: obligation.id };
}

function nextSessionRevision(item: StreamItemWithRelations & { session: StudySession }): number {
  return Math.max(item.session.revision, item.clientRevision ?? 0) + 1;
}

async function processReveal(
  tx: StreamTransaction,
  userId: string,
  input: StudyStreamActionInput,
  item: StreamItemWithRelations & { session: StudySession },
): Promise<PublicStreamActionResponse> {
  if (item.itemKind !== "LEARNING_CARD" || !item.word) {
    throw new StudyStreamError(409, "只有 Learning Card 可以揭示");
  }
  if (item.usedAt !== null) throw new StudyStreamError(409, "学习项目已经提交");
  if (!item.revealedAt) {
    await tx.studyStreamItem.update({ where: { id: item.id }, data: { revealedAt: new Date() } });
  }
  const answer = learningCardAnswer(item.word);
  if (!answer) throw new StudyStreamError(409, "学习项目内容已失效");
  const response: PublicStreamActionResponse = {
    ok: true,
    operationId: input.operationId,
    actionKind: input.actionKind,
    duplicate: false,
    itemStatus: item.status,
    clientRevision: item.clientRevision ?? 0,
    requiresFeedbackAck: false,
    learningCard: answer,
    nextItem: null,
  };
  await insertReceipt(tx, userId, input, response, "REVEALED", item.id);
  return response;
}

async function processSelfRating(
  tx: StreamTransaction,
  userId: string,
  input: StudyStreamActionInput,
  item: StreamItemWithRelations & { session: StudySession },
): Promise<PublicStreamActionResponse> {
  if (item.itemKind !== "LEARNING_CARD" || !item.word || !item.revealedAt) {
    throw new StudyStreamError(409, "请先揭示 Learning Card 内容");
  }
  if (item.usedAt !== null) throw new StudyStreamError(409, "学习项目已经提交");
  if (!("selfRating" in input.payload) || (input.payload.selfRating !== "selfForgot" && input.payload.selfRating !== "selfRecalled")) {
    throw new StudyStreamError(400, "self-rating 无效");
  }
  const selfRating = input.payload.selfRating as SelfRating;
  const now = new Date();
  if (item.workObligationId) {
    const completedWork = await tx.evidenceObligation.updateMany({
      where: { id: item.workObligationId, status: { in: ["PENDING", "LEASED"] } },
      data: {
        status: "ANSWERED",
        answeredAt: now,
        activeKey: null,
        leaseOwnerSessionId: null,
        leaseExpiresAt: null,
      },
    });
    if (completedWork.count !== 1) throw new StudyStreamError(409, "学习任务已被其他装置完成，请重新载入");
  }
  const review = await tx.review.findUnique({
    where: { userId_wordId: { userId, wordId: item.word.id } },
    select: { repetitions: true },
  });
  const hadObjectiveEvidence = await tx.reviewEvent.count({
    where: {
      userId,
      wordId: item.word.id,
      eventKind: "REVIEW",
      evidenceKind: "OBJECTIVE_PROBE",
      flowVersion: STUDY_STREAM_FLOW_VERSION,
      objectiveEvidenceTargetId: { not: null },
      isHistorical: false,
    },
  }) > 0;
  let admission: AdmissionOutcome = { disposition: "not-required", obligationId: null };
  if (selfRating === "selfRecalled") {
    const required = requiresEvidenceObligation({
      learnerId: userId,
      wordId: item.word.id,
      selfRating,
      repetitions: review?.repetitions ?? 0,
      hadObjectiveEvidence,
      activeWork: [],
      now: now.getTime(),
      sourceOperationId: input.operationId,
    });
    if (required) admission = await admissionWork(tx, userId, item.word.id, item.word.senseId, "EVIDENCE_OBLIGATION", now, input.operationId);
  } else {
    admission = await admissionWork(tx, userId, item.word.id, item.word.senseId, "REMEDIATION", now, input.operationId);
  }

  await checkInStudyDay(userId, tx);
  const newlyUnlocked = await checkAchievements(userId, tx);
  const revision = nextSessionRevision(item);
  await tx.studyEncounter.create({
    data: {
      userId,
      wordId: item.word.id,
      senseId: item.word.senseId,
      streamItemId: item.id,
      operationId: input.operationId,
      selfRating,
      selectionReason: item.selectionReason,
      policyVersion: item.policyVersion,
      requiresVerification: selfRating === "selfRecalled" && admission.disposition === "accepted",
      verificationDisposition: admission.disposition,
      evidenceObligationId: admission.obligationId,
      createdAt: now,
      acknowledgedAt: now,
    },
  });
  await tx.studyStreamItem.update({
    where: { id: item.id },
    data: {
      usedAt: now,
      feedbackAcknowledgedAt: now,
      status: "ACKNOWLEDGED",
      operationId: input.operationId,
      clientRevision: revision,
    },
  });
  await tx.studySession.update({ where: { id: item.session.id }, data: { revision } });
  const response: PublicStreamActionResponse = {
    ok: true,
    operationId: input.operationId,
    actionKind: input.actionKind,
    duplicate: false,
    itemStatus: "ACKNOWLEDGED",
    clientRevision: revision,
    requiresFeedbackAck: false,
    evidenceObligation: {
      created: admission.disposition === "accepted",
      disposition: admission.disposition,
      obligationId: admission.obligationId,
    },
    newlyUnlocked: newlyUnlocked.map((achievement) => achievement.key),
    nextItem: null,
  };
  await insertReceipt(tx, userId, input, response, "ACKNOWLEDGED", item.id);
  return response;
}

async function processObjectiveAnswer(
  tx: StreamTransaction,
  userId: string,
  input: StudyStreamActionInput,
  item: StreamItemWithRelations & { session: StudySession },
): Promise<PublicStreamActionResponse> {
  if (item.itemKind !== "OBJECTIVE_PROBE" || !item.word || !item.objectiveEvidenceTarget || !item.objectiveQuestionSnapshot) {
    throw new StudyStreamError(409, "当前项目不是有效的 Objective Probe");
  }
  if (item.usedAt !== null) throw new StudyStreamError(409, "该客观题已经提交");
  if (!("selectedOptionId" in input.payload) || typeof input.payload.selectedOptionId !== "string") {
    throw new StudyStreamError(400, "选项无效");
  }
  const snapshot = snapshotToData(item.objectiveQuestionSnapshot);
  if (!snapshot) throw new StudyStreamError(409, "客观题快照无效，请重新载入");
  const selectedOptionId = input.payload.selectedOptionId;
  if (!snapshot.options.some((option) => option.id === selectedOptionId)) {
    throw new StudyStreamError(400, "选项不属于当前题目");
  }
  if (item.objectiveEvidenceTarget.status !== "OPEN") {
    throw new StudyStreamError(409, "该客观证据目标已经完成");
  }
  const review = await tx.review.findUnique({
    where: { userId_wordId: { userId, wordId: item.word.id } },
  });
  const expectedRevision = item.objectiveEvidenceTarget.expectedReviewRevision ?? 0;
  const currentRevision = review?.revision ?? 0;
  if (currentRevision !== expectedRevision) {
    throw new StudyStreamError(409, "客观证据目标已过期", {
      code: "STALE_EVIDENCE_TARGET",
      expectedReviewRevision: expectedRevision,
      currentRevision,
    });
  }
  const purpose = item.objectiveEvidenceTarget.purpose as ProbePurpose;
  const isCorrect = selectedOptionId === snapshot.correctOptionId;
  const mapping = mapObjectiveFirstResponse(isCorrect ? "correct" : "wrong", purpose);
  if (!mapping) throw new StudyStreamError(409, "当前客观题目的评分策略无效");
  const quality = mapping.quality as Quality;
  const previous = review
    ? {
        easeFactor: review.easeFactor,
        interval: review.interval,
        repetitions: review.repetitions,
        nextReviewDate: review.nextReviewDate,
        lastReviewedAt: review.lastReviewedAt,
      }
    : createInitialState();
  const nextState = updateSM2(previous, quality);
  const nextRevision = currentRevision + 1;

  const consumedTarget = await tx.objectiveEvidenceTarget.updateMany({
    where: { id: item.objectiveEvidenceTarget.id, status: "OPEN" },
    data: {
      status: "CONSUMED",
      activeKey: null,
      winningOperationId: input.operationId,
      consumedAt: new Date(),
    },
  });
  if (consumedTarget.count !== 1) throw new StudyStreamError(409, "该客观题已经被其他装置提交");

  // The ordinary expand-migration window still has the legacy Review bridge
  // trigger installed. Mark this transaction as the V2 writer before touching
  // Review so the bridge does not append a second, provenance-incomplete event
  // beside the explicit objective-probe ReviewEvent below.
  await tx.$executeRaw`SELECT set_config('app.review_event_writer', 'v2', true)`;

  if (review) {
    const updatedReview = await tx.review.updateMany({
      where: { userId, wordId: item.word.id, revision: currentRevision },
      data: { ...nextState, senseId: item.word.senseId, revision: nextRevision, totalReviews: { increment: 1 } },
    });
    if (updatedReview.count !== 1) throw new StudyStreamError(409, "学习状态已被其他装置更新");
  } else {
    await tx.review.create({
      data: {
        userId,
        wordId: item.word.id,
        senseId: item.word.senseId,
        ...nextState,
        revision: nextRevision,
        totalReviews: 1,
      },
    });
  }

  await checkInStudyDay(userId, tx);
  const newlyUnlocked = await checkAchievements(userId, tx);
  const event = await tx.reviewEvent.create({
    data: {
      operationId: input.operationId,
      userId,
      submittedWordId: item.word.id,
      wordId: item.word.id,
      senseId: item.word.senseId,
      submittedSenseId: item.word.senseId,
      senseKey: item.word.senseKey,
      contentRevisionId: item.word.contentRevisionId,
      catalogRevisionId: item.word.catalogRevisionId,
      wordTerm: item.word.term,
      wordLevel: item.word.level,
      eventKind: "REVIEW",
      quality,
      newlyUnlockedKeys: newlyUnlocked.map((achievement) => achievement.key),
      isHistorical: false,
      evidenceKind: "OBJECTIVE_PROBE",
      flowVersion: STUDY_STREAM_FLOW_VERSION,
      qualityPolicyVersion: mapping.qualityPolicyVersion,
      probePurpose: purpose,
      itemConstructionVersion: snapshot.itemConstructionVersion,
      objectiveEvidenceTargetId: item.objectiveEvidenceTarget.id,
      objectiveQuestionSnapshotId: item.objectiveQuestionSnapshot.id,
    },
  });
  await tx.objectiveEvidenceTarget.update({
    where: { id: item.objectiveEvidenceTarget.id },
    data: { winningReviewEventId: event.id },
  });
  if (item.objectiveEvidenceTarget.obligationId) {
    await tx.evidenceObligation.update({
      where: { id: item.objectiveEvidenceTarget.obligationId },
      data: {
        status: "ANSWERED",
        activeKey: null,
        answeredAt: new Date(),
        leaseOwnerSessionId: null,
        leaseExpiresAt: null,
      },
    });
  }
  if (!isCorrect) {
    await admissionWork(tx, userId, item.word.id, item.word.senseId, "REMEDIATION", new Date(), input.operationId);
  }

  const now = new Date();
  const itemRevision = nextSessionRevision(item);
  await tx.studyStreamItem.update({
    where: { id: item.id },
    data: {
      usedAt: now,
      status: "ANSWERED",
      operationId: input.operationId,
      clientRevision: itemRevision,
    },
  });
  await tx.studySession.update({ where: { id: item.session.id }, data: { revision: itemRevision } });
  const response: PublicStreamActionResponse = {
    ok: true,
    operationId: input.operationId,
    actionKind: input.actionKind,
    duplicate: false,
    itemStatus: "ANSWERED",
    clientRevision: itemRevision,
    requiresFeedbackAck: true,
    feedback: {
      selectedOptionId,
      correctOptionId: snapshot.correctOptionId,
      quality,
      isCorrect,
      acknowledged: false,
    },
    newlyUnlocked: newlyUnlocked.map((achievement) => achievement.key),
    nextItem: null,
  };
  await insertReceipt(tx, userId, input, response, "SCORED", event.id);
  return response;
}

async function processFeedbackAck(
  tx: StreamTransaction,
  userId: string,
  input: StudyStreamActionInput,
  item: StreamItemWithRelations & { session: StudySession },
): Promise<PublicStreamActionResponse> {
  if (item.itemKind !== "OBJECTIVE_PROBE" || item.usedAt === null || !item.operationId) {
    throw new StudyStreamError(409, "当前项目没有可确认的 feedback");
  }
  if (item.feedbackAcknowledgedAt !== null) {
    throw new StudyStreamError(409, "feedback 已确认");
  }
  const feedback = await receiptFeedback(tx, userId, item.operationId, true);
  if (!feedback) throw new StudyStreamError(409, "客观题 feedback 回执已损坏");
  const now = new Date();
  const revision = nextSessionRevision(item);
  await tx.studyStreamItem.update({
    where: { id: item.id },
    data: { feedbackAcknowledgedAt: now, status: "ACKNOWLEDGED", clientRevision: revision },
  });
  await tx.studySession.update({ where: { id: item.session.id }, data: { revision } });
  const response: PublicStreamActionResponse = {
    ok: true,
    operationId: input.operationId,
    actionKind: input.actionKind,
    duplicate: false,
    itemStatus: "ACKNOWLEDGED",
    clientRevision: revision,
    requiresFeedbackAck: false,
    feedback,
    nextItem: null,
  };
  await insertReceipt(tx, userId, input, response, "ACKNOWLEDGED", item.id);
  return response;
}

async function applyStudyStreamActionTx(
  userId: string,
  input: StudyStreamActionInput,
  options: {
    recoverExpiredSession?: boolean;
    recoverExpiredCredential?: boolean;
    recoverExpiredLease?: boolean;
  } = {},
): Promise<ActionTransactionResult> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await lockStreamUser(tx, userId);
          const replay = await preflightReceipt(tx, userId, input);
          if (replay) return replay;
          const item = await loadActionItem(tx, userId, input, new Date(), options);
          let response: PublicStreamActionResponse;
          if (input.actionKind === "REVEAL") response = await processReveal(tx, userId, input, item);
          else if (input.actionKind === "SELF_RATING") response = await processSelfRating(tx, userId, input, item);
          else if (input.actionKind === "OBJECTIVE_ANSWER") response = await processObjectiveAnswer(tx, userId, input, item);
          else response = await processFeedbackAck(tx, userId, input, item);
          return { response, duplicate: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const retryable = isRetryableTransactionConflict(error) || (
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
      );
      if (!retryable || attempt === MAX_TRANSACTION_ATTEMPTS) throw error;
      await waitForTransactionRetry(attempt - 1);
    }
  }
  throw new Error("Study action transaction retry exhausted");
}

export async function applyStudyStreamAction(
  userId: string,
  input: StudyStreamActionInput,
): Promise<ActionTransactionResult> {
  return applyStudyStreamActionTx(userId, input);
}

/**
 * Explicit recovery path for a durable outbox action whose session, item
 * credential or lease expired while the browser was offline or backgrounded.
 * The normal action route remains fail-closed; this path only recovers a
 * non-revoked session/item after the same server-issued credential lineage
 * and typed operation have been revalidated in the same Serializable
 * transaction.
 */
export async function recoverExpiredStudyStreamAction(
  userId: string,
  input: StudyStreamActionInput,
): Promise<ActionTransactionResult> {
  return applyStudyStreamActionTx(userId, input, {
    recoverExpiredSession: true,
    recoverExpiredCredential: true,
    recoverExpiredLease: true,
  });
}

export interface RenewStudyStreamCredentialInput {
  studySessionId: string;
  streamItemId: string;
  itemCredential: string;
  clientKnownRevision: number;
}

export interface RenewStudyStreamCredentialResult {
  ok: true;
  streamItemId: string;
  itemCredential: string;
  credentialExpiresAt: string;
  item: PublicStreamItemBase;
}

export async function renewStudyStreamCredential(
  userId: string,
  input: RenewStudyStreamCredentialInput,
): Promise<RenewStudyStreamCredentialResult> {
  return prisma.$transaction(
    async (tx) => {
      const now = new Date();
      await lockStreamUser(tx, userId);
      const item = await tx.studyStreamItem.findFirst({
        where: {
          id: input.streamItemId,
          sessionId: input.studySessionId,
        },
        include: {
          word: true,
          objectiveEvidenceTarget: true,
          objectiveQuestionSnapshot: true,
          session: true,
        },
      });
      if (!item || item.session.userId !== userId || item.session.flowVersion !== STUDY_STREAM_FLOW_VERSION) {
        throw new StudyStreamError(404, "学习凭证继承链已失效");
      }
      if (item.session.retiredAt !== null || item.session.expiresAt <= now) {
        throw new StudyStreamError(403, "学习 session 已过期或已撤销");
      }
      if (!acceptsCredential(item, input.itemCredential, now)) {
        throw new StudyStreamError(403, "学习项目凭证无效或已过期");
      }
      if (item.clientRevision !== input.clientKnownRevision) {
        throw new StudyStreamError(409, "学习项目版本已更新", { code: "STALE_STREAM_ITEM" });
      }
      if (item.feedbackAcknowledgedAt !== null) {
        throw new StudyStreamError(409, "该学习项目已经完成");
      }
      const credential = createStudyStreamCredential();
      const expiresAt = new Date(now.getTime() + STUDY_STREAM_CREDENTIAL_TTL_MS);
      const updated = await tx.studyStreamItem.update({
        where: { id: item.id },
        data: {
          credentialDigest: digestStudyStreamCredential(credential),
          credentialExpiresAt: expiresAt,
          credentialLineage: rotatedCredentialLineage(
            item,
            digestStudyStreamCredential(credential),
            now,
            expiresAt,
            digestStudyStreamCredential(input.itemCredential),
          ),
          leaseExpiresAt: new Date(now.getTime() + STREAM_ITEM_LEASE_MS),
        },
        include: {
          word: true,
          objectiveEvidenceTarget: true,
          objectiveQuestionSnapshot: true,
        },
      });
      const feedback = updated.usedAt
        ? await receiptFeedback(tx, userId, updated.operationId, updated.feedbackAcknowledgedAt !== null)
        : null;
      const publicItem = toPublicItem(updated, credential, feedback);
      if (!publicItem) throw new StudyStreamError(409, "学习项目已失效");
      return {
        ok: true,
        streamItemId: updated.id,
        itemCredential: credential,
        credentialExpiresAt: expiresAt.toISOString(),
        item: publicItem,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
