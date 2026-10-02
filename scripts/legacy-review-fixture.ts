/**
 * Historical database fixture writer used only by compatibility checkers.
 *
 * The product no longer imports or exposes the V1 study writer. Keeping this
 * narrow helper under scripts lets existing isolated-ledger checks construct
 * old rows without making the retired route executable again. It must never be
 * imported by an app route or used for student traffic.
 */
import { createHash } from "node:crypto";
import { prisma, Prisma } from "../src/lib/prisma";
import {
  updateSM2,
  createInitialState,
  type Quality,
} from "../src/lib/sm2";
import { checkInStudyDay } from "../src/lib/streak";
import { achievementsForKeys, checkAchievements } from "../src/lib/achievements";
import { fetchUnitProgress } from "../src/lib/unit-progress-server";
import {
  isRetryableTransactionConflict,
  waitForTransactionRetry,
} from "../src/lib/transaction-retry";

async function computeUnlockInfo(
  userId: string,
  db: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma,
): Promise<{ unitUnlock: Record<string, boolean> }> {
  const aggregations = await fetchUnitProgress(userId, db);
  const unitUnlock: Record<string, boolean> = {};
  for (const level of aggregations) {
    for (const unit of level.units) {
      unitUnlock[`${level.level}::${unit.name}`] = unit.unlocked;
    }
  }
  return { unitUnlock };
}

class StudyRequestError extends Error {
  constructor(
    public readonly status: 403 | 404 | 409,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "StudyRequestError";
  }
}

function reviewStateFromRow(row: {
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewDate: Date;
  lastReviewedAt: Date | null;
}) {
  return {
    easeFactor: row.easeFactor,
    interval: row.interval,
    repetitions: row.repetitions,
    nextReviewDate: row.nextReviewDate,
    lastReviewedAt: row.lastReviewedAt,
  };
}

export async function applyReviewEvent(input: {
  userId: string;
  wordId: string;
  quality: Quality;
  operationId: string;
  studySessionId?: string;
  nonce?: string;
  legacyReplayAfter?: Date;
}) {
  const maxTransactionAttempts = 5;
  for (let attempt = 1; attempt <= maxTransactionAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const globalReceipt = await tx.operationReceipt.findUnique({
            where: {
              userId_operationId: {
                userId: input.userId,
                operationId: input.operationId,
              },
            },
            select: { flowVersion: true },
          });
          if (globalReceipt && globalReceipt.flowVersion !== "v1") {
            throw new StudyRequestError(409, "operationId 已用於不同的學習流程");
          }
          let processed = await tx.reviewEvent.findUnique({
            where: {
              userId_operationId: {
                userId: input.userId,
                operationId: input.operationId,
              },
            },
          });
          if (!processed && input.legacyReplayAfter) {
            processed = await tx.reviewEvent.findFirst({
              where: {
                userId: input.userId,
                submittedWordId: input.wordId,
                isHistorical: false,
                createdAt: { gte: input.legacyReplayAfter },
                OR: [
                  {
                    operationId: { startsWith: "legacy-v1:" },
                    quality: input.quality,
                  },
                  {
                    operationId: { startsWith: "cutover:" },
                    eventKind: "LEGACY_BRIDGE",
                  },
                ],
              },
              orderBy: { createdAt: "desc" },
            });
          }
          if (processed) {
            const unknownTombstone =
              processed.wordId === null &&
              processed.submittedWordId.startsWith("unknown:");
            const legacyBridgeReplay =
              Boolean(input.legacyReplayAfter) &&
              processed.operationId.startsWith("cutover:") &&
              processed.eventKind === "LEGACY_BRIDGE";
            if (
              (!unknownTombstone && processed.submittedWordId !== input.wordId) ||
              (!legacyBridgeReplay && processed.quality !== input.quality)
            ) {
              throw new StudyRequestError(409, "operationId 已用於不同的學習記錄");
            }
            const review = unknownTombstone
              ? null
              : await tx.review.findUnique({
                  where: {
                    userId_wordId: {
                      userId: input.userId,
                      wordId: processed.submittedWordId,
                    },
                  },
                });
            return {
              nextState: review ? reviewStateFromRow(review) : null,
              newlyUnlocked: achievementsForKeys(processed.newlyUnlockedKeys),
              duplicate: true,
            };
          }

          const word = await tx.word.findUnique({
            where: { id: input.wordId },
            select: { term: true, level: true, category: true },
          });
          if (!word) throw new StudyRequestError(404, "單詞不存在");

          if (input.studySessionId || input.nonce) {
            if (!input.studySessionId || !input.nonce) {
              throw new StudyRequestError(403, "學習 session 無效或已過期");
            }
            const sessionItem = await tx.studySessionItem.findUnique({
              where: {
                sessionId_wordId: {
                  sessionId: input.studySessionId,
                  wordId: input.wordId,
                },
              },
              include: {
                session: {
                  select: { userId: true, expiresAt: true, retiredAt: true },
                },
              },
            });
            if (
              !sessionItem ||
              sessionItem.session.userId !== input.userId ||
              sessionItem.nonce !== input.nonce
            ) {
              throw new StudyRequestError(403, "學習 session 無效或已過期");
            }
            if (sessionItem.usedAt) {
              const currentReview = await tx.review.findUnique({
                where: {
                  userId_wordId: {
                    userId: input.userId,
                    wordId: input.wordId,
                  },
                },
              });
              throw new StudyRequestError(409, "該學習題目已經提交", {
                code: "REVIEW_ALREADY_PROCESSED",
                wordId: input.wordId,
                requiresQueueReload: true,
                currentReviewState: currentReview
                  ? reviewStateFromRow(currentReview)
                  : null,
              });
            }
            if (sessionItem.session.retiredAt !== null || sessionItem.renewedAt !== null) {
              throw new StudyRequestError(409, "學習 session 已由較新的憑證取代", {
                code: "SESSION_SUPERSEDED",
                wordId: input.wordId,
                requiresQueueReload: true,
              });
            }
            if (
              sessionItem.session.expiresAt <= new Date() ||
              (sessionItem.operationId !== null &&
                sessionItem.operationId !== input.operationId)
            ) {
              throw new StudyRequestError(403, "學習 session 無效或已過期");
            }
            const consumed = await tx.studySessionItem.updateMany({
              where: { id: sessionItem.id, usedAt: null },
              data: { usedAt: new Date() },
            });
            if (consumed.count !== 1) {
              const currentReview = await tx.review.findUnique({
                where: {
                  userId_wordId: {
                    userId: input.userId,
                    wordId: input.wordId,
                  },
                },
              });
              throw new StudyRequestError(409, "該學習題目已經提交", {
                code: "REVIEW_ALREADY_PROCESSED",
                wordId: input.wordId,
                requiresQueueReload: true,
                currentReviewState: currentReview
                  ? reviewStateFromRow(currentReview)
                  : null,
              });
            }
          }

          const existing = await tx.review.findUnique({
            where: {
              userId_wordId: {
                userId: input.userId,
                wordId: input.wordId,
              },
            },
          });
          if (!existing) {
            const unlockInfo = await computeUnlockInfo(input.userId, tx);
            const unitKey = `${word.level}::${word.category ?? "未分類"}`;
            if (unlockInfo.unitUnlock[unitKey] !== true) {
              throw new StudyRequestError(403, "該單元尚未解鎖");
            }
          }
          const previousState = existing
            ? reviewStateFromRow(existing)
            : createInitialState();
          const nextState = updateSM2(previousState, input.quality);

          // expand trigger 以共用 V2 writer marker 識別 explicit ledger path。
          // 呢個歷史 fixture 仍寫入 V1 形狀資料，但不可因而在明確 ReviewEvent
          // 旁邊額外產生 bridge event。
          await tx.$executeRaw`SELECT set_config('app.review_event_writer', 'v2', true)`;
          await tx.review.upsert({
            where: {
              userId_wordId: {
                userId: input.userId,
                wordId: input.wordId,
              },
            },
            create: {
              userId: input.userId,
              wordId: input.wordId,
              ...nextState,
              totalReviews: 1,
            },
            update: {
              ...nextState,
              totalReviews: { increment: 1 },
            },
          });

          await checkInStudyDay(input.userId, tx);
          const newlyUnlocked = await checkAchievements(input.userId, tx);
          const event = await tx.reviewEvent.create({
            data: {
              userId: input.userId,
              submittedWordId: input.wordId,
              wordId: input.wordId,
              wordTerm: word.term,
              wordLevel: word.level,
              operationId: input.operationId,
              eventKind: "REVIEW",
              quality: input.quality,
              newlyUnlockedKeys: newlyUnlocked.map((achievement) => achievement.key),
            },
          });
          await tx.operationReceipt.create({
            data: {
              userId: input.userId,
              operationId: input.operationId,
              flowVersion: "v1",
              actionKind: "REVIEW",
              requestFingerprint: createHash("sha256")
                .update(JSON.stringify({
                  flowVersion: "v1",
                  actionKind: "REVIEW",
                  wordId: input.wordId,
                  quality: input.quality,
                  studySessionId: input.studySessionId ?? null,
                  nonce: input.nonce ?? null,
                }))
                .digest("hex"),
              outcomeStatus: "SCORED",
              outcomeReference: event.id,
              response: {
                nextState: {
                  ...nextState,
                  nextReviewDate: nextState.nextReviewDate.toISOString(),
                  lastReviewedAt: nextState.lastReviewedAt?.toISOString() ?? null,
                },
                newlyUnlocked: newlyUnlocked.map((achievement) => achievement.key),
              },
            },
          });

          return { nextState, newlyUnlocked, duplicate: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const retryable =
        isRetryableTransactionConflict(error) ||
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
      if (!retryable || attempt === maxTransactionAttempts) throw error;
      await waitForTransactionRetry(attempt - 1);
    }
  }
  throw new Error("Review transaction retry exhausted");
}
