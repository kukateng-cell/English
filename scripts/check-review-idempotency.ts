import dotenv from "dotenv";
import { randomUUID } from "node:crypto";

dotenv.config({ path: ".env.local" });

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { applyReviewEvent } = await import("../src/app/api/study/route");
  const {
    issueStudySession,
    renewStudySessionCredentials,
    reuseStudySessionForResume,
    cleanupExpiredStudySessions,
    STUDY_SESSION_RETENTION_MS,
    rotateStudySession,
    serializeStudySession,
    studyQueueFingerprint,
  } = await import("../src/lib/study-session-server");
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
        queueFingerprint: `integration-${suffix}`,
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

    const emptySession = await issueStudySession(userId, []);
    const boundedSessionA = await issueStudySession(userId, [wordId]);
    const reusedSessionA = await issueStudySession(userId, [wordId]);
    const resumedSessionA = await reuseStudySessionForResume(
      user.id,
      boundedSessionA!.id,
      [word.id],
    );
    if (resumedSessionA?.id !== boundedSessionA?.id) {
      throw new Error("resume did not reuse the exact source session");
    }
    const partialSession = await issueStudySession(userId, [
      word.id,
      sessionWord.id,
    ]);
    if (!partialSession) throw new Error("expected partial progress session");
    const partialConsumed = partialSession.items.find(
      (item) => item.wordId === word.id,
    );
    if (!partialConsumed) throw new Error("partial session nonce missing");
    await prisma.studySessionItem.update({
      where: {
        sessionId_wordId: {
          sessionId: partialSession.id,
          wordId: word.id,
        },
      },
      data: { usedAt: new Date() },
    });
    const resumedPartial = await reuseStudySessionForResume(
      user.id,
      partialSession.id,
      [word.id, sessionWord.id],
    );
    if (resumedPartial?.id !== partialSession.id) {
      throw new Error("partial progress checkpoint could not reuse its source");
    }
    const serializedPartial = serializeStudySession(resumedPartial);
    if (serializedPartial?.nonces[word.id] !== undefined) {
      throw new Error("resume exposed a nonce that partial progress already consumed");
    }
    if (!serializedPartial?.nonces[sessionWord.id]) {
      throw new Error("resume omitted the remaining pristine nonce");
    }
    const concurrentSessions = await Promise.all(
      Array.from({ length: 8 }, () =>
        issueStudySession(user.id, [word.id, sessionWord.id]),
      ),
    );
    const concurrentSessionIds = new Set(
      concurrentSessions.map((session) => session?.id),
    );
    if (
      concurrentSessionIds.has(undefined) ||
      concurrentSessionIds.size !== 1
    ) {
      throw new Error(
        `concurrent session issuance did not converge: ${[
          ...concurrentSessionIds,
        ].join(",")}`,
      );
    }
    const boundedSessionB = await issueStudySession(userId, [sessionWordId]);
    if (!boundedSessionB) throw new Error("expected a renewable study session");
    const renewalOperation = `renewal_${randomUUID()}`;
    const renewedSession = await renewStudySessionCredentials(
      user.id,
      boundedSessionB.id,
      [{ operationId: renewalOperation, wordId: sessionWord.id }],
    );
    const renewedReplay = await renewStudySessionCredentials(
      user.id,
      boundedSessionB.id,
      [{ operationId: renewalOperation, wordId: sessionWord.id }],
    );
    if (
      renewedReplay.id !== renewedSession.id ||
      renewedReplay.items[0]?.nonce !== renewedSession.items[0]?.nonce
    ) {
      throw new Error("credential renewal replay did not return the original result");
    }
    const rotationSource = await issueStudySession(userId, [word.id, sessionWord.id]);
    if (!rotationSource) throw new Error("expected rotation source session");
    await assertRejectsStatus(
      () =>
        rotateStudySession(
          user.id,
          rotationSource.id,
          [word.id, sessionWord.id],
          `rotation-too-early-${suffix}`,
        ),
      409,
    );
    await prisma.studySession.update({
      where: { id: rotationSource.id },
      data: { expiresAt: new Date(Date.now() + 4 * 60_000) },
    });
    await prisma.studySessionItem.update({
      where: {
        sessionId_wordId: { sessionId: rotationSource.id, wordId: word.id },
      },
      data: { usedAt: new Date() },
    });
    const rotatedSession = await rotateStudySession(
      user.id,
      rotationSource.id,
      [word.id, sessionWord.id],
      `rotate-${rotationSource.id}`,
    );
    const rotatedReplay = await rotateStudySession(
      user.id,
      rotationSource.id,
      [word.id, sessionWord.id],
      `rotate-${rotationSource.id}`,
    );
    if (
      rotatedReplay.id !== rotatedSession.id ||
      rotatedReplay.items[0]?.nonce !== rotatedSession.items[0]?.nonce
    ) {
      throw new Error("study session rotation replay did not return the original result");
    }
    const serializedRotationReplay = serializeStudySession(rotatedReplay);
    if (serializedRotationReplay?.nonces[word.id] !== undefined) {
      throw new Error("rotation replay exposed a nonce that was already consumed");
    }
    const rotatedUsedItem = rotatedSession.items.find((item) => item.wordId === word.id);
    if (!rotatedUsedItem?.usedAt) {
      throw new Error("rotation reissued a previously used item as available");
    }
    await assertRejectsStatus(
      () =>
        applyReviewEvent({
          userId: user.id,
          wordId: word.id,
          quality: 5,
          operationId: `rotation-used-replay-${randomUUID()}`,
          studySessionId: rotatedSession.id,
          nonce: rotatedUsedItem.nonce,
        }),
      409,
    );
    const retiredRotationSource = await prisma.studySession.findUniqueOrThrow({
      where: { id: rotationSource.id },
    });
    if (!retiredRotationSource.retiredAt) {
      throw new Error("successful rotation did not retire its source session");
    }
    const resumedAfterRotation = await reuseStudySessionForResume(
      user.id,
      rotationSource.id,
      [word.id, sessionWord.id],
    );
    if (resumedAfterRotation?.id !== rotatedSession.id) {
      throw new Error("resume did not follow a response-loss rotation replacement");
    }
    const rotationFirstSource = await prisma.studySession.create({
      data: {
        userId,
        queueFingerprint: studyQueueFingerprint([sessionWord.id]),
        expiresAt: new Date(Date.now() + 4 * 60_000),
        items: {
          create: { wordId: sessionWord.id, nonce: randomUUID() },
        },
      },
    });
    const rotationFirstReplacement = await rotateStudySession(
      user.id,
      rotationFirstSource.id,
      [sessionWord.id],
      `rotate-${rotationFirstSource.id}`,
    );
    const rotationFirstOperation = `rotation-first-renewal_${randomUUID()}`;
    await assertRejectsCode(
      () =>
        renewStudySessionCredentials(user.id, rotationFirstSource.id, [
          {
            operationId: rotationFirstOperation,
            wordId: sessionWord.id,
          },
        ]),
      "SESSION_SUPERSEDED",
    );
    const rotationFirstNonce = serializeStudySession(rotationFirstReplacement)
      ?.nonces[sessionWord.id];
    if (!rotationFirstNonce) {
      throw new Error("rotation-first replacement lost its sole active credential");
    }
    await applyReviewEvent({
      userId: user.id,
      wordId: sessionWord.id,
      quality: 5,
      operationId: rotationFirstOperation,
      studySessionId: rotationFirstReplacement.id,
      nonce: rotationFirstNonce,
    });
    const reboundEvents = await prisma.reviewEvent.count({
      where: { userId: user.id, operationId: rotationFirstOperation },
    });
    if (reboundEvents !== 1) {
      throw new Error("superseded operation did not apply exactly once after rebinding");
    }
    await prisma.studySession.update({
      where: { id: rotationFirstReplacement.id },
      data: { retiredAt: new Date() },
    });

    const renewalFirstSource = await prisma.studySession.create({
      data: {
        userId,
        queueFingerprint: studyQueueFingerprint([sessionWord.id]),
        expiresAt: new Date(Date.now() + 4 * 60_000),
        items: {
          create: { wordId: sessionWord.id, nonce: randomUUID() },
        },
      },
    });
    const renewalFirstOperation = `renewal-first_${randomUUID()}`;
    const renewalFirstReplacement = await renewStudySessionCredentials(
      user.id,
      renewalFirstSource.id,
      [{ operationId: renewalFirstOperation, wordId: sessionWord.id }],
    );
    const rotationAfterRenewal = await rotateStudySession(
      user.id,
      renewalFirstSource.id,
      [sessionWord.id],
      `rotate-${renewalFirstSource.id}`,
    );
    if (serializeStudySession(rotationAfterRenewal)?.nonces[sessionWord.id]) {
      throw new Error("rotation reactivated a credential already owned by renewal");
    }
    const renewalFirstNonce = serializeStudySession(renewalFirstReplacement)
      ?.nonces[sessionWord.id];
    if (!renewalFirstNonce) {
      throw new Error("renewal-first replacement did not retain its credential");
    }
    await applyReviewEvent({
      userId: user.id,
      wordId: sessionWord.id,
      quality: 5,
      operationId: renewalFirstOperation,
      studySessionId: renewalFirstReplacement.id,
      nonce: renewalFirstNonce,
    });
    await assertRejectsStatus(
      () =>
        rotateStudySession(
          user.id,
          rotatedSession.id,
          [word.id, sessionWord.id],
          `rotation-chain-${suffix}`,
        ),
      409,
    );
    const renewedOldItem = await prisma.studySessionItem.findUniqueOrThrow({
      where: {
        sessionId_wordId: {
          sessionId: boundedSessionB.id,
          wordId: sessionWord.id,
        },
      },
    });
    if (!renewedOldItem.renewedAt) {
      throw new Error("credential renewal did not retain and mark its provenance");
    }
    await assertRejectsConflict(() =>
      renewStudySessionCredentials(user.id, boundedSessionB.id, [
        { operationId: `renewal-replay_${randomUUID()}`, wordId: sessionWord.id },
      ]),
    );
    const renewedNonce = renewedSession.items[0]?.nonce;
    if (!renewedNonce) throw new Error("renewal did not issue a nonce");
    const strippedBinding = await reuseStudySessionForResume(
      user.id,
      renewedSession.id,
      [sessionWord.id],
    );
    if (strippedBinding !== null) {
      throw new Error("resume stripped an operation-bound credential");
    }
    await assertRejectsStatus(() =>
      applyReviewEvent({
        userId: user.id,
        wordId: sessionWord.id,
        quality: 5,
        operationId: `wrong-operation_${randomUUID()}`,
        studySessionId: renewedSession.id,
        nonce: renewedNonce,
      }),
      403,
    );
    await applyReviewEvent({
      userId: user.id,
      wordId: sessionWord.id,
      quality: 5,
      operationId: renewalOperation,
      studySessionId: renewedSession.id,
      nonce: renewedNonce,
    });

    for (let index = 0; index < 7; index++) {
      await prisma.studySession.create({
        data: {
          userId,
          queueFingerprint: `cap-${suffix}-${index}`,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
    }
    await issueStudySession(userId, [wordId, sessionWordId]);
    const activeSessionCount = await prisma.studySession.count({
      where: { userId, expiresAt: { gt: new Date() }, retiredAt: null },
    });
    const retainedRetiredSessionCount = await prisma.studySession.count({
      where: { userId, retiredAt: { not: null } },
    });
    if (
      emptySession !== null ||
      !boundedSessionA ||
      boundedSessionA.id !== reusedSessionA?.id ||
      !boundedSessionB ||
      activeSessionCount > 6 ||
      retainedRetiredSessionCount === 0
    ) {
      throw new Error(
        `study session reuse/retirement failed: active=${activeSessionCount}, retired=${retainedRetiredSessionCount}`,
      );
    }

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

    await prisma.word.delete({ where: { id: wordId } });
    wordId = null;
    const preservedEvents = await prisma.reviewEvent.count({
      where: { userId, wordId: null },
    });
    if (preservedEvents !== 4) {
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

    const auditSubject = await prisma.user.create({
      data: {
        email: `codex-audit-subject-${suffix}`,
        passwordHash: "not-a-login-account",
        mustChangePassword: false,
      },
    });
    const securityEvent = await prisma.securityEvent.create({
      data: {
        actor: { connect: { id: userId } },
        subject: { connect: { id: auditSubject.id } },
        subjectAccountHash: `integration-${suffix}`,
        eventType: "USER_DELETED",
      },
    });
    await prisma.user.delete({ where: { id: auditSubject.id } });
    const preservedSecurityEvent = await prisma.securityEvent.findUniqueOrThrow({
      where: { id: securityEvent.id },
    });
    if (
      preservedSecurityEvent.subjectUserId !== null ||
      preservedSecurityEvent.actorUserId !== userId
    ) {
      throw new Error("deleting an audit subject removed event provenance");
    }
    const retentionOld = await prisma.studySession.create({
      data: {
        userId,
        queueFingerprint: `retention-old-${suffix}`,
        expiresAt: new Date(Date.now() - STUDY_SESSION_RETENTION_MS - 1_000),
      },
    });
    const retentionRecent = await prisma.studySession.create({
      data: {
        userId,
        queueFingerprint: `retention-recent-${suffix}`,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await cleanupExpiredStudySessions(new Date(), 100);
    if (
      (await prisma.studySession.findUnique({ where: { id: retentionOld.id } })) !== null ||
      (await prisma.studySession.findUnique({ where: { id: retentionRecent.id } })) === null
    ) {
      throw new Error("study session retention window was not enforced");
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
  return assertRejectsStatus(fn, 409);
}

async function assertRejectsStatus(
  fn: () => Promise<unknown>,
  expectedStatus: number,
) {
  try {
    await fn();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === expectedStatus
    ) {
      return;
    }
    throw error;
  }
  throw new Error(`operation did not return expected status ${expectedStatus}`);
}

async function assertRejectsCode(
  fn: () => Promise<unknown>,
  expectedCode: string,
) {
  try {
    await fn();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 409 &&
      "details" in error &&
      typeof error.details === "object" &&
      error.details !== null &&
      "code" in error.details &&
      error.details.code === expectedCode
    ) {
      return;
    }
    throw error;
  }
  throw new Error(`operation did not return expected code ${expectedCode}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
