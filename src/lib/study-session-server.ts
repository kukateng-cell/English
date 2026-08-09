import { createHash, randomUUID } from "node:crypto";
import { prisma, Prisma } from "@/lib/prisma";
import { MAX_STUDY_SESSION_WORDS } from "@/lib/study-session";

const STUDY_SESSION_TTL_MS = 30 * 60_000;
const REUSE_MIN_REMAINING_MS = 2 * 60_000;
const MAX_ACTIVE_STUDY_SESSIONS = 2;
const SESSION_TRANSACTION_RETRIES = 3;

export interface IssuedStudySession {
  id: string;
  expiresAt: Date;
  items: Array<{ wordId: string; nonce: string }>;
}

function normalizedWordIds(wordIds: string[]) {
  const ids = [...new Set(wordIds)].sort();
  if (ids.length > MAX_STUDY_SESSION_WORDS) {
    throw new Error("STUDY_SESSION_WORD_LIMIT_EXCEEDED");
  }
  return ids;
}

export function studyQueueFingerprint(wordIds: string[]) {
  return createHash("sha256")
    .update(normalizedWordIds(wordIds).join("\0"))
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
              items: { every: { usedAt: null } },
            },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              expiresAt: true,
              items: { select: { wordId: true, nonce: true } },
            },
          });
          if (reusable && reusable.items.length === ids.length) return reusable;

          const active = await tx.studySession.findMany({
            where: { userId, expiresAt: { gt: now } },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          const sessionsToDelete = active
            .slice(MAX_ACTIVE_STUDY_SESSIONS - 1)
            .map((session) => session.id);
          if (sessionsToDelete.length > 0) {
            await tx.studySession.deleteMany({
              where: { id: { in: sessionsToDelete } },
            });
          }

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
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";
      if (!retryable || attempt === SESSION_TRANSACTION_RETRIES - 1) throw error;
    }
  }
  throw new Error("STUDY_SESSION_TRANSACTION_RETRY_EXHAUSTED");
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
