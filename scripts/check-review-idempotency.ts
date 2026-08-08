import dotenv from "dotenv";
import { randomUUID } from "node:crypto";

dotenv.config({ path: ".env.local" });

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { applyReviewEvent } = await import("../src/app/api/study/route");
  const suffix = randomUUID();
  let userId: string | null = null;
  let wordId: string | null = null;
  let sessionWordId: string | null = null;

  try {
    const [historicalReviews, historicalEvents, unmarkedLegacyEvents] =
      await Promise.all([
        prisma.review.aggregate({ _sum: { totalReviews: true } }),
        prisma.reviewEvent.count({ where: { wordId: { not: null } } }),
        prisma.reviewEvent.count({
          where: {
            operationId: { startsWith: "legacy:" },
            isHistorical: false,
          },
        }),
      ]);
    if ((historicalReviews._sum.totalReviews ?? 0) !== historicalEvents) {
      throw new Error(
        `live-word history mismatch: reviews=${historicalReviews._sum.totalReviews ?? 0}, events=${historicalEvents}`,
      );
    }
    if (unmarkedLegacyEvents !== 0) {
      throw new Error("legacy events must be excluded from exact time buckets");
    }

    const user = await prisma.user.create({
      data: {
        email: `codex-idempotency-${suffix}`,
        passwordHash: "not-a-login-account",
        mustChangePassword: false,
      },
    });
    userId = user.id;
    const word = await prisma.word.create({
      data: {
        term: `codex-idempotency-${suffix}`,
        definition: "幂等测试",
        level: "A1",
        category: `codex-${suffix}`,
        synonyms: [],
        antonyms: [],
      },
    });
    wordId = word.id;
    // An existing state is always reviewable; this isolates ledger/concurrency
    // behavior from the progressive-unlock policy exercised by unit tests.
    await prisma.review.create({
      data: { userId, wordId, nextReviewDate: new Date() },
    });

    const firstOperation = `test_${randomUUID()}`;
    const first = await applyReviewEvent({
      userId,
      wordId,
      quality: 5,
      operationId: firstOperation,
    });
    const duplicate = await applyReviewEvent({
      userId,
      wordId,
      quality: 5,
      operationId: firstOperation,
    });
    if (first.duplicate || !duplicate.duplicate) {
      throw new Error("same operationId was not deduplicated");
    }

    await assertRejectsConflict(() =>
      applyReviewEvent({
        userId: user.id,
        wordId: word.id,
        quality: 3,
        operationId: firstOperation,
      }),
    );

    const sessionWord = await prisma.word.create({
      data: {
        term: `codex-session-${suffix}`,
        definition: "session nonce test",
        level: "A1",
        category: `codex-session-${suffix}`,
        synonyms: [],
        antonyms: [],
      },
    });
    sessionWordId = sessionWord.id;
    await prisma.review.create({
      data: { userId, wordId: sessionWordId, nextReviewDate: new Date() },
    });
    const submissionNonce = randomUUID();
    const sessionOperationId = `session_${randomUUID()}`;
    const studySession = await prisma.studySession.create({
      data: {
        userId,
        expiresAt: new Date(Date.now() + 60_000),
        items: {
          create: { wordId: sessionWordId, nonce: submissionNonce },
        },
      },
    });
    const secured = await applyReviewEvent({
      userId,
      wordId: sessionWord.id,
      quality: 5,
      operationId: sessionOperationId,
      studySessionId: studySession.id,
      nonce: submissionNonce,
    });
    if (secured.duplicate) {
      throw new Error("fresh study session submission was treated as duplicate");
    }
    const securedRetry = await applyReviewEvent({
      userId,
      wordId: sessionWord.id,
      quality: 5,
      operationId: sessionOperationId,
      studySessionId: studySession.id,
      nonce: submissionNonce,
    });
    if (!securedRetry.duplicate) {
      throw new Error("study session nonce did not remain idempotent");
    }
    await assertRejectsConflict(() =>
      applyReviewEvent({
        userId: user.id,
        wordId: sessionWordId!,
        quality: 5,
        operationId: `session-reuse_${randomUUID()}`,
        studySessionId: studySession.id,
        nonce: submissionNonce,
      }),
    );

    const legacyReplayAfter = new Date(Date.now() - 10 * 60_000);
    const legacyFirst = await applyReviewEvent({
      userId,
      wordId,
      quality: 5,
      operationId: `legacy-v1:${randomUUID()}`,
      legacyReplayAfter,
    });
    const legacyRetry = await applyReviewEvent({
      userId,
      wordId,
      quality: 5,
      operationId: `legacy-v1:${randomUUID()}`,
      legacyReplayAfter,
    });
    if (legacyFirst.duplicate || !legacyRetry.duplicate) {
      throw new Error("legacy rollout retry was not bounded-deduplicated");
    }

    const concurrentOperations = [
      `test_${randomUUID()}`,
      `test_${randomUUID()}`,
    ];
    await Promise.all(
      concurrentOperations.map((operationId) =>
        applyReviewEvent({
          userId: user.id,
          wordId: word.id,
          quality: 5,
          operationId,
        }),
      ),
    );

    const [review, eventCount] = await Promise.all([
      prisma.review.findUniqueOrThrow({
        where: { userId_wordId: { userId, wordId } },
      }),
      prisma.reviewEvent.count({ where: { userId, wordId } }),
    ]);
    if (
      review.totalReviews !== 4 ||
      review.repetitions !== 4 ||
      eventCount !== 4
    ) {
      throw new Error(
        `unexpected result: reviews=${review.totalReviews}, repetitions=${review.repetitions}, events=${eventCount}`,
      );
    }

    // Simulate an old application instance during an expand/contract rollout:
    // it only updates Review, so the database bridge must append one ledger row.
    await prisma.review.update({
      where: { userId_wordId: { userId, wordId } },
      data: {
        totalReviews: { increment: 1 },
        lastReviewedAt: new Date(),
      },
    });
    const bridgedEvents = await prisma.reviewEvent.count({
      where: { userId, operationId: { startsWith: "cutover:" } },
    });
    if (bridgedEvents !== 1) {
      throw new Error("legacy rollout bridge did not capture the Review update");
    }
    const bridgeRetry = await applyReviewEvent({
      userId,
      wordId,
      quality: 5,
      operationId: `legacy-v1:${randomUUID()}`,
      legacyReplayAfter: new Date(Date.now() - 10 * 60_000),
    });
    const afterBridgeRetry = await prisma.review.findUniqueOrThrow({
      where: { userId_wordId: { userId, wordId } },
    });
    if (!bridgeRetry.duplicate || afterBridgeRetry.totalReviews !== 5) {
      throw new Error("old-writer response-loss retry advanced Review twice");
    }

    await prisma.word.delete({ where: { id: wordId } });
    wordId = null;
    const preservedEvents = await prisma.reviewEvent.count({
      where: { userId, wordId: null },
    });
    if (preservedEvents !== 5) {
      throw new Error("deleting a word removed immutable review history");
    }
    const replayAfterDeletion = await applyReviewEvent({
      userId: user.id,
      wordId: word.id,
      quality: 5,
      operationId: firstOperation,
    });
    if (!replayAfterDeletion.duplicate) {
      throw new Error("deleted-word retry was not replayed as duplicate success");
    }

    // Databases upgraded from the brief nullable-ledger version may only retain
    // unknown:<eventId> for an event whose word was already deleted. The unique
    // user/operationId plus quality must still let the original outbox drain.
    const tombstone = await prisma.reviewEvent.findUniqueOrThrow({
      where: {
        userId_operationId: {
          userId: user.id,
          operationId: concurrentOperations[0],
        },
      },
    });
    await prisma.reviewEvent.update({
      where: { id: tombstone.id },
      data: { submittedWordId: `unknown:${tombstone.id}` },
    });
    const replayUnknownTombstone = await applyReviewEvent({
      userId: user.id,
      wordId: word.id,
      quality: 5,
      operationId: concurrentOperations[0],
    });
    if (!replayUnknownTombstone.duplicate) {
      throw new Error("upgraded tombstone retry was not accepted as duplicate");
    }
    console.log("Review ledger/idempotency/concurrency check passed");
  } finally {
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (wordId) await prisma.word.deleteMany({ where: { id: wordId } });
    if (sessionWordId) await prisma.word.deleteMany({ where: { id: sessionWordId } });
    await prisma.$disconnect();
  }
}

async function assertRejectsConflict(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 409
    ) {
      return;
    }
    throw error;
  }
  throw new Error("mismatched idempotency payload did not return a conflict");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
