import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
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
  RETRIEVAL_V2_POLICY,
  isSupportedLearningPolicy,
  type LearningPolicyVersion,
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
  legacyActionFingerprint,
  STUDY_STREAM_CREDENTIAL_TTL_MS,
  STUDY_STREAM_FLOW_VERSION,
  type PublicStreamActionResponse,
  type PublicStreamItemBase,
  type PublicStreamResponse,
  type StudyStreamActionReconciliation,
  type PublicStreamUnitSummary,
  type StudyStreamActionInput,
} from "@/lib/study-stream/contracts";
import {
  recentStreamShape,
} from "@/lib/study-stream/history";
export {
  compareNewWordCandidates,
  newWordSelectionReason,
  recentStreamShape,
} from "@/lib/study-stream/history";
import {
  isRetryableTransactionConflict,
  waitForTransactionRetry,
} from "@/lib/transaction-retry";
import {
  eligibleOperationalObjectiveEventWhere,
  isEligibleOperationalObjectiveEvent,
  withCurrentCatalogWord,
} from "@/lib/catalog/runtime";

const STREAM_SESSION_TTL_MS = 30 * 60_000;
const STREAM_ITEM_LEASE_MS = 15 * 60_000;
const MAX_TRANSACTION_ATTEMPTS = 5;
const MAX_CANDIDATES = 80;
const MAX_CREDENTIAL_LINEAGE_GRANTS = 8;
const STUDY_STREAM_RECOVERY_TOKEN_PREFIX = "study-stream-recovery-v1:";
const LOCAL_STUDY_STREAM_RECOVERY_SECRET = "local-study-stream-recovery-secret";

type StreamTransaction = Prisma.TransactionClient;

function studyStreamRecoverySecret(): string {
  const configured = process.env.STUDY_STREAM_RECOVERY_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    process.env.AUTH_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("STUDY_STREAM_RECOVERY_SECRET_MISSING");
  }
  return LOCAL_STUDY_STREAM_RECOVERY_SECRET;
}

/**
 * Create a stable, server-owned recovery proof for one opaque stream item.
 * The proof is intentionally separate from the short-lived credential and
 * from action fingerprints. The recovery endpoint still checks the
 * authenticated account, exact session/item tuple, operation identity and
 * terminal/revocation state before accepting it.
 */
export function createStudyStreamRecoveryCredential(streamItemId: string): string {
  return createHmac("sha256", studyStreamRecoverySecret())
    .update(STUDY_STREAM_RECOVERY_TOKEN_PREFIX, "utf8")
    .update(streamItemId, "utf8")
    .digest("base64url");
}

function matchesStudyStreamRecoveryCredential(streamItemId: string, supplied: string | null | undefined): boolean {
  if (!supplied) return false;
  const expected = Buffer.from(createStudyStreamRecoveryCredential(streamItemId), "utf8");
  const actual = Buffer.from(supplied, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

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

export type StudyStreamRecoveryPreparation =
  | {
      ok: true;
      terminal: false;
      recoveryCredential: string;
    }
  | {
      ok: true;
      terminal: true;
      code: TerminalActionConflict["code"] | "FEEDBACK_ALREADY_ACKNOWLEDGED";
      message: string;
    };

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
  if (rows.length !== 1) throw new StudyStreamError(403, "學習帳戶不存在或已失效");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCredentialDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function parseCredentialLineage(value: Prisma.JsonValue | null): CredentialGrant[] {
  if (!Array.isArray(value)) return [];
  const parsed = value.flatMap((entry) => {
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
  });
  if (parsed.length <= MAX_CREDENTIAL_LINEAGE_GRANTS) return parsed;
  // Keep the original grant as a durable recovery anchor and bound the rest
  // to the newest grants. A device that was offline through many rotations can
  // still prove the item it originally received without making the lineage an
  // unbounded JSON log.
  const [root, ...recent] = parsed;
  return [root, ...recent.slice(-(MAX_CREDENTIAL_LINEAGE_GRANTS - 1))];
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
  // validation still checks grant expiry; the explicit recovery path for an
  // unresolved item uses only this digest match after it has revalidated the
  // owning user, item, session and typed operation. A completed item can
  // converge through its authoritative terminal state even after a
  // predecessor is evicted; unresolved rows still rebind through a current
  // credential rather than bypassing this check.
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
  const grants = [...unique.values()];
  const [root, ...recent] = grants;
  return [root, ...recent.slice(-(MAX_CREDENTIAL_LINEAGE_GRANTS - 1))] as unknown as Prisma.InputJsonValue;
}

function matchesCredentialDigest(
  item: StudyStreamItem,
  suppliedCredential: string,
  includeParentDigests = false,
): boolean {
  const digest = digestStudyStreamCredential(suppliedCredential);
  return digest === item.credentialDigest || parseCredentialLineage(item.credentialLineage)
    .some((grant) => grant.digest === digest || (includeParentDigests && grant.parentDigest === digest));
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

type TerminalActionConflict = {
  code: "SUPERSEDED_STREAM_ITEM" | "STREAM_ITEM_COMPLETED" | "OBJECTIVE_TARGET_CONSUMED";
  message: string;
};

/**
 * A durable item state can outlive the short credential lineage retained on
 * the row. Once the server has recorded a terminal outcome, an old device
 * must be able to converge on that outcome without presenting a bearer
 * digest which has already fallen out of the bounded lineage. This helper is
 * deliberately limited to actions whose outcome is already authoritative;
 * an unconsumed item still requires a valid credential (and may use the
 * explicit bounded recovery path instead).
 */
function terminalActionConflict(
  item: StudyStreamItem,
  actionKind: StudyStreamActionInput["actionKind"],
): TerminalActionConflict | null {
  if (item.status === "SUPERSEDED") {
    return {
      code: "SUPERSEDED_STREAM_ITEM",
      message: "學習項目已由其他裝置完成",
    };
  }
  if (
    item.itemKind === "LEARNING_CARD" &&
    item.usedAt !== null &&
    (actionKind === "REVEAL" || actionKind === "SELF_RATING")
  ) {
    return {
      code: "STREAM_ITEM_COMPLETED",
      message: "學習項目已由其他操作完成",
    };
  }
  if (
    item.itemKind === "OBJECTIVE_PROBE" &&
    item.usedAt !== null &&
    actionKind === "OBJECTIVE_ANSWER"
  ) {
    return {
      code: "OBJECTIVE_TARGET_CONSUMED",
      message: "該客觀題已由其他操作完成",
    };
  }
  return null;
}

function isCompletedFeedbackReplay(
  item: StudyStreamItem,
  actionKind: StudyStreamActionInput["actionKind"],
): boolean {
  return actionKind === "FEEDBACK_ACK" &&
    item.itemKind === "OBJECTIVE_PROBE" &&
    item.usedAt !== null &&
    item.feedbackAcknowledgedAt !== null &&
    item.operationId !== null &&
    item.status === "ACKNOWLEDGED";
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
      category: key.slice(separator + 2) === "未分類" ? null : key.slice(separator + 2),
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
    throw new StudyStreamError(400, "學習模式無效");
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
    if (!unlocked.has(key)) throw new StudyStreamError(403, "該單元尚未解鎖");
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
  policyVersion?: string;
}): WorkRecord | null {
  if (!row.wordId) return null;
  return {
    id: row.id,
    learnerId: row.userId,
    wordId: row.wordId,
    senseId: row.senseId,
    policyVersion: isSupportedLearningPolicy(row.policyVersion) ? row.policyVersion : "retrieval-v1",
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
  const expired = await tx.evidenceObligation.findMany({
    where: {
      userId,
      status: { in: ["PENDING", "LEASED"] },
      expiresAt: { lte: now },
    },
    select: { id: true },
  });
  if (expired.length === 0) return;
  const expiredIds = expired.map((row) => row.id);
  await tx.evidenceObligation.updateMany({
    where: { id: { in: expiredIds }, status: { in: ["PENDING", "LEASED"] }, expiresAt: { lte: now } },
    data: { status: "EXPIRED", activeKey: null, terminalReason: "age-limit" },
  });
  // A terminal obligation must not leave an apparently live Learning Card
  // behind. Mark the unused presentation in the same transaction so a later
  // GET cannot return a card whose reveal/self-rating is guaranteed to fail.
  await tx.studyStreamItem.updateMany({
    where: {
      workObligationId: { in: expiredIds },
      usedAt: null,
      status: "LEASED",
    },
    data: { status: "SUPERSEDED" },
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
    // Filtered presentation rows can occupy the first part of the review
    // index (for example an already leased target). Read a bounded surplus
    // before applying application-level admission checks so legal candidates
    // are not starved behind stale rows.
    take: MAX_CANDIDATES * 8,
  });
  return rows.flatMap((row) => {
    const work = toWorkRecord(row);
    return work ? [work] : [];
  });
}

type LearnerStreamHistory = {
  acknowledged: Array<{
    itemKind: string;
    usedAt: Date | null;
    feedbackAcknowledgedAt: Date | null;
    wordId: string | null;
    acknowledgedAt: Date;
    id: string;
  }>;
  recentWordIds: string[];
  contactTimes: Map<string, number>;
};

async function learnerStreamHistory(
  tx: StreamTransaction,
  userId: string,
  scope: StreamScope,
): Promise<LearnerStreamHistory> {
  // Learning Card acknowledgement is recorded as a durable encounter. It is
  // deliberately queried independently from the short-lived stream item so a
  // later credential renewal cannot change the historical ordering.
  const encounters = await tx.studyEncounter.findMany({
    where: {
      wordId: { not: null },
      userId,
      streamItem: {
        itemKind: "LEARNING_CARD",
        session: { userId, flowVersion: STUDY_STREAM_FLOW_VERSION },
      },
    },
    orderBy: [{ acknowledgedAt: "desc" }, { id: "desc" }],
    take: 80,
    select: { id: true, wordId: true, acknowledgedAt: true },
  });
  // Objective probes do not create StudyEncounter rows. Their feedback
  // acknowledgement is the durable completion timestamp for spacing and
  // consecutive-probe policy. Scope is intentionally learner-wide: a new
  // short session or switching global/unit views must not reset fatigue rules.
  const probes = await tx.studyStreamItem.findMany({
    where: {
      wordId: { not: null },
      itemKind: "OBJECTIVE_PROBE",
      usedAt: { not: null },
      feedbackAcknowledgedAt: { not: null },
      session: { userId, flowVersion: STUDY_STREAM_FLOW_VERSION },
    },
    orderBy: [{ feedbackAcknowledgedAt: "desc" }, { id: "desc" }],
    take: 80,
    select: { id: true, wordId: true, usedAt: true, feedbackAcknowledgedAt: true },
  });
  const acknowledged = [
    ...encounters.map((row) => ({
      id: row.id,
      itemKind: "LEARNING_CARD",
      usedAt: row.acknowledgedAt,
      feedbackAcknowledgedAt: row.acknowledgedAt,
      wordId: row.wordId,
      acknowledgedAt: row.acknowledgedAt,
    })),
    ...probes.flatMap((row) => row.feedbackAcknowledgedAt
      ? [{
          id: row.id,
          itemKind: "OBJECTIVE_PROBE",
          usedAt: row.usedAt,
          feedbackAcknowledgedAt: row.feedbackAcknowledgedAt,
          wordId: row.wordId,
          acknowledgedAt: row.feedbackAcknowledgedAt,
        }]
      : []),
  ].sort((left, right) => right.acknowledgedAt.getTime() - left.acknowledgedAt.getTime() || right.id.localeCompare(left.id)).slice(0, 40);
  const contacts = await tx.studyEncounter.findMany({
    where: { userId, wordId: { not: null }, word: scope.where },
    orderBy: [{ acknowledgedAt: "asc" }, { id: "asc" }],
    take: MAX_CANDIDATES * 8,
    select: { wordId: true, acknowledgedAt: true },
  });
  const contactTimes = new Map<string, number>();
  for (const row of contacts) {
    if (row.wordId && !contactTimes.has(row.wordId)) contactTimes.set(row.wordId, row.acknowledgedAt.getTime());
  }
  return {
    acknowledged,
    recentWordIds: acknowledged
      .slice(0, RETRIEVAL_V1_POLICY.minInterveningItems)
      .flatMap((row) => row.wordId ? [row.wordId] : []),
    contactTimes,
  };
}

function candidateForWork(
  row: WorkRecord,
  mode: StreamMode,
): CandidateRecord {
  const remediation = row.kind === "REMEDIATION";
  return {
    policyVersion: row.policyVersion,
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

/** 新發卡政策。所有資料均在既有 learner lock／Serializable transaction 內讀寫。 */
async function buildV2Candidates(
  tx: StreamTransaction, userId: string, scope: StreamScope, now: Date,
) {
  await expireWork(tx, userId, now);
  const history = await learnerStreamHistory(tx, userId, scope);
  const words = await tx.word.findMany({ where: scope.where, select: { id: true, senseId: true, term: true } });
  const reviews = await tx.review.findMany({ where: { userId, word: scope.where } });
  const reviewByWord = new Map(reviews.map(r => [r.wordId, r]));
  const contacts = await tx.studyEncounter.findMany({
    where: { userId, wordId: { not: null }, word: scope.where },
    orderBy: [{ acknowledgedAt: "desc" }, { id: "desc" }], distinct: ["wordId"],
    select: { wordId: true, selfRating: true, acknowledgedAt: true, operationId: true },
  });
  const contactByWord = new Map(contacts.map(c => [c.wordId, c]));
  const exposures = await tx.studyStreamItem.groupBy({
    by: ["wordId"], where: { session: { userId }, wordId: { not: null } },
    _max: { revealedAt: true, usedAt: true, feedbackAcknowledgedAt: true },
  });
  const lastExposure = new Map(exposures.map(e => [e.wordId, Math.max(
    e._max.revealedAt?.getTime() ?? 0, e._max.usedAt?.getTime() ?? 0,
    e._max.feedbackAcknowledgedAt?.getTime() ?? 0,
  )]));
  const pendingRows = await tx.evidenceObligation.findMany({
    where: { userId, status: { in: ["PENDING", "LEASED"] }, expiresAt: { gt: now } },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
  });
  const pending = pendingRows.flatMap(r => { const w = toWorkRecord(r); return w ? [w] : []; });
  const reserved = await tx.studyStreamItem.findMany({
    where: { session: { userId, retiredAt: null }, status: "LEASED", usedAt: null, workObligationId: null, OR: [{ itemKind: "LEARNING_CARD" }, { session: { expiresAt: { gt: now } } }] },
    orderBy: { createdAt: "asc" },
    select: { wordId: true, session: { select: { mode: true, scopeLevel: true, scopeCategory: true } } },
  });
  const workWords = new Set(pending.map(w => w.wordId));
  const reservedWords = new Set(reserved.flatMap(r => r.wordId && !workWords.has(r.wordId) ? [r.wordId] : []));
  const cancelledRows = await tx.evidenceObligation.findMany({ where: { userId, status: { in: ["CANCELLED", "SUPERSEDED"] } }, select: { sourceOperationId: true } });
  const cancelledSources = new Set(cancelledRows.map(w => w.sourceOperationId));
  let capacity = Math.max(0, 5 - pending.length - reservedWords.size);
  // 舊 cap／expired 接觸也有可追蹤的後續，不需重看答案再等十分鐘。
  for (const c of [...contacts].reverse()) {
    if (cancelledSources.has(c.operationId) || !capacity || !c.wordId || workWords.has(c.wordId) || reservedWords.has(c.wordId)) continue;
    const review = reviewByWord.get(c.wordId);
    if (review && (c.selfRating !== "selfForgot" || (review.lastReviewedAt?.getTime() ?? 0) >= c.acknowledgedAt.getTime())) continue;
    const word = words.find(w => w.id === c.wordId);
    if (!word) continue;
    const kind = c.selfRating === "selfForgot" ? "REMEDIATION" : "EVIDENCE_OBLIGATION";
    const admitted = await admissionWork(tx, userId, word.id, word.senseId, kind, now,
      c.operationId, "retrieval-v2", new Date(Math.max(c.acknowledgedAt.getTime(), lastExposure.get(word.id) ?? 0) + 600_000));
    if (admitted.disposition === "accepted") { capacity--; workWords.add(word.id); }
  }
  // 客觀答錯的合法舊遲交也可能曾因容量延後補救，從 scored ledger 恢復需求。
  const failed = await tx.reviewEvent.findMany({
    where: { userId, word: scope.where, quality: 2, evidenceKind: "OBJECTIVE_PROBE", isHistorical: false },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], distinct: ["wordId"],
    select: { wordId: true, createdAt: true, operationId: true },
  });
  for (const event of failed) {
    if (cancelledSources.has(event.operationId) || !capacity || !event.wordId || workWords.has(event.wordId) || reservedWords.has(event.wordId)) continue;
    const review = reviewByWord.get(event.wordId);
    const contact = contactByWord.get(event.wordId);
    if (!review || review.repetitions !== 0 || (review.lastReviewedAt?.getTime() ?? 0) > event.createdAt.getTime() + 1000 || (contact?.acknowledgedAt.getTime() ?? 0) > event.createdAt.getTime()) continue;
    const word = words.find(w => w.id === event.wordId);
    if (!word) continue;
    const admitted = await admissionWork(tx, userId, word.id, word.senseId, "REMEDIATION", now,
      event.operationId, "retrieval-v2", new Date(Math.max(event.createdAt.getTime(), lastExposure.get(word.id) ?? 0) + 600_000));
    if (admitted.disposition === "accepted") { capacity--; workWords.add(word.id); }
  }
  const active = await activeWork(tx, userId, scope, now);
  const candidates: CandidateRecord[] = [];
  const waits: number[] = [];
  for (const work of active) {
    const exposure = lastExposure.get(work.wordId) ?? 0;
    const eligibleAt = Math.max(work.eligibleAt, exposure + 600_000);
    if (eligibleAt > now.getTime()) { waits.push(eligibleAt); continue; }
    candidates.push({ ...candidateForWork(work, scope.mode), eligibleAt });
  }
  for (const row of pending) if (row.eligibleAt > now.getTime()) waits.push(row.eligibleAt);
  const ordered = [...words].sort((a,b) =>
    (contactByWord.get(a.id)?.acknowledgedAt.getTime() ?? 0) - (contactByWord.get(b.id)?.acknowledgedAt.getTime() ?? 0)
    || a.term.localeCompare(b.term) || a.id.localeCompare(b.id));
  for (const word of ordered) {
    if (workWords.has(word.id) || reservedWords.has(word.id)) continue;
    const review = reviewByWord.get(word.id);
    if (review && review.nextReviewDate > now) continue;
    const exposure = lastExposure.get(word.id) ?? 0;
    if (exposure + 600_000 > now.getTime()) { waits.push(exposure + 600_000); continue; }
    if (!capacity) continue;
    // 每次只發一張；容量在下一次 transaction 根據 work＋未提交 item 重算。
    candidates.push({ id: `v2:${word.id}`, wordId: word.id, senseId: word.senseId,
      kind: review ? "OBJECTIVE_PROBE" : "LEARNING_CARD", purpose: review ? "DUE_REVIEW" : undefined,
      eligibleAt: review?.nextReviewDate.getTime(), selectionPriority: candidates.length,
      policyVersion: "retrieval-v2", mode: scope.mode, selectionReason: review ? "due-review" : "new-word" });
  }
  const lastProbeAt = history.acknowledged.find(r => r.itemKind === "OBJECTIVE_PROBE")?.acknowledgedAt.getTime();
  if (lastProbeAt !== undefined && recentStreamShape(history.acknowledged).consecutiveProbes >= 2 && candidates.some(c => c.kind === "OBJECTIVE_PROBE") && now.getTime() < lastProbeAt + 60_000) waits.push(lastProbeAt + 60_000);
  const lastNew = await tx.studyEncounter.findFirst({
    where: { userId, selectionReason: "new-word" }, orderBy: { acknowledgedAt: "desc" }, select: { acknowledgedAt: true },
  });
  const itemsSinceNewWord = history.acknowledged.filter(r => r.acknowledgedAt.getTime() > (lastNew?.acknowledgedAt.getTime() ?? 0)).length;
  const r = reserved[0];
  const resumePath = r ? (r.session.mode === "unit"
    ? `/study?${new URLSearchParams({ mode: "unit", level: r.session.scopeLevel ?? "A1", category: r.session.scopeCategory ?? "未分類" })}` : "/study") : undefined;
  return { candidates, active, history, lastProbeAt, itemsSinceNewWord, availability: {
    state: (pending.length || reserved.length || waits.length ? "waiting" : "no-content") as "waiting" | "no-content",
    reason: reserved.length ? "other-scope" : !capacity ? "capacity" : "cooldown",
    nextEligibleAt: waits.length ? new Date(Math.min(...waits)).toISOString() : null,
    ...(resumePath ? { resumePath } : {}),
  } };
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

async function objectiveEventProvenance(
  tx: StreamTransaction,
  item: StreamItemWithRelations & { session: StudySession },
  snapshot: ObjectiveQuestionSnapshot,
): Promise<{
  contentRevisionId: string | null;
  catalogRevisionId: string | null;
  wordTerm: string;
  wordLevel: Word["level"];
}> {
  // The question snapshot is the source of truth for what the learner saw.
  // Resolve the level from its immutable content revision rather than the
  // mutable Word projection, which may have advanced while this item waited.
  let wordLevel = item.word!.level;
  if (snapshot.contentRevisionId) {
    const revision = await tx.wordSenseRevision.findUnique({
      where: { id: snapshot.contentRevisionId },
      select: { level: true },
    });
    if (!revision) {
      throw new StudyStreamError(409, "客觀題內容版本已不存在，請重新載入", {
        code: "OBJECTIVE_SNAPSHOT_REVISION_MISSING",
      });
    }
    wordLevel = revision.level;
  }
  return {
    contentRevisionId: snapshot.contentRevisionId,
    catalogRevisionId: snapshot.catalogRevisionId,
    wordTerm: snapshot.wordTerm,
    wordLevel,
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
    selectionOverrideReason: row.selectionOverrideReason,
    itemCredential: credential,
    credentialExpiresAt: row.credentialExpiresAt.toISOString(),
    recoveryCredential: createStudyStreamRecoveryCredential(row.id),
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

/**
 * A scored Objective Probe owns a read-only feedback acknowledgement until
 * the learner confirms it. That acknowledgement must survive rotation of the
 * short-lived session that delivered the question. Only a non-revoked V2
 * session for the exact requested scope can be considered; the question is
 * never made scorable again because `usedAt` remains non-null.
 */
async function getPendingFeedbackItem(
  tx: StreamTransaction,
  userId: string,
  scope: StreamScope,
): Promise<(StreamItemWithRelations & { session: StudySession }) | null> {
  return tx.studyStreamItem.findFirst({
    where: {
      itemKind: "OBJECTIVE_PROBE",
      status: "ANSWERED",
      usedAt: { not: null },
      feedbackAcknowledgedAt: null,
      operationId: { not: null },
      objectiveQuestionSnapshotId: { not: null },
      objectiveEvidenceTarget: { userId },
      session: {
        userId,
        flowVersion: STUDY_STREAM_FLOW_VERSION,
        mode: scope.mode,
        scopeLevel: scope.level,
        scopeCategory: scope.category,
        // Expiry is intentionally not part of this predicate. An expired
        // but non-revoked session is exactly the checkpoint we need to resume
        // for a read-only feedback acknowledgement.
        retiredAt: null,
      },
    },
    orderBy: [{ usedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      word: true,
      objectiveEvidenceTarget: true,
      objectiveQuestionSnapshot: true,
      session: true,
    },
  });
}

async function retireInvalidWorkPresentation(
  tx: StreamTransaction,
  item: StreamItemWithRelations,
): Promise<boolean> {
  if (item.itemKind !== "LEARNING_CARD" || item.usedAt !== null || !item.workObligationId) {
    return false;
  }
  const obligation = await tx.evidenceObligation.findUnique({
    where: { id: item.workObligationId },
    select: { status: true },
  });
  if (obligation && (obligation.status === "PENDING" || obligation.status === "LEASED")) {
    return false;
  }
  const retired = await tx.studyStreamItem.updateMany({
    where: { id: item.id, usedAt: null, status: "LEASED" },
    data: { status: "SUPERSEDED" },
  });
  return retired.count === 1;
}

async function retireInvalidObjectivePresentation(
  tx: StreamTransaction,
  item: StreamItemWithRelations,
  currentReviewRevision: number,
): Promise<boolean> {
  if (
    item.itemKind !== "OBJECTIVE_PROBE" ||
    item.usedAt !== null ||
    !item.objectiveEvidenceTarget
  ) {
    return false;
  }
  const target = item.objectiveEvidenceTarget;
  if (target.status === "OPEN" && target.expectedReviewRevision === currentReviewRevision) {
    return false;
  }

  // A review revision can move forward outside this presentation (for
  // example, another tab answers the same word). Retire every still-leased
  // presentation before creating a target for the new revision so a later
  // GET cannot keep returning a deterministic 409 from the old target.
  await tx.studyStreamItem.updateMany({
    where: {
      objectiveEvidenceTargetId: target.id,
      usedAt: null,
      status: "LEASED",
    },
    data: { status: "SUPERSEDED" },
  });
  if (target.status === "OPEN") {
    await tx.objectiveEvidenceTarget.update({
      where: { id: target.id },
      data: { status: "CANCELLED", activeKey: null, obligationId: null },
    });
  }
  return true;
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
      OR: [{ expiresAt: { gt: now } }, { streamItems: { some: { itemKind: "LEARNING_CARD", status: "LEASED", usedAt: null } } }],
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing.expiresAt > now ? existing : tx.studySession.update({ where: { id: existing.id }, data: { expiresAt: new Date(now.getTime() + STREAM_SESSION_TTL_MS) } });
  return tx.studySession.create({
    data: {
      userId,
      queueFingerprint: `retrieval-v2:${scope.mode}:${scope.level ?? ""}:${scope.category ?? ""}`,
      expiresAt: new Date(now.getTime() + STREAM_SESSION_TTL_MS),
      flowVersion: STUDY_STREAM_FLOW_VERSION,
      learningPolicyVersion: RETRIEVAL_V2_POLICY.policyVersion,
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
  if (!word) throw new StudyStreamError(404, "學習詞條不存在");
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
    await tx.studyStreamItem.updateMany({
      where: {
        objectiveEvidenceTargetId: target.id,
        usedAt: null,
        status: "LEASED",
      },
      data: { status: "SUPERSEDED" },
    });
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
        policyVersion: candidate.policyVersion ?? "retrieval-v2",
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
    const built = buildObjectiveQuestion(
      questionWord(word),
      [questionWord(word)],
      `${session.id}:${target.id}:${expectedRevision}`,
    );
    if (!built) throw new StudyStreamError(409, "目前詞條缺少安全的客觀題選項", { code: "NO_VALID_OBJECTIVE_SNAPSHOT" });
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
  selectionOverrideReason?: string,
): Promise<{ item: StreamItemWithRelations; credential: string }> {
  const credential = createStudyStreamCredential();
  const credentialExpiresAt = new Date(now.getTime() + STUDY_STREAM_CREDENTIAL_TTL_MS);
  let targetId: string | null = null;
  let snapshotId: string | null = null;
  if (candidate.workId) {
    // A work obligation is learner-wide, while sessions may be global or
    // unit-scoped. Retire any still-leased presentation from another scope
    // before issuing the new one, so the old tab receives an explicit terminal
    // conflict instead of a generic retryable 409 after the obligation moves.
    await tx.studyStreamItem.updateMany({
      where: {
        workObligationId: candidate.workId,
        sessionId: { not: session.id },
        usedAt: null,
        status: "LEASED",
      },
      data: { status: "SUPERSEDED" },
    });
  }
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
      selectionOverrideReason: selectionOverrideReason ?? null,
      policyVersion: candidate.policyVersion ?? "retrieval-v2",
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
    if (leased.count !== 1) throw new StudyStreamError(409, "學習任務已被其他裝置接手，請重新載入");
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
  const objectiveRecognitionEvents = await tx.reviewEvent.findMany({
    where: { AND: [eligibleOperationalObjectiveEventWhere(), { userId, wordId: { in: wordIds } }] },
    select: {
      id: true,
      operationId: true,
      userId: true,
      submittedWordId: true,
      wordId: true,
      senseId: true,
      contentRevisionId: true,
      catalogRevisionId: true,
      isHistorical: true,
      quality: true,
      evidenceKind: true,
      flowVersion: true,
      qualityPolicyVersion: true,
      itemConstructionVersion: true,
      probePurpose: true,
      objectiveEvidenceTargetId: true,
      objectiveQuestionSnapshotId: true,
      objectiveEvidenceTarget: {
        select: {
          id: true,
          userId: true,
          wordId: true,
          senseId: true,
          policyVersion: true,
          itemConstructionVersion: true,
          status: true,
          purpose: true,
          winningOperationId: true,
          winningReviewEventId: true,
          obligation: { select: { status: true } },
          questionSnapshot: {
            select: {
              id: true,
              targetId: true,
              wordId: true,
              senseId: true,
              contentRevisionId: true,
              catalogRevisionId: true,
              contentVersion: true,
              itemConstructionVersion: true,
            },
          },
        },
      },
    },
  });
  const objectiveRecognitionCount = objectiveRecognitionEvents.filter((event) =>
    isEligibleOperationalObjectiveEvent({ ...event, eventKind: "REVIEW" }),
  ).length;
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
          // Expire learner-wide work before resuming the current item. This
          // also retires any unused Learning Card tied to an expired
          // obligation, preventing a deterministic terminal 409 loop.
          await expireWork(tx, userId, now);
          let current = await getCurrentItem(tx, session.id);
          while (current && await retireInvalidWorkPresentation(tx, current)) {
            current = await getCurrentItem(tx, session.id);
          }
          if (current?.itemKind === "OBJECTIVE_PROBE" && current.usedAt === null && current.word) {
            const review = await tx.review.findUnique({
              where: { userId_wordId: { userId, wordId: current.word.id } },
              select: { revision: true },
            });
            const currentReviewRevision = review?.revision ?? 0;
            if (await retireInvalidObjectivePresentation(tx, current, currentReviewRevision)) {
              current = null;
            }
          }

          // A scored question may outlive the short-lived session that first
          // delivered it. Restore its authoritative, read-only feedback
          // before returning another current item or scheduling a fresh one,
          // so a learner never skips feedback or receives a card that will
          // immediately be rejected as stale.
          const pendingFeedback = await getPendingFeedbackItem(tx, userId, scope);
          if (pendingFeedback) {
            const ensured = await ensureCredential(tx, pendingFeedback, options.itemCredential, now);
            const feedback = await receiptFeedback(
              tx,
              userId,
              ensured.item.operationId,
              false,
            );
            if (!feedback) throw new StudyStreamError(409, "客觀題 feedback 回執已損壞");
            const item = toPublicItem(ensured.item, ensured.credential, feedback);
            if (!item) throw new StudyStreamError(409, "學習項目已失效，請重新載入");
            return streamResponse(pendingFeedback.session, item, true, unitSummary);
          }
          if (current) {
            const ensured = await ensureCredential(tx, current, options.itemCredential, now);
            const feedback = ensured.item.usedAt
              ? await receiptFeedback(tx, userId, ensured.item.operationId, ensured.item.feedbackAcknowledgedAt !== null)
              : null;
            const item = toPublicItem(ensured.item, ensured.credential, feedback);
            if (!item) throw new StudyStreamError(409, "學習項目已失效，請重新載入");
            return streamResponse(
              session,
              item,
              ensured.item.itemKind === "OBJECTIVE_PROBE" && ensured.item.usedAt !== null,
              unitSummary,
            );
          }

          const built = await buildV2Candidates(tx, userId, scope, now);
          const shape = recentStreamShape(built.history.acknowledged);
          const excluded = new Set<string>();
          for (let selectionAttempt = 0; selectionAttempt < built.candidates.length; selectionAttempt += 1) {
            const candidates = built.candidates.filter((candidate) => !excluded.has(candidate.id));
            const decision = selectNextItem({
              mode: scope.mode,
              now: now.getTime(),
              consecutiveProbes: shape.consecutiveProbes,
              acknowledgedItemsSinceProbe: shape.acknowledgedItemsSinceProbe,
              hasPreviousProbe: shape.hasPreviousProbe,
              lastWordId: built.history.recentWordIds[0] ?? null,
              recentWordIds: built.history.recentWordIds,
              activeWork: built.active,
              candidates,
              lastProbeAt: built.lastProbeAt,
              itemsSinceNewWord: built.itemsSinceNewWord,
            }, RETRIEVAL_V2_POLICY);
            if (!decision.candidate) break;
            try {
              const created = await createStreamItem(
                tx,
                userId,
                session,
                decision.candidate,
                now,
                decision.overrideReason,
              );
              const item = toPublicItem(created.item, created.credential);
              if (!item) throw new StudyStreamError(409, "學習項目已失效，請重新載入");
              return streamResponse(session, item, false, unitSummary);
            } catch (error) {
              if (!(error instanceof StudyStreamError) || error.details.code !== "NO_VALID_OBJECTIVE_SNAPSHOT") throw error;
              excluded.add(decision.candidate.id);
            }
          }
          return { ...streamResponse(session, null, false, unitSummary), availability: built.availability };
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
    recoveryCredential?: string | null;
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
    throw new StudyStreamError(403, "學習項目憑證無效或不屬於目前帳戶");
  }
  const completionConflict = terminalActionConflict(item, input.actionKind);
  const completedFeedbackReplay = isCompletedFeedbackReplay(item, input.actionKind);
  const credentialMatches = matchesCredentialDigest(item, input.itemCredential);
  const recoveryCredentialMatches = matchesStudyStreamRecoveryCredential(
    item.id,
    options.recoveryCredential,
  );
  // Action routes remain bearer-credential protected. A terminal item's
  // authoritative state is reconciled through the separate read-only status
  // path below; never let an unknown credential reach an action processor.
  // The item-bound proof is accepted only by the explicit recovery path and
  // never by the ordinary action route.
  if (!credentialMatches && !(
    options.recoverExpiredCredential && recoveryCredentialMatches
  )) {
    throw new StudyStreamError(403, "學習項目憑證無效或已過期", { code: "ITEM_CREDENTIAL_INVALID" });
  }
  const credentialAccepted = acceptsCredential(item, input.itemCredential, now);
  if (item.session.retiredAt !== null) {
    throw new StudyStreamError(403, "學習 session 已過期或已撤銷", { code: "SESSION_REVOKED" });
  }
  const isReadOnlyFeedbackAck =
    input.actionKind === "FEEDBACK_ACK" &&
    item.itemKind === "OBJECTIVE_PROBE" &&
    item.usedAt !== null &&
    item.operationId !== null &&
    (item.status === "ANSWERED" || item.status === "ACKNOWLEDGED");
  if (item.session.expiresAt <= now) {
    // Feedback acknowledgement is a read-only continuation. It is allowed
    // on an expired but non-revoked session after the item/credential/user
    // checks above; scored answers and card actions remain fail-closed unless
    // they use the explicit recovery endpoint.
    if (!options.recoverExpiredSession && !isReadOnlyFeedbackAck) {
      throw new StudyStreamError(403, "學習 session 已過期或已撤銷", { code: "SESSION_EXPIRED" });
    }
    if (options.recoverExpiredSession && !completionConflict && !completedFeedbackReplay && !isReadOnlyFeedbackAck) {
      const recoveredExpiresAt = new Date(now.getTime() + STREAM_SESSION_TTL_MS);
      const recovered = await tx.studySession.updateMany({
        where: { id: item.session.id, userId, retiredAt: null, expiresAt: { lte: now } },
        data: { expiresAt: recoveredExpiresAt },
      });
      if (recovered.count !== 1) {
        throw new StudyStreamError(403, "學習 session 已過期或已撤銷", { code: "SESSION_REVOKED" });
      }
      // Keep the in-transaction relation authoritative for revision updates
      // and response construction below; the user lock serialises recovery
      // with another tab/device using the same learner session.
      item.session = { ...item.session, expiresAt: recoveredExpiresAt };
    }
  }
  if (completionConflict) {
    // An expired session still follows the normal session barrier. The
    // explicit recovery endpoint reaches this terminal check without
    // extending the already-completed item's source session.
    throw new StudyStreamError(409, completionConflict.message, { code: completionConflict.code });
  }
  if (!credentialAccepted && !options.recoverExpiredCredential) {
    throw new StudyStreamError(403, "學習項目憑證無效或已過期", { code: "ITEM_CREDENTIAL_EXPIRED" });
  }
  if (item.status === "SUPERSEDED") {
    throw new StudyStreamError(409, "學習項目已由其他裝置完成", { code: "SUPERSEDED_STREAM_ITEM" });
  }
  if (item.itemKind === "OBJECTIVE_PROBE" && item.usedAt !== null && input.actionKind === "OBJECTIVE_ANSWER") {
    throw new StudyStreamError(409, "該客觀題已由其他操作完成", { code: "OBJECTIVE_TARGET_CONSUMED" });
  }
  if (
    item.itemKind === "LEARNING_CARD" &&
    item.workObligationId &&
    (input.actionKind === "REVEAL" || input.actionKind === "SELF_RATING")
  ) {
    const obligation = await tx.evidenceObligation.findUnique({
      where: { id: item.workObligationId },
      select: { status: true },
    });
    if (obligation && obligation.status !== "PENDING" && obligation.status !== "LEASED") {
      throw new StudyStreamError(409, "學習任務已由其他操作完成", { code: "WORK_OBLIGATION_COMPLETED" });
    }
  }
  // A Learning Card has one durable self-rating. If another tab has already
  // acknowledged it, a late reveal/rating is safely terminal rather than a
  // retryable stale operation. Keep this scoped to the matching card actions;
  // an answered Objective Probe may still accept its separate feedback ack.
  if (
    item.itemKind === "LEARNING_CARD" &&
    item.usedAt !== null &&
    (input.actionKind === "REVEAL" || input.actionKind === "SELF_RATING")
  ) {
    throw new StudyStreamError(409, "學習項目已由其他操作完成", { code: "STREAM_ITEM_COMPLETED" });
  }
  if (item.usedAt === null && item.leaseExpiresAt <= now) {
    if (!options.recoverExpiredLease) {
      throw new StudyStreamError(403, "學習項目租約已過期，請重新載入", { code: "EXPIRED_ITEM_LEASE" });
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
      throw new StudyStreamError(409, "學習項目已被其他裝置更新，請重新載入", { code: "STALE_STREAM_ITEM" });
    }
    item.leaseExpiresAt = recoveredLeaseExpiresAt;
  }
  // Feedback acknowledgement is read-only and may legitimately be replayed
  // from a checkpoint created before the scored answer's revision was
  // published. The scored action itself remains strict CAS-protected.
  if (item.clientRevision !== input.clientKnownRevision && input.actionKind !== "FEEDBACK_ACK") {
    throw new StudyStreamError(409, "學習項目版本已更新", {
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
    (
      receipt.requestFingerprint !== actionFingerprint(input) &&
      receipt.requestFingerprint !== legacyActionFingerprint(input)
    ) ||
    receipt.flowVersion !== STUDY_STREAM_FLOW_VERSION ||
    receipt.actionKind !== input.actionKind
  ) {
    throw new StudyStreamError(409, "operationId 已用於不同的學習操作");
  }
  const response = asStoredActionResponse(receipt.response);
  if (!response) throw new StudyStreamError(409, "學習操作回執已損壞，請重新載入");
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
  policyVersion: LearningPolicyVersion = "retrieval-v1",
  eligibleOverride?: Date,
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
      policyVersion,
      eligibleAt: eligibleOverride ?? new Date(admitted.record.eligibleAt),
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
  if (item.usedAt !== null) throw new StudyStreamError(409, "學習項目已經提交");
  if (!item.revealedAt) {
    await tx.studyStreamItem.update({ where: { id: item.id }, data: { revealedAt: new Date() } });
  }
  const answer = learningCardAnswer(item.word);
  if (!answer) throw new StudyStreamError(409, "學習項目內容已失效");
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
    throw new StudyStreamError(409, "請先揭示 Learning Card 內容");
  }
  if (item.usedAt !== null) throw new StudyStreamError(409, "學習項目已經提交");
  if (!("selfRating" in input.payload) || (input.payload.selfRating !== "selfForgot" && input.payload.selfRating !== "selfRecalled")) {
    throw new StudyStreamError(400, "self-rating 無效");
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
    if (completedWork.count !== 1) {
      throw new StudyStreamError(409, "學習任務已由其他操作完成", { code: "WORK_OBLIGATION_COMPLETED" });
    }
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
    if (required) admission = await admissionWork(tx, userId, item.word.id, item.word.senseId, "EVIDENCE_OBLIGATION", now, input.operationId, isSupportedLearningPolicy(item.policyVersion) ? item.policyVersion : "retrieval-v1");
  } else {
    admission = await admissionWork(tx, userId, item.word.id, item.word.senseId, "REMEDIATION", now, input.operationId, isSupportedLearningPolicy(item.policyVersion) ? item.policyVersion : "retrieval-v1");
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
      requiresVerification: selfRating === "selfRecalled" && (admission.disposition !== "not-required"),
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
    throw new StudyStreamError(409, "目前項目不是有效的 Objective Probe");
  }
  if (item.usedAt !== null) {
    throw new StudyStreamError(409, "該客觀題已由其他操作完成", { code: "OBJECTIVE_TARGET_CONSUMED" });
  }
  if (!("selectedOptionId" in input.payload) || typeof input.payload.selectedOptionId !== "string") {
    throw new StudyStreamError(400, "選項無效");
  }
  const snapshot = snapshotToData(item.objectiveQuestionSnapshot);
  if (!snapshot) throw new StudyStreamError(409, "客觀題快照無效，請重新載入");
  const provenance = await objectiveEventProvenance(tx, item, item.objectiveQuestionSnapshot);
  const selectedOptionId = input.payload.selectedOptionId;
  if (!snapshot.options.some((option) => option.id === selectedOptionId)) {
    throw new StudyStreamError(400, "選項不屬於目前題目");
  }
  if (item.objectiveEvidenceTarget.status !== "OPEN") {
    throw new StudyStreamError(409, "該客觀證據目標已經完成", {
      code: item.objectiveEvidenceTarget.status === "CONSUMED"
        ? "OBJECTIVE_TARGET_CONSUMED"
        : "OBJECTIVE_TARGET_CLOSED",
    });
  }
  const review = await tx.review.findUnique({
    where: { userId_wordId: { userId, wordId: item.word.id } },
  });
  const expectedRevision = item.objectiveEvidenceTarget.expectedReviewRevision ?? 0;
  const currentRevision = review?.revision ?? 0;
  if (currentRevision !== expectedRevision) {
    throw new StudyStreamError(409, "客觀證據目標已過期", {
      code: "STALE_EVIDENCE_TARGET",
      expectedReviewRevision: expectedRevision,
      currentRevision,
    });
  }
  const purpose = item.objectiveEvidenceTarget.purpose as ProbePurpose;
  const isCorrect = selectedOptionId === snapshot.correctOptionId;
  const mapping = mapObjectiveFirstResponse(isCorrect ? "correct" : "wrong", purpose);
  if (!mapping) throw new StudyStreamError(409, "目前客觀題目的評分策略無效");
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
  if (consumedTarget.count !== 1) {
    throw new StudyStreamError(409, "該客觀題已經被其他裝置提交", { code: "OBJECTIVE_TARGET_CONSUMED" });
  }

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
    if (updatedReview.count !== 1) throw new StudyStreamError(409, "學習狀態已被其他裝置更新");
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
      contentRevisionId: provenance.contentRevisionId,
      catalogRevisionId: provenance.catalogRevisionId,
      wordTerm: provenance.wordTerm,
      wordLevel: provenance.wordLevel,
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
  // Re-leasing an abandoned target can leave an older presentation behind.
  // Once either presentation wins, the others must no longer be resumable.
  await tx.studyStreamItem.updateMany({
    where: { objectiveEvidenceTargetId: item.objectiveEvidenceTarget.id, id: { not: item.id }, usedAt: null, status: "LEASED" },
    data: { status: "SUPERSEDED" },
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
    await admissionWork(tx, userId, item.word.id, item.word.senseId, "REMEDIATION", new Date(), input.operationId, isSupportedLearningPolicy(item.policyVersion) ? item.policyVersion : "retrieval-v1");
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
    throw new StudyStreamError(409, "目前項目沒有可確認的 feedback");
  }
  if (item.feedbackAcknowledgedAt !== null) {
    // Feedback acknowledgement is a read-only transition. A second tab may
    // safely confirm the same scored item after the first tab has committed;
    // return the authoritative feedback and persist a receipt for this
    // operation so an offline retry converges without another 409 loop.
    const feedback = await receiptFeedback(tx, userId, item.operationId, true);
    if (!feedback) throw new StudyStreamError(409, "客觀題 feedback 回執已損壞");
    const response: PublicStreamActionResponse = {
      ok: true,
      operationId: input.operationId,
      actionKind: input.actionKind,
      duplicate: false,
      itemStatus: "ACKNOWLEDGED",
      clientRevision: item.clientRevision ?? item.session.revision,
      requiresFeedbackAck: false,
      feedback,
      nextItem: null,
    };
    await insertReceipt(tx, userId, input, response, "ACKNOWLEDGED", item.id);
    return response;
  }
  const feedback = await receiptFeedback(tx, userId, item.operationId, true);
  if (!feedback) throw new StudyStreamError(409, "客觀題 feedback 回執已損壞");
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
    recoveryCredential?: string | null;
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
 * Check whether a queued action's exact account/session/item tuple has already
 * reached an authoritative terminal state. This is intentionally separate
 * from action processing: it does not accept the supplied bearer credential,
 * return card/feedback content, create a receipt, score anything, or extend a
 * session. It only gives an authenticated client enough information to remove
 * one stale outbox row after a credential lineage has been evicted. Pending
 * and revoked tuples remain unresolved/fail closed for the normal retry path.
 */
export async function reconcileStudyStreamAction(
  userId: string,
  input: StudyStreamActionInput,
): Promise<StudyStreamActionReconciliation> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await lockStreamUser(tx, userId);
          const item = await tx.studyStreamItem.findFirst({
            where: {
              id: input.streamItemId,
              sessionId: input.studySessionId,
            },
            include: { session: true },
          });
          if (!item || item.session.userId !== userId || item.session.flowVersion !== STUDY_STREAM_FLOW_VERSION) {
            throw new StudyStreamError(403, "學習項目憑證無效或不屬於目前帳戶");
          }
          if (item.session.retiredAt !== null) {
            throw new StudyStreamError(403, "學習 session 已過期或已撤銷", { code: "SESSION_REVOKED" });
          }
          // Reconciliation is allowed to discard an obsolete action only
          // after its immutable operation identity has been checked. If the
          // operation already has a receipt, the fingerprint (including the
          // operationId, action kind, revision and payload) must match exactly.
          // Older receipts are accepted through the legacy fingerprint solely
          // because the user+operationId lookup already binds their identity.
          const receipt = await tx.operationReceipt.findUnique({
            where: { userId_operationId: { userId, operationId: input.operationId } },
            select: { requestFingerprint: true, flowVersion: true, actionKind: true },
          });
          if (receipt && (
            receipt.flowVersion !== STUDY_STREAM_FLOW_VERSION ||
            receipt.actionKind !== input.actionKind ||
            (receipt.requestFingerprint !== actionFingerprint(input) &&
              receipt.requestFingerprint !== legacyActionFingerprint(input))
          )) {
            throw new StudyStreamError(409, "operationId 已用於不同的學習操作");
          }
          // A missing receipt for the item-winning operation is an integrity
          // failure, not proof that an arbitrary payload is safe to discard.
          // Keep it retryable so the client cannot silently lose that action.
          if (!receipt && item.operationId === input.operationId) {
            throw new StudyStreamError(409, "學習操作回執遺失，請重新載入");
          }
          const itemRevision = item.clientRevision ?? item.session.revision;
          if (input.clientKnownRevision > itemRevision) {
            throw new StudyStreamError(409, "學習項目版本已更新", { code: "STALE_STREAM_ITEM" });
          }
          const conflict = terminalActionConflict(item, input.actionKind);
          if (conflict) {
            return {
              ok: true as const,
              terminal: true as const,
              code: conflict.code,
              message: conflict.message,
            };
          }
          if (isCompletedFeedbackReplay(item, input.actionKind)) {
            return {
              ok: true as const,
              terminal: true as const,
              code: "FEEDBACK_ALREADY_ACKNOWLEDGED" as const,
              message: "客觀題 feedback 已由其他操作確認",
            };
          }
          return { ok: true as const, terminal: false as const };
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
  throw new Error("Study action reconciliation transaction retry exhausted");
}

/**
 * Upgrade a pre-recovery-version outbox row into the item-bound recovery
 * contract. The caller must provide the original typed action and credential;
 * the server verifies the exact account/session/item tuple and the retained
 * credential lineage before issuing the deterministic item proof. A direct
 * terminal result is returned without issuing a proof, so completed rows can
 * be removed safely even when their old credential has already expired.
 *
 * Parent digests are accepted only in this explicit migration step. They are
 * the signed lineage link left by a retained successor (for example K2 keeps
 * the digest of K1 as its parent) and are never accepted by the ordinary
 * action route. If no retained lineage link remains, the row stays fail
 * closed; silently trusting an arbitrary authenticated payload would be less
 * safe than surfacing a blocked legacy row.
 */
export async function prepareStudyStreamActionRecovery(
  userId: string,
  input: StudyStreamActionInput,
): Promise<StudyStreamRecoveryPreparation> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await lockStreamUser(tx, userId);
          const item = await tx.studyStreamItem.findFirst({
            where: {
              id: input.streamItemId,
              sessionId: input.studySessionId,
            },
            include: { session: true },
          });
          if (!item || item.session.userId !== userId || item.session.flowVersion !== STUDY_STREAM_FLOW_VERSION) {
            throw new StudyStreamError(403, "學習項目憑證無效或不屬於目前帳戶");
          }
          if (item.session.retiredAt !== null) {
            throw new StudyStreamError(403, "學習 session 已過期或已撤銷", { code: "SESSION_REVOKED" });
          }

          const receipt = await tx.operationReceipt.findUnique({
            where: { userId_operationId: { userId, operationId: input.operationId } },
            select: { requestFingerprint: true, flowVersion: true, actionKind: true },
          });
          if (receipt && (
            receipt.flowVersion !== STUDY_STREAM_FLOW_VERSION ||
            receipt.actionKind !== input.actionKind ||
            (receipt.requestFingerprint !== actionFingerprint(input) &&
              receipt.requestFingerprint !== legacyActionFingerprint(input))
          )) {
            throw new StudyStreamError(409, "operationId 已用於不同的學習操作");
          }
          if (!receipt && item.operationId === input.operationId) {
            throw new StudyStreamError(409, "學習操作回執遺失，請重新載入");
          }

          const itemRevision = item.clientRevision ?? item.session.revision;
          if (input.clientKnownRevision > itemRevision) {
            throw new StudyStreamError(409, "學習項目版本已更新", { code: "STALE_STREAM_ITEM" });
          }

          const conflict = terminalActionConflict(item, input.actionKind);
          if (conflict) {
            return {
              ok: true as const,
              terminal: true as const,
              code: conflict.code,
              message: conflict.message,
            };
          }
          if (isCompletedFeedbackReplay(item, input.actionKind)) {
            return {
              ok: true as const,
              terminal: true as const,
              code: "FEEDBACK_ALREADY_ACKNOWLEDGED" as const,
              message: "客觀題 feedback 已由其他操作確認",
            };
          }

          const actionMatchesItem =
            ((input.actionKind === "REVEAL" || input.actionKind === "SELF_RATING") && item.itemKind === "LEARNING_CARD") ||
            ((input.actionKind === "OBJECTIVE_ANSWER" || input.actionKind === "FEEDBACK_ACK") && item.itemKind === "OBJECTIVE_PROBE");
          if (!actionMatchesItem) {
            throw new StudyStreamError(409, "學習操作與項目類型不符", { code: "STALE_STREAM_ITEM" });
          }

          if (!matchesCredentialDigest(item, input.itemCredential, true)) {
            throw new StudyStreamError(403, "舊版學習操作憑證無法安全升級", {
              code: "LEGACY_ACTION_CREDENTIAL_UNVERIFIABLE",
            });
          }

          return {
            ok: true as const,
            terminal: false as const,
            recoveryCredential: createStudyStreamRecoveryCredential(item.id),
          };
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
  throw new Error("Study recovery preparation transaction retry exhausted");
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
  recoveryCredential?: string | null,
): Promise<ActionTransactionResult> {
  return applyStudyStreamActionTx(userId, input, {
    recoverExpiredSession: true,
    recoverExpiredCredential: true,
    recoverExpiredLease: true,
    recoveryCredential,
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
        throw new StudyStreamError(404, "學習憑證繼承鏈已失效");
      }
      if (item.session.retiredAt !== null || item.session.expiresAt <= now) {
        throw new StudyStreamError(403, "學習 session 已過期或已撤銷");
      }
      if (!acceptsCredential(item, input.itemCredential, now)) {
        throw new StudyStreamError(403, "學習項目憑證無效或已過期");
      }
      if (item.clientRevision !== input.clientKnownRevision) {
        throw new StudyStreamError(409, "學習項目版本已更新", { code: "STALE_STREAM_ITEM" });
      }
      if (item.feedbackAcknowledgedAt !== null) {
        throw new StudyStreamError(409, "該學習項目已經完成");
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
      if (!publicItem) throw new StudyStreamError(409, "學習項目已失效");
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
