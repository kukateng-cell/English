import { createHash, randomUUID } from "node:crypto";
import { prisma, Prisma } from "@/lib/prisma";
import {
  canReuseResumeSession,
  MAX_STUDY_SESSION_WORDS,
} from "@/lib/study-session";
import {
  isRetryableTransactionConflict,
  waitForTransactionRetry,
} from "@/lib/transaction-retry";

const STUDY_SESSION_TTL_MS = 30 * 60_000;
export const STUDY_SESSION_RETENTION_MS = 14 * 24 * 60 * 60_000;
const REUSE_MIN_REMAINING_MS = 2 * 60_000;
export const STUDY_SESSION_ROTATION_WINDOW_MS = 5 * 60_000;
const MAX_ACTIVE_STUDY_SESSIONS = 6;
const SESSION_TRANSACTION_RETRIES = 4;

export interface IssuedStudySession {
  id: string;
  expiresAt: Date;
  items: Array<{
    wordId: string;
    nonce: string;
    usedAt: Date | null;
    renewedAt: Date | null;
    operationId: string | null;
  }>;
}

function normalizedWordIds(wordIds: string[]) {
  const ids = [...new Set(wordIds)];
  if (ids.length > MAX_STUDY_SESSION_WORDS) {
    throw new Error("STUDY_SESSION_WORD_LIMIT_EXCEEDED");
  }
  return ids;
}

export function studyQueueFingerprint(wordIds: string[]) {
  return createHash("sha256")
    .update(normalizedWordIds(wordIds).sort().join("\0"))
    .digest("hex");
}

export async function issueStudySession(
  userId: string,
  wordIds: string[],
): Promise<IssuedStudySession | null> {
  const ids = normalizedWordIds(wordIds);
  if (ids.length === 0) return null;
  const queueFingerprint = studyQueueFingerprint(ids);

  for (let attempt = 0; attempt < SESSION_TRANSACTION_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const now = new Date();

          const reusable = await tx.studySession.findFirst({
            where: {
              userId,
              queueFingerprint,
              expiresAt: {
                gt: new Date(now.getTime() + REUSE_MIN_REMAINING_MS),
              },
              retiredAt: null,
              items: {
                every: { usedAt: null, renewedAt: null, operationId: null },
              },
            },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              expiresAt: true,
              items: {
                select: {
                  wordId: true,
                  nonce: true,
                  usedAt: true,
                  renewedAt: true,
                  operationId: true,
                },
              },
            },
          });
          const active = await tx.studySession.findMany({
            where: { userId, expiresAt: { gt: now }, retiredAt: null },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          const reusableSession =
            reusable && reusable.items.length === ids.length ? reusable : null;
          const sessionsToDelete = active
            .filter((session) => session.id !== reusableSession?.id)
            .slice(MAX_ACTIVE_STUDY_SESSIONS - 1)
            .map((session) => session.id);
          if (sessionsToDelete.length > 0) {
            await tx.studySession.updateMany({
              where: { id: { in: sessionsToDelete } },
              data: { retiredAt: now },
            });
          }
          if (reusableSession) return reusableSession;

          return tx.studySession.create({
            data: {
              userId,
              queueFingerprint,
              expiresAt: new Date(now.getTime() + STUDY_SESSION_TTL_MS),
              items: {
                create: ids.map((wordId) => ({
                  wordId,
                  nonce: randomUUID(),
                })),
              },
            },
            select: {
              id: true,
              expiresAt: true,
              items: {
                select: {
                  wordId: true,
                  nonce: true,
                  usedAt: true,
                  renewedAt: true,
                  operationId: true,
                },
              },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        !isRetryableTransactionConflict(error) ||
        attempt === SESSION_TRANSACTION_RETRIES - 1
      ) {
        throw error;
      }
      await waitForTransactionRetry(attempt);
    }
  }
  throw new Error("STUDY_SESSION_TRANSACTION_RETRY_EXHAUSTED");
}

/**
 * Reuse one exact checkpoint source without ever minting replacement
 * credentials. Locking its items closes the race with a concurrent submission;
 * if anything consumed/retired the source, resume fails and the caller reloads.
 */
export async function reuseStudySessionForResume(
  userId: string,
  sourceSessionId: string,
  wordIds: string[],
): Promise<IssuedStudySession | null> {
  const ids = normalizedWordIds(wordIds);
  for (let attempt = 0; attempt < SESSION_TRANSACTION_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const fingerprint = studyQueueFingerprint(ids);
          let candidateId = sourceSessionId;
          // A response-loss rotation retires the checkpoint's source. Follow
          // the deterministic replacement chain so a reload can recover the
          // already-committed session without minting another nonce set.
          for (let hop = 0; hop < 4; hop += 1) {
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "StudySessionItem" WHERE "sessionId" = ${candidateId} FOR UPDATE`,
            );
            const candidate = await tx.studySession.findFirst({
              where: {
                id: candidateId,
                userId,
                queueFingerprint: fingerprint,
              },
              select: {
                id: true,
                expiresAt: true,
                retiredAt: true,
                items: {
                  select: {
                    wordId: true,
                    nonce: true,
                    usedAt: true,
                    renewedAt: true,
                    operationId: true,
                  },
                },
              },
            });
            if (!candidate) return null;
            if (canReuseResumeSession(candidate, ids)) {
              return {
                id: candidate.id,
                expiresAt: candidate.expiresAt,
                items: candidate.items,
              };
            }
            if (candidate.retiredAt === null) return null;
            const replacement = await tx.studySession.findFirst({
              where: {
                userId,
                rotationKey: `rotate-${candidate.id}`,
                queueFingerprint: fingerprint,
              },
              select: { id: true },
            });
            if (!replacement) return null;
            candidateId = replacement.id;
          }
          return null;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        !isRetryableTransactionConflict(error) ||
        attempt === SESSION_TRANSACTION_RETRIES - 1
      ) {
        throw error;
      }
      await waitForTransactionRetry(attempt);
    }
  }
  throw new Error("STUDY_SESSION_RESUME_RETRY_EXHAUSTED");
}

export class StudySessionRotationError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "StudySessionRotationError";
  }
}

/**
 * Rotate a nearly-expired session without changing its queue provenance.
 * `rotationKey` makes the response-loss retry return the exact same session
 * and nonces instead of issuing a second continuation.
 */
export async function rotateStudySession(
  userId: string,
  previousSessionId: string,
  wordIds: string[],
  rotationKey: string,
): Promise<IssuedStudySession> {
  const ids = normalizedWordIds(wordIds);
  if (rotationKey !== `rotate-${previousSessionId}`) {
    throw new StudySessionRotationError(409, "学习 session 轮换凭证不一致");
  }
  const fingerprint = studyQueueFingerprint(ids);
  for (let attempt = 0; attempt < SESSION_TRANSACTION_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const now = new Date();
          const existing = await tx.studySession.findFirst({
            where: { userId, rotationKey },
            select: {
              id: true,
              queueFingerprint: true,
              expiresAt: true,
              retiredAt: true,
              items: {
                select: {
                  wordId: true,
                  nonce: true,
                  usedAt: true,
                  renewedAt: true,
                  operationId: true,
                },
              },
            },
          });
          if (existing) {
            const existingIds = new Set(existing.items.map((item) => item.wordId));
            if (
              existing.queueFingerprint !== fingerprint ||
              existing.items.length !== ids.length ||
              existingIds.size !== ids.length ||
              ids.some((id) => !existingIds.has(id)) ||
              existing.retiredAt !== null ||
              existing.expiresAt <= now
            ) {
              throw new StudySessionRotationError(409, "学习 session 轮换凭证不一致");
            }
            return {
              id: existing.id,
              expiresAt: existing.expiresAt,
              items: existing.items,
            };
          }

          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "StudySession" WHERE "id" = ${previousSessionId} AND "userId" = ${userId} FOR UPDATE`,
          );
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "StudySessionItem" WHERE "sessionId" = ${previousSessionId} FOR UPDATE`,
          );
          const source = await tx.studySession.findFirst({
            where: { id: previousSessionId, userId },
            select: {
              id: true,
              queueFingerprint: true,
              expiresAt: true,
              retiredAt: true,
              items: {
                select: {
                  id: true,
                  wordId: true,
                  nonce: true,
                  usedAt: true,
                  renewedAt: true,
                  operationId: true,
                  successorItem: { select: { id: true } },
                },
              },
            },
          });
          if (!source) {
            throw new StudySessionRotationError(404, "原学习 session 不存在或已清理");
          }
          const remainingMs = source.expiresAt.getTime() - now.getTime();
          const sourceIds = new Set(source.items.map((item) => item.wordId));
          if (
            source.queueFingerprint !== fingerprint ||
            source.items.length !== ids.length ||
            sourceIds.size !== ids.length ||
            ids.some((id) => !sourceIds.has(id)) ||
            source.retiredAt !== null ||
            remainingMs <= 0 ||
            remainingMs > STUDY_SESSION_ROTATION_WINDOW_MS
          ) {
            throw new StudySessionRotationError(
              409,
              remainingMs > STUDY_SESSION_ROTATION_WINDOW_MS
                ? "学习 session 尚未进入轮换窗口"
                : "学习 session 已过期或已失效",
            );
          }
          const active = await tx.studySession.findMany({
            where: { userId, expiresAt: { gt: now }, retiredAt: null },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          const retireIds = active
            .filter((session) => session.id !== source.id)
            .slice(MAX_ACTIVE_STUDY_SESSIONS - 2)
            .map((session) => session.id);
          if (retireIds.length > 0) {
            await tx.studySession.updateMany({
              where: { id: { in: retireIds } },
              data: { retiredAt: now },
            });
          }

          const replacement = await tx.studySession.create({
            data: {
              userId,
              queueFingerprint: fingerprint,
              rotationKey,
              expiresAt: new Date(now.getTime() + STUDY_SESSION_TTL_MS),
              items: {
                create: source.items.map((item) => ({
                  wordId: item.wordId,
                  nonce: randomUUID(),
                  usedAt: item.usedAt,
                  renewedAt: item.renewedAt,
                  operationId: item.operationId,
                  sourceItemId: item.successorItem ? undefined : item.id,
                })),
              },
            },
            select: {
              id: true,
              expiresAt: true,
              items: {
                select: {
                  wordId: true,
                  nonce: true,
                  usedAt: true,
                  renewedAt: true,
                  operationId: true,
                },
              },
            },
          });
          // The replacement owns every still-pristine credential. Marking the
          // source items in the same transaction prevents a stale client from
          // forking S -> N through credential renewal after S -> R rotation.
          await tx.studySessionItem.updateMany({
            where: {
              sessionId: source.id,
              usedAt: null,
              renewedAt: null,
            },
            data: { renewedAt: now },
          });
          await tx.studySession.update({
            where: { id: source.id },
            data: { retiredAt: now },
          });
          return replacement;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const uniqueConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002";
      if (
        (!isRetryableTransactionConflict(error) && !uniqueConflict) ||
        attempt === SESSION_TRANSACTION_RETRIES - 1
      ) {
        throw error;
      }
      await waitForTransactionRetry(attempt);
    }
  }
  throw new Error("STUDY_SESSION_ROTATION_RETRY_EXHAUSTED");
}

export class StudyCredentialRenewalError extends Error {
  constructor(
    public readonly status: 403 | 404 | 409,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "StudyCredentialRenewalError";
  }
}

export interface StudyCredentialRenewalOperation {
  operationId: string;
  wordId: string;
  quality?: number;
}

/**
 * Recover one unanswered operation after its source session was superseded.
 * Rotation copies the original one-time item into a deterministic successor;
 * bind that successor to the same operation instead of depending on a random
 * queue load to issue the word again.
 */
export async function recoverStudySessionCredential(
  userId: string,
  sourceSessionId: string,
  operation: StudyCredentialRenewalOperation,
): Promise<IssuedStudySession> {
  if (
    operation.quality === undefined ||
    !Number.isInteger(operation.quality) ||
    operation.quality < 0 ||
    operation.quality > 5
  ) {
    throw new StudyCredentialRenewalError(
      409,
      "恢复操作指纹无效",
      { code: "OPERATION_FINGERPRINT_MISMATCH" },
    );
  }
  for (let attempt = 0; attempt < SESSION_TRANSACTION_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const now = new Date();
          const lockedSource = await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT "id" FROM "StudySession" WHERE "id" = ${sourceSessionId} AND "userId" = ${userId} FOR UPDATE`,
          );
          if (lockedSource.length !== 1) {
            throw new StudyCredentialRenewalError(
              404,
              "原学习 session 已被清理，无法恢复答案",
              { code: "SOURCE_SESSION_GONE" },
            );
          }
          const processed = await tx.reviewEvent.findUnique({
            where: {
              userId_operationId: {
                userId,
                operationId: operation.operationId,
              },
            },
            select: {
              submittedWordId: true,
              quality: true,
              eventKind: true,
            },
          });
          if (processed) {
            if (
              processed.submittedWordId !== operation.wordId ||
              processed.quality !== operation.quality ||
              processed.eventKind !== "REVIEW"
            ) {
              throw new StudyCredentialRenewalError(
                409,
                "operationId 已用于不同的学习记录",
                { code: "OPERATION_FINGERPRINT_MISMATCH" },
              );
            }
            throw new StudyCredentialRenewalError(
              409,
              "学习操作已经处理",
              {
                code: "REVIEW_ALREADY_PROCESSED",
                wordId: processed.submittedWordId,
                requiresQueueReload: true,
              },
            );
          }

          const sourceItem = await tx.studySessionItem.findUnique({
            where: {
              sessionId_wordId: {
                sessionId: sourceSessionId,
                wordId: operation.wordId,
              },
            },
            select: { id: true },
          });
          if (!sourceItem) {
            throw new StudyCredentialRenewalError(
              403,
              "恢复单词不属于原学习 session",
              { code: "WORD_NOT_IN_SOURCE_SESSION" },
            );
          }

          let candidateItemId = sourceItem.id;
          let followedLineage = false;
          for (let hop = 0; hop < 16; hop += 1) {
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "StudySessionItem" WHERE "id" = ${candidateItemId} FOR UPDATE`,
            );
            const candidate = await tx.studySessionItem.findUnique({
              where: { id: candidateItemId },
              select: {
                id: true,
                wordId: true,
                nonce: true,
                usedAt: true,
                renewedAt: true,
                operationId: true,
                successorItem: { select: { id: true } },
                session: {
                  select: {
                    id: true,
                    userId: true,
                    expiresAt: true,
                    retiredAt: true,
                  },
                },
              },
            });
            if (!candidate || candidate.session.userId !== userId) {
              throw new StudyCredentialRenewalError(
                404,
                "学习凭证继承链已失效",
                { code: "CREDENTIAL_RECOVERY_UNAVAILABLE" },
              );
            }
            if (candidate.successorItem) {
              followedLineage = true;
              candidateItemId = candidate.successorItem.id;
              continue;
            }

            // Bridge rotations created before the lineage migration, then
            // persist the discovered edge so every later retry is item-based.
            if (candidate.session.retiredAt !== null) {
              const legacyRotation = await tx.studySessionItem.findFirst({
                where: {
                  wordId: operation.wordId,
                  sourceItemId: null,
                  session: {
                    userId,
                    rotationKey: `rotate-${candidate.session.id}`,
                  },
                },
                select: { id: true },
              });
              if (legacyRotation) {
                await tx.studySessionItem.update({
                  where: { id: legacyRotation.id },
                  data: { sourceItemId: candidate.id },
                });
                followedLineage = true;
                candidateItemId = legacyRotation.id;
                continue;
              }
            }
            if (candidate.usedAt) {
              throw new StudyCredentialRenewalError(
                409,
                "该学习题目已经提交",
                {
                  code: "REVIEW_ALREADY_PROCESSED",
                  wordId: operation.wordId,
                  requiresQueueReload: true,
                },
              );
            }
            const live =
              candidate.session.retiredAt === null &&
              candidate.session.expiresAt > now &&
              candidate.renewedAt === null;
            if (live && candidate.operationId !== null) {
              if (candidate.operationId !== operation.operationId) {
                throw new StudyCredentialRenewalError(
                  409,
                  "恢复凭证正由另一项操作使用",
                  {
                    code: "RECOVERY_BUSY",
                    wordId: operation.wordId,
                    requiresQueueReload: false,
                    retryAfterSec: 5,
                  },
                );
              }
              // Compatibility for an operation bound by an older deployment
              // before recovery always minted an item-lineage successor.
              return {
                id: candidate.session.id,
                expiresAt: candidate.session.expiresAt,
                items: [{
                  wordId: candidate.wordId,
                  nonce: candidate.nonce,
                  usedAt: candidate.usedAt,
                  renewedAt: candidate.renewedAt,
                  operationId: operation.operationId,
                }],
              };
            }

            if (live && followedLineage) {
              await tx.studySessionItem.update({
                where: { id: candidate.id },
                data: { operationId: operation.operationId },
              });
              return {
                id: candidate.session.id,
                expiresAt: candidate.session.expiresAt,
                items: [{
                  wordId: candidate.wordId,
                  nonce: candidate.nonce,
                  usedAt: candidate.usedAt,
                  renewedAt: candidate.renewedAt,
                  operationId: operation.operationId,
                }],
              };
            }

            if (candidate.renewedAt !== null) {
              throw new StudyCredentialRenewalError(
                409,
                "学习凭证继承关系不完整",
                { code: "CREDENTIAL_RECOVERY_UNAVAILABLE" },
              );
            }

            const active = await tx.studySession.findMany({
              where: { userId, expiresAt: { gt: now }, retiredAt: null },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            });
            const retireIds = active
              .slice(MAX_ACTIVE_STUDY_SESSIONS - 1)
              .map((session) => session.id);
            if (retireIds.length > 0) {
              await tx.studySession.updateMany({
                where: { id: { in: retireIds } },
                data: { retiredAt: now },
              });
            }
            await tx.studySessionItem.update({
              where: { id: candidate.id },
              data: {
                renewedAt: now,
                operationId: candidate.operationId ?? operation.operationId,
              },
            });
            return tx.studySession.create({
              data: {
                userId,
                queueFingerprint: studyQueueFingerprint([operation.wordId]),
                expiresAt: new Date(now.getTime() + STUDY_SESSION_TTL_MS),
                items: {
                  create: {
                    wordId: operation.wordId,
                    nonce: randomUUID(),
                    operationId: operation.operationId,
                    sourceItemId: candidate.id,
                  },
                },
              },
              select: {
                id: true,
                expiresAt: true,
                items: {
                  select: {
                    wordId: true,
                    nonce: true,
                    usedAt: true,
                    renewedAt: true,
                    operationId: true,
                  },
                },
              },
            });
          }
          throw new StudyCredentialRenewalError(
            409,
            "学习 session 替代链过长，暂时无法恢复答案",
            {
              code: "CREDENTIAL_RECOVERY_UNAVAILABLE",
              wordId: operation.wordId,
              requiresQueueReload: false,
            },
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const uniqueConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002";
      if (
        (!isRetryableTransactionConflict(error) && !uniqueConflict) ||
        attempt === SESSION_TRANSACTION_RETRIES - 1
      ) {
        throw error;
      }
      await waitForTransactionRetry(attempt);
    }
  }
  throw new Error("STUDY_SESSION_RECOVERY_RETRY_EXHAUSTED");
}

/**
 * Exchange unused items from one server-issued session for operation-bound
 * credentials. Each prior item can be renewed once, atomically, so raw word
 * IDs or replayed renewal requests cannot mint unlimited review submissions.
 */
export async function renewStudySessionCredentials(
  userId: string,
  previousSessionId: string,
  operations: StudyCredentialRenewalOperation[],
): Promise<IssuedStudySession> {
  const wordIds = normalizedWordIds(operations.map((item) => item.wordId));
  if (
    operations.length === 0 ||
    wordIds.length !== operations.length ||
    new Set(operations.map((item) => item.operationId)).size !== operations.length
  ) {
    throw new StudyCredentialRenewalError(409, "续期操作重复");
  }

  for (let attempt = 0; attempt < SESSION_TRANSACTION_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "StudySession" WHERE "id" = ${previousSessionId} AND "userId" = ${userId} FOR UPDATE`,
          );
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "StudySessionItem" WHERE "sessionId" = ${previousSessionId} FOR UPDATE`,
          );
          const previous = await tx.studySession.findFirst({
            where: { id: previousSessionId, userId },
            select: {
              id: true,
              queueFingerprint: true,
              expiresAt: true,
              retiredAt: true,
              items: {
                where: { wordId: { in: wordIds } },
                select: {
                  id: true,
                  wordId: true,
                  usedAt: true,
                  renewedAt: true,
                  operationId: true,
                },
              },
            },
          });
          if (!previous) {
            throw new StudyCredentialRenewalError(
              404,
              "原学习 session 已被清理，无法安全续期",
            );
          }
          const itemByWord = new Map(
            previous.items.map((item) => [item.wordId, item]),
          );
          const now = new Date();
          const rotationSuccessor = await tx.studySession.findFirst({
            where: {
              userId,
              rotationKey: `rotate-${previous.id}`,
              retiredAt: null,
              expiresAt: { gt: now },
            },
            select: { id: true },
          });
          const renewedItems = operations.filter((operation) =>
            itemByWord.get(operation.wordId)?.renewedAt,
          );
          if (renewedItems.length > 0) {
            // The prior transaction may have committed while its HTTP response
            // was lost. Return that exact replacement session on replay.
            const replacements = await tx.studySessionItem.findMany({
              where: {
                operationId: { in: operations.map((item) => item.operationId) },
                renewedAt: null,
                session: { userId },
              },
              select: {
                wordId: true,
                nonce: true,
                usedAt: true,
                renewedAt: true,
                operationId: true,
                session: {
                  select: {
                    id: true,
                    expiresAt: true,
                    retiredAt: true,
                  },
                },
              },
            });
            const replacementSessionIds = new Set(
              replacements.map((item) => item.session.id),
            );
            const completeReplay =
              replacements.length === operations.length &&
              replacementSessionIds.size === 1 &&
              replacements.every(
                (item) =>
                  item.session.retiredAt === null &&
                  item.session.expiresAt > new Date(),
              ) &&
              operations.every((operation) =>
                replacements.some(
                  (item) =>
                    item.operationId === operation.operationId &&
                    item.wordId === operation.wordId,
                ),
              );
            if (completeReplay) {
              const replacement = replacements[0].session;
              return {
                id: replacement.id,
                expiresAt: replacement.expiresAt,
                items: replacements.map(
                  ({ wordId, nonce, usedAt, renewedAt, operationId }) => ({
                    wordId,
                    nonce,
                    usedAt,
                    renewedAt,
                    operationId,
                  }),
                ),
              };
            }
            throw new StudyCredentialRenewalError(
              409,
              rotationSuccessor || previous.retiredAt
                ? "学习 session 已由较新的凭证取代"
                : "原学习凭证已经提交或续期",
              {
                code:
                  rotationSuccessor || previous.retiredAt
                    ? "SESSION_SUPERSEDED"
                    : "CREDENTIAL_ALREADY_RENEWED",
                requiresQueueReload: true,
                replacementSessionId: rotationSuccessor?.id ?? null,
              },
            );
          }
          const alreadyUsed = operations.find(
            (operation) => itemByWord.get(operation.wordId)?.usedAt,
          );
          if (alreadyUsed) {
            throw new StudyCredentialRenewalError(
              409,
              "该学习题目已经提交",
              {
                code: "REVIEW_ALREADY_PROCESSED",
                wordId: alreadyUsed.wordId,
                requiresQueueReload: true,
              },
            );
          }
          const successor =
            rotationSuccessor ??
            (previous.expiresAt <= now
              ? await tx.studySession.findFirst({
                  where: {
                    userId,
                    retiredAt: null,
                    expiresAt: { gt: now },
                    id: { not: previous.id },
                    queueFingerprint: previous.queueFingerprint,
                  },
                  orderBy: { createdAt: "desc" },
                  select: { id: true },
                })
              : null);
          if (previous.retiredAt !== null || (previous.expiresAt <= now && successor)) {
            throw new StudyCredentialRenewalError(
              409,
              "学习 session 已由较新的凭证取代",
              {
                code: "SESSION_SUPERSEDED",
                requiresQueueReload: true,
                replacementSessionId: successor?.id ?? null,
              },
            );
          }
          for (const operation of operations) {
            const item = itemByWord.get(operation.wordId);
            if (!item) {
              throw new StudyCredentialRenewalError(
                403,
                "续期单词不属于原学习 session",
              );
            }
            if (
              item.renewedAt ||
              (item.operationId && item.operationId !== operation.operationId)
            ) {
              throw new StudyCredentialRenewalError(
                409,
                "原学习凭证已经提交或续期",
                {
                  code: "CREDENTIAL_ALREADY_RENEWED",
                  wordId: operation.wordId,
                  requiresQueueReload: true,
                },
              );
            }
          }

          const processed = await tx.reviewEvent.count({
            where: {
              userId,
              operationId: { in: operations.map((item) => item.operationId) },
            },
          });
          if (processed > 0) {
            throw new StudyCredentialRenewalError(409, "学习操作已经处理");
          }

          for (const operation of operations) {
            const sourceItem = itemByWord.get(operation.wordId)!;
            const consumed = await tx.studySessionItem.updateMany({
              where: {
                id: sourceItem.id,
                usedAt: null,
                renewedAt: null,
                OR: [
                  { operationId: null },
                  { operationId: operation.operationId },
                ],
              },
              data: {
                renewedAt: now,
                operationId: operation.operationId,
              },
            });
            if (consumed.count !== 1) {
              throw new StudyCredentialRenewalError(
                409,
                "学习凭证已被其他请求续期",
              );
            }
          }

          const active = await tx.studySession.findMany({
            where: { userId, expiresAt: { gt: now }, retiredAt: null },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          const retireIds = active
            .slice(MAX_ACTIVE_STUDY_SESSIONS - 1)
            .map((session) => session.id);
          if (retireIds.length > 0) {
            await tx.studySession.updateMany({
              where: { id: { in: retireIds } },
              data: { retiredAt: now },
            });
          }

          return tx.studySession.create({
            data: {
              userId,
              queueFingerprint: studyQueueFingerprint(wordIds),
              expiresAt: new Date(now.getTime() + STUDY_SESSION_TTL_MS),
              items: {
                create: operations.map((operation) => ({
                  wordId: operation.wordId,
                  operationId: operation.operationId,
                  nonce: randomUUID(),
                  sourceItemId: itemByWord.get(operation.wordId)!.id,
                })),
              },
            },
            select: {
              id: true,
              expiresAt: true,
              items: {
                select: {
                  wordId: true,
                  nonce: true,
                  usedAt: true,
                  renewedAt: true,
                  operationId: true,
                },
              },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        !isRetryableTransactionConflict(error) ||
        attempt === SESSION_TRANSACTION_RETRIES - 1
      ) {
        throw error;
      }
      await waitForTransactionRetry(attempt);
    }
  }
  throw new Error("STUDY_CREDENTIAL_RENEWAL_RETRY_EXHAUSTED");
}

export function serializeStudySession(session: IssuedStudySession | null) {
  if (!session) return null;
  return {
    id: session.id,
    expiresAt: session.expiresAt,
    nonces: Object.fromEntries(
      session.items
        .filter((item) => item.usedAt == null && item.renewedAt == null)
        .map((item) => [item.wordId, item.nonce]),
    ),
  };
}

export async function cleanupExpiredStudySessions(
  now = new Date(),
  batchSize = 1_000,
) {
  const retentionCutoff = new Date(now.getTime() - STUDY_SESSION_RETENTION_MS);
  const expired = await prisma.studySession.findMany({
    where: { expiresAt: { lte: retentionCutoff } },
    orderBy: { expiresAt: "asc" },
    take: batchSize,
    select: { id: true },
  });
  if (expired.length === 0) return 0;
  const result = await prisma.studySession.deleteMany({
    where: { id: { in: expired.map((session) => session.id) } },
  });
  return result.count;
}
