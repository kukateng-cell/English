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
const REUSE_MIN_REMAINING_MS = 2 * 60_000;
const MAX_ACTIVE_STUDY_SESSIONS = 6;
const SESSION_TRANSACTION_RETRIES = 4;

export interface IssuedStudySession {
  id: string;
  expiresAt: Date;
  items: Array<{ wordId: string; nonce: string }>;
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
          await tx.studySession.deleteMany({
            where: { userId, expiresAt: { lte: now } },
          });

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
              items: { select: { wordId: true, nonce: true } },
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
              items: { select: { wordId: true, nonce: true } },
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
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "StudySessionItem" WHERE "sessionId" = ${sourceSessionId} FOR UPDATE`,
          );
          const source = await tx.studySession.findFirst({
            where: {
              id: sourceSessionId,
              userId,
              queueFingerprint: studyQueueFingerprint(ids),
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
          if (!source || !canReuseResumeSession(source, ids)) return null;
          return {
            id: source.id,
            expiresAt: source.expiresAt,
            items: source.items.map(({ wordId, nonce }) => ({ wordId, nonce })),
          };
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

export class StudyCredentialRenewalError extends Error {
  constructor(
    public readonly status: 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "StudyCredentialRenewalError";
  }
}

export interface StudyCredentialRenewalOperation {
  operationId: string;
  wordId: string;
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
          const previous = await tx.studySession.findFirst({
            where: { id: previousSessionId, userId },
            select: {
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
          for (const operation of operations) {
            const item = itemByWord.get(operation.wordId);
            if (!item) {
              throw new StudyCredentialRenewalError(
                403,
                "续期单词不属于原学习 session",
              );
            }
            if (
              item.usedAt ||
              item.renewedAt ||
              (item.operationId && item.operationId !== operation.operationId)
            ) {
              throw new StudyCredentialRenewalError(
                409,
                "原学习凭证已经提交或续期",
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

          const now = new Date();
          const consumed = await tx.studySessionItem.updateMany({
            where: {
              id: { in: previous.items.map((item) => item.id) },
              usedAt: null,
              renewedAt: null,
            },
            data: { renewedAt: now },
          });
          if (consumed.count !== operations.length) {
            throw new StudyCredentialRenewalError(409, "学习凭证已被其他请求续期");
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
                })),
              },
            },
            select: {
              id: true,
              expiresAt: true,
              items: { select: { wordId: true, nonce: true } },
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
      session.items.map((item) => [item.wordId, item.nonce]),
    ),
  };
}

export async function cleanupExpiredStudySessions(
  now = new Date(),
  batchSize = 1_000,
) {
  const expired = await prisma.studySession.findMany({
    where: { expiresAt: { lte: now } },
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
