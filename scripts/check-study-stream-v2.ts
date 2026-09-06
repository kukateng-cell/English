import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import type { StudyStreamActionInput } from "../src/lib/study-stream/contracts";
import type { Prisma as PrismaTypes } from "../src/generated/prisma";
import { CATALOG_CATEGORIES } from "../src/lib/catalog/taxonomy";
import {
  currentCatalogWordCtesSql,
  withCurrentCatalogWord,
} from "../src/lib/catalog/runtime";
import { unitCategoryToStorage } from "../src/lib/units";

dotenv.config({ path: ".env.local" });

async function main() {
  const { Prisma, prisma } = await import("../src/lib/prisma");
  const { applyReviewEvent } = await import("../src/app/api/study/route");
  const {
    applyStudyStreamAction,
    getOrCreateStudyStream,
    createStudyStreamRecoveryCredential,
    prepareStudyStreamActionRecovery,
    reconcileStudyStreamAction,
    recoverExpiredStudyStreamAction,
    renewStudyStreamCredential,
    StudyStreamError,
  } = await import("../src/lib/study-stream/server");
  const {
    createStudyStreamCredential,
    digestStudyStreamCredential,
  } = await import("../src/lib/study-stream/contracts");
  const { getStudentDashboard, getStudentLearningMetrics } = await import("../src/lib/student-metrics");
  const { fetchUnitProgress } = await import("../src/lib/unit-progress-server");
  const { cleanupExpiredStudySessions, STUDY_SESSION_RETENTION_MS } = await import("../src/lib/study-session-server");
  const { getLeaderboard } = await import("../src/lib/leaderboard");
  const { todayKey } = await import("../src/lib/streak");
  const { authOptions, validateAuthTokenVersion } = await import("../src/lib/auth");
  const suffix = randomUUID();
  const testUnitCategory = CATALOG_CATEGORIES[0];
  let userId: string | null = null;
  let studyDayOnlyUserId: string | null = null;
  let scheduleGapUserId: string | null = null;
  let obligationGapUserId: string | null = null;
  let longHistoryUserId: string | null = null;
  const wordIds: string[] = [];
  const cleanupWordIds: string[] = [];
  const catalogFixtureWordIds: string[] = [];
  const catalogFixtureSenseIds: string[] = [];
  const catalogFixtureEntryIds: string[] = [];
  const catalogFixtureRevisionIds: string[] = [];
  const catalogFixtureCatalogRevisionIds: string[] = [];
  const objectiveQuestionSnapshotIds: string[] = [];

  try {
    const user = await prisma.user.create({
      data: {
        accountName: `codex-stream-${suffix}`,
        passwordHash: "not-a-login-account",
        mustChangePassword: false,
        studentProfile: {
          create: {
            legalName: "串流測試學生",
            nickname: "串流測試生",
            nicknameNormalized: "串流測試生",
          },
        },
      },
    });
    userId = user.id;
    const currentAcademicYear = await prisma.academicYear.findFirstOrThrow({ where: { status: "CURRENT" } });
    await prisma.studentEnrollment.create({
      data: {
        studentId: user.id,
        academicYearId: currentAcademicYear.id,
        grade: "JUNIOR_1",
      status: "ACTIVE",
      isCurrent: true,
        origin: "SEED",
        startedAt: new Date(),
      },
    });

    const jwtCallback = authOptions.callbacks?.jwt;
    assert.ok(jwtCallback);
    type JwtCallbackInput = Parameters<typeof jwtCallback>[0];
    const initialToken = await jwtCallback({
      token: {},
      user: {
        id: user.id,
        email: user.accountName,
        name: user.legacyName,
        accountName: user.accountName,
        displayName: user.legacyName ?? user.accountName,
        role: user.role,
        tokenVersion: user.tokenVersion,
        mustChangePassword: user.mustChangePassword,
      },
      account: null,
      profile: undefined,
      trigger: "signIn",
      isNewUser: false,
    } satisfies JwtCallbackInput);
    await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
    await assert.rejects(
      validateAuthTokenVersion(initialToken),
      /SESSION_INVALIDATED/,
    );
    await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: user.tokenVersion } });

    const currentWords = await prisma.word.findMany({
      where: withCurrentCatalogWord(),
      orderBy: [{ level: "asc" }, { category: "asc" }, { term: "asc" }, { id: "asc" }],
      take: 8,
      select: { id: true },
    });
    if (currentWords.length < 8) throw new Error("current CSV catalog has fewer than eight words for the V2 smoke test");
    wordIds.push(...currentWords.map((word) => word.id));

    const bootstrap = await getOrCreateStudyStream(user.id);
    assert.equal(bootstrap.assigned, true);
    assert.ok(bootstrap.item);
    assert.equal(bootstrap.item.kind, "LEARNING_CARD");
    assert.equal(bootstrap.item.learningCard, undefined);
    const learningItem = bootstrap.item;
    const sessionId = bootstrap.session.id;

    const unitBootstrap = await getOrCreateStudyStream(user.id, {
      mode: "unit",
      level: "A1",
      category: testUnitCategory,
    });
    assert.equal(unitBootstrap.session.mode, "unit");
    assert.ok(unitBootstrap.item);
    assert.equal(unitBootstrap.item.kind, "LEARNING_CARD");
    assert.ok(unitBootstrap.item.prompt.length > 0);
    assert.ok(unitBootstrap.unitSummary);
    assert.ok(unitBootstrap.unitSummary.totalWordCount > 0);
    assert.equal(unitBootstrap.unitSummary.objectiveRecognitionCount, 0);
    assert.equal(unitBootstrap.unitSummary.encounteredWordCount, 0);

    const revealInput: StudyStreamActionInput = {
      flowVersion: "v2",
      studySessionId: sessionId,
      streamItemId: learningItem.streamItemId,
      operationId: `stream-reveal-${suffix}`,
      itemCredential: learningItem.itemCredential,
      actionKind: "REVEAL",
      clientKnownRevision: learningItem.clientRevision,
      payload: {},
    };
    const revealed = await applyStudyStreamAction(user.id, revealInput);
    assert.equal(revealed.duplicate, false);
    assert.equal(revealed.response.learningCard?.term, learningItem.prompt);

    const selfRatingInput: StudyStreamActionInput = {
      flowVersion: "v2",
      studySessionId: sessionId,
      streamItemId: learningItem.streamItemId,
      operationId: `stream-self-${suffix}`,
      itemCredential: learningItem.itemCredential,
      actionKind: "SELF_RATING",
      clientKnownRevision: learningItem.clientRevision,
      payload: { selfRating: "selfRecalled" },
    };
    const selfRated = await applyStudyStreamAction(user.id, selfRatingInput);
    assert.equal(selfRated.response.requiresFeedbackAck, false);
    assert.equal(selfRated.response.itemStatus, "ACKNOWLEDGED");
    assert.equal(selfRated.response.evidenceObligation?.created, true);
    await assert.rejects(
      () => applyStudyStreamAction(user.id, {
        ...selfRatingInput,
        operationId: `stream-late-self-${suffix}`,
      }),
      (error: unknown) => error instanceof StudyStreamError && error.status === 409 && error.details.code === "STREAM_ITEM_COMPLETED",
    );
    await assert.rejects(
      () => applyStudyStreamAction(user.id, {
        ...selfRatingInput,
        operationId: `stream-late-reveal-${suffix}`,
        actionKind: "REVEAL",
        payload: {},
      }),
      (error: unknown) => error instanceof StudyStreamError && error.status === 409 && error.details.code === "STREAM_ITEM_COMPLETED",
    );
    await assert.rejects(
      () => reconcileStudyStreamAction(user.id, {
        ...selfRatingInput,
        payload: { selfRating: "selfForgot" },
      }),
      (error: unknown) => error instanceof StudyStreamError && error.status === 409 && error.message.includes("operationId"),
    );
    assert.ok(selfRated.response.evidenceObligation?.obligationId);
    assert.equal(await prisma.review.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.studyEncounter.count({ where: { userId: user.id } }), 1);
    const obligation = await prisma.evidenceObligation.findFirstOrThrow({
      where: { userId: user.id, kind: "EVIDENCE_OBLIGATION" },
    });
    const encounter = await prisma.studyEncounter.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(encounter.evidenceObligationId, obligation.id);

    // Six independent stream items race to admit verification work. The
    // learner row lock in the action transaction must make the combined cap
    // observable, not merely a best-effort application-level count.
    const concurrentItems = await Promise.all(wordIds.slice(1, 7).map(async (wordId, index) => {
      const credential = createStudyStreamCredential();
      const session = await prisma.studySession.create({
        data: {
          userId: user.id,
          queueFingerprint: `concurrent-${suffix}-${index}`,
          expiresAt: new Date(Date.now() + 30 * 60_000),
          flowVersion: "v2",
          learningPolicyVersion: "retrieval-v1",
          mode: "global",
          revision: 0,
          streamItems: {
            create: {
              streamItemKey: `concurrent-${suffix}-${index}`,
              wordId,
              itemKind: "LEARNING_CARD",
              selectionReason: "concurrency-test",
              policyVersion: "retrieval-v1",
              status: "LEASED",
              leaseExpiresAt: new Date(Date.now() + 15 * 60_000),
              credentialDigest: digestStudyStreamCredential(credential),
              credentialExpiresAt: new Date(Date.now() + 15 * 60_000),
              revealedAt: new Date(),
              clientRevision: 0,
            },
          },
        },
        include: { streamItems: true },
      });
      const item = session.streamItems[0];
      assert.ok(item);
      return {
        sessionId: session.id,
        streamItemId: item.id,
        credential,
        operationId: `stream-concurrent-${suffix}-${index}`,
      };
    }));
    const concurrentResults = await Promise.all(concurrentItems.map((item) =>
      applyStudyStreamAction(user.id, {
        flowVersion: "v2",
        studySessionId: item.sessionId,
        streamItemId: item.streamItemId,
        operationId: item.operationId,
        itemCredential: item.credential,
        actionKind: "SELF_RATING",
        clientKnownRevision: 0,
        payload: { selfRating: "selfRecalled" },
      }),
    ));
    const acceptedConcurrent = concurrentResults.filter((result) => result.response.evidenceObligation?.created);
    assert.equal(acceptedConcurrent.length, 4);
    assert.equal(
      await prisma.evidenceObligation.count({ where: { userId: user.id, status: { in: ["PENDING", "LEASED"] } } }),
      5,
    );

    // Two devices submitting the same stream item with different operationIds
    // must converge on one committed encounter. The loser must receive a
    // visible conflict instead of a second scored/acknowledged outcome.
    const raceCredential = createStudyStreamCredential();
    const raceSession = await prisma.studySession.create({
      data: {
        userId: user.id,
        queueFingerprint: `same-item-race-${suffix}`,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        flowVersion: "v2",
        learningPolicyVersion: "retrieval-v1",
        mode: "global",
        revision: 0,
        streamItems: {
          create: {
            streamItemKey: `same-item-race-${suffix}`,
            wordId: wordIds[7],
            itemKind: "LEARNING_CARD",
            selectionReason: "concurrency-test",
            policyVersion: "retrieval-v1",
            status: "LEASED",
            leaseExpiresAt: new Date(Date.now() + 15 * 60_000),
            credentialDigest: digestStudyStreamCredential(raceCredential),
            credentialExpiresAt: new Date(Date.now() + 15 * 60_000),
            revealedAt: new Date(),
            clientRevision: 0,
          },
        },
      },
      include: { streamItems: true },
    });
    const raceItem = raceSession.streamItems[0];
    assert.ok(raceItem);
    const sameWordSecondItem = await prisma.studyStreamItem.create({
      data: {
        sessionId: raceSession.id,
        streamItemKey: `same-item-second-${suffix}`,
        wordId: wordIds[7],
        itemKind: "LEARNING_CARD",
        selectionReason: "same-word-identity-test",
        policyVersion: "retrieval-v1",
        status: "ACKNOWLEDGED",
        leaseExpiresAt: new Date(Date.now() + 15 * 60_000),
        credentialDigest: digestStudyStreamCredential(createStudyStreamCredential()),
        credentialExpiresAt: new Date(Date.now() + 15 * 60_000),
        revealedAt: new Date(),
        usedAt: new Date(),
        feedbackAcknowledgedAt: new Date(),
        operationId: `same-word-second-${suffix}`,
        clientRevision: 0,
      },
    });
    assert.notEqual(sameWordSecondItem.id, raceItem.id);
    assert.equal(
      await prisma.studyStreamItem.count({ where: { sessionId: raceSession.id, wordId: wordIds[7] } }),
      2,
    );
    const firstRaceRenewal = await renewStudyStreamCredential(user.id, {
      studySessionId: raceSession.id,
      streamItemId: raceItem.id,
      itemCredential: raceCredential,
      clientKnownRevision: 0,
    });
    const secondRaceRenewal = await renewStudyStreamCredential(user.id, {
      studySessionId: raceSession.id,
      streamItemId: raceItem.id,
      itemCredential: raceCredential,
      clientKnownRevision: 0,
    });
    assert.notEqual(firstRaceRenewal.itemCredential, secondRaceRenewal.itemCredential);
    const raceLineage = await prisma.studyStreamItem.findUniqueOrThrow({
      where: { id: raceItem.id },
      select: { credentialLineage: true },
    });
    assert.ok(Array.isArray(raceLineage.credentialLineage));
    assert.ok(raceLineage.credentialLineage.length >= 3);
    const raceCredentials = [firstRaceRenewal.itemCredential, secondRaceRenewal.itemCredential];
    const raceResults = await Promise.allSettled([0, 1].map((index) => applyStudyStreamAction(user.id, {
      flowVersion: "v2",
      studySessionId: raceSession.id,
      streamItemId: raceItem.id,
      operationId: `same-item-race-${suffix}-${index}`,
      itemCredential: raceCredentials[index],
      actionKind: "SELF_RATING",
      clientKnownRevision: 0,
      payload: { selfRating: "selfForgot" },
    })));
    const raceSuccesses = raceResults.filter((result) => result.status === "fulfilled");
    const raceFailures = raceResults.filter((result) => result.status === "rejected");
    assert.equal(raceSuccesses.length, 1);
    assert.equal(raceFailures.length, 1);
    assert.ok(raceFailures[0]?.status === "rejected" && raceFailures[0].reason instanceof StudyStreamError);
    if (raceFailures[0]?.status === "rejected" && raceFailures[0].reason instanceof StudyStreamError) {
      assert.equal(raceFailures[0].reason.status, 409);
      assert.equal(raceFailures[0].reason.details.code, "STREAM_ITEM_COMPLETED");
    }

    const expiredCredential = createStudyStreamCredential();
    const expiredSession = await prisma.studySession.create({
      data: {
        userId: user.id,
        queueFingerprint: `expired-lease-${suffix}`,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        flowVersion: "v2",
        learningPolicyVersion: "retrieval-v1",
        mode: "global",
        revision: 0,
        streamItems: {
          create: {
            streamItemKey: `expired-lease-${suffix}`,
            wordId: wordIds[6],
            itemKind: "LEARNING_CARD",
            selectionReason: "expiry-test",
            policyVersion: "retrieval-v1",
            status: "LEASED",
            leaseExpiresAt: new Date(Date.now() - 1_000),
            credentialDigest: digestStudyStreamCredential(expiredCredential),
            credentialExpiresAt: new Date(Date.now() + 15 * 60_000),
            revealedAt: new Date(),
            clientRevision: 0,
          },
        },
      },
      include: { streamItems: true },
    });
    const expiredItem = expiredSession.streamItems[0];
    assert.ok(expiredItem);
    await assert.rejects(
      () => applyStudyStreamAction(user.id, {
        flowVersion: "v2",
        studySessionId: expiredSession.id,
        streamItemId: expiredItem.id,
        operationId: `expired-lease-action-${suffix}`,
        itemCredential: expiredCredential,
        actionKind: "SELF_RATING",
        clientKnownRevision: 0,
        payload: { selfRating: "selfForgot" },
      }),
      (error: unknown) => error instanceof StudyStreamError && error.details.code === "EXPIRED_ITEM_LEASE",
    );
    const recoveredLeaseReveal: StudyStreamActionInput = {
      flowVersion: "v2",
      studySessionId: expiredSession.id,
      streamItemId: expiredItem.id,
      operationId: `expired-lease-recovery-${suffix}`,
      itemCredential: expiredCredential,
      actionKind: "REVEAL",
      clientKnownRevision: 0,
      payload: {},
    };
    const leaseRecovery = await recoverExpiredStudyStreamAction(user.id, recoveredLeaseReveal);
    assert.equal(leaseRecovery.response.ok, true);
    assert.equal(leaseRecovery.duplicate, false);
    const leaseRecoveryRow = await prisma.studyStreamItem.findUniqueOrThrow({
      where: { id: expiredItem.id },
      select: { leaseExpiresAt: true },
    });
    assert.ok(leaseRecoveryRow.leaseExpiresAt.getTime() > Date.now());
    const renewed = await renewStudyStreamCredential(user.id, {
      studySessionId: expiredSession.id,
      streamItemId: expiredItem.id,
      itemCredential: expiredCredential,
      clientKnownRevision: 0,
    });
    assert.notEqual(renewed.itemCredential, expiredCredential);
    const renewedRow = await prisma.studyStreamItem.findUniqueOrThrow({
      where: { id: expiredItem.id },
      select: { leaseExpiresAt: true, credentialExpiresAt: true },
    });
    assert.ok(renewedRow.leaseExpiresAt.getTime() > Date.now());
    assert.ok(renewedRow.credentialExpiresAt.getTime() > Date.now());
    await prisma.studyStreamItem.update({
      where: { id: expiredItem.id },
      data: {
        credentialExpiresAt: new Date(Date.now() - 1_000),
        credentialLineage: [{
          digest: digestStudyStreamCredential(renewed.itemCredential),
          issuedAt: Date.now() - 16 * 60_000,
          expiresAt: Date.now() - 1_000,
          parentDigest: null,
        }],
      },
    });
    const rotatedAfterExpiry = await getOrCreateStudyStream(user.id, {
      itemCredential: renewed.itemCredential,
    });
    assert.equal(rotatedAfterExpiry.session.id, expiredSession.id);
    assert.ok(rotatedAfterExpiry.item);
    assert.notEqual(rotatedAfterExpiry.item.itemCredential, renewed.itemCredential);
    const expiredCredentialAction: StudyStreamActionInput = {
      flowVersion: "v2",
      studySessionId: expiredSession.id,
      streamItemId: expiredItem.id,
      operationId: `expired-credential-recovery-${suffix}`,
      itemCredential: renewed.itemCredential,
      actionKind: "REVEAL",
      clientKnownRevision: 0,
      payload: {},
    };
    await assert.rejects(
      () => applyStudyStreamAction(user.id, {
        ...expiredCredentialAction,
        operationId: `unknown-credential-${suffix}`,
        itemCredential: "not-issued-by-the-study-server",
      }),
      (error: unknown) => error instanceof StudyStreamError && error.status === 403 && error.details.code === "ITEM_CREDENTIAL_INVALID",
    );
    await assert.rejects(
      () => applyStudyStreamAction(user.id, expiredCredentialAction),
      (error: unknown) => error instanceof StudyStreamError && error.status === 403 && error.details.code === "ITEM_CREDENTIAL_EXPIRED",
    );
    const credentialRecovery = await recoverExpiredStudyStreamAction(user.id, expiredCredentialAction);
    assert.equal(credentialRecovery.response.ok, true);
    assert.equal(credentialRecovery.duplicate, false);
    const replayedCredentialRecovery = await recoverExpiredStudyStreamAction(user.id, expiredCredentialAction);
    assert.equal(replayedCredentialRecovery.duplicate, true);
    assert.deepEqual(replayedCredentialRecovery.response, credentialRecovery.response);
    await prisma.studySession.update({ where: { id: expiredSession.id }, data: { retiredAt: new Date() } });
    await assert.rejects(
      () => applyStudyStreamAction(user.id, {
        flowVersion: "v2",
        studySessionId: expiredSession.id,
        streamItemId: expiredItem.id,
        operationId: `retired-session-action-${suffix}`,
        itemCredential: renewed.itemCredential,
        actionKind: "SELF_RATING",
        clientKnownRevision: 0,
        payload: { selfRating: "selfForgot" },
      }),
      (error: unknown) => error instanceof StudyStreamError && error.status === 403,
    );
    await prisma.studySession.update({
      where: { id: expiredSession.id },
      data: { retiredAt: null, expiresAt: new Date(Date.now() - 1_000) },
    });
    await assert.rejects(
      () => applyStudyStreamAction(user.id, {
        flowVersion: "v2",
        studySessionId: expiredSession.id,
        streamItemId: expiredItem.id,
        operationId: `expired-session-action-${suffix}`,
        itemCredential: renewed.itemCredential,
        actionKind: "SELF_RATING",
        clientKnownRevision: 0,
        payload: { selfRating: "selfForgot" },
      }),
      (error: unknown) => error instanceof StudyStreamError && error.status === 403 && error.details.code === "SESSION_EXPIRED",
    );
    const recoveredAction: StudyStreamActionInput = {
      flowVersion: "v2",
      studySessionId: expiredSession.id,
      streamItemId: expiredItem.id,
      operationId: `expired-session-recovery-${suffix}`,
      itemCredential: renewed.itemCredential,
      actionKind: "SELF_RATING",
      clientKnownRevision: 0,
      payload: { selfRating: "selfForgot" },
    };
    const recovered = await recoverExpiredStudyStreamAction(user.id, recoveredAction);
    assert.equal(recovered.response.ok, true);
    assert.equal(recovered.duplicate, false);
    const replayedRecovery = await recoverExpiredStudyStreamAction(user.id, recoveredAction);
    assert.equal(replayedRecovery.duplicate, true);
    assert.deepEqual(replayedRecovery.response, recovered.response);

    // A second device can rotate the same item's short-lived credential more
    // times than the bounded lineage retains. Once that item has an
    // authoritative terminal outcome, the old device must converge on the
    // terminal result instead of being trapped in a credential-invalid
    // outbox retry. The terminal check must not revive or extend the session.
    const evictedInitialCredential = createStudyStreamCredential();
    const evictedSession = await prisma.studySession.create({
      data: {
        userId: user.id,
        queueFingerprint: `evicted-completed-${suffix}`,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        flowVersion: "v2",
        learningPolicyVersion: "retrieval-v1",
        mode: "global",
        revision: 0,
        streamItems: {
          create: {
            streamItemKey: `evicted-completed-${suffix}`,
            wordId: wordIds[4],
            itemKind: "LEARNING_CARD",
            selectionReason: "credential-eviction-test",
            policyVersion: "retrieval-v1",
            status: "LEASED",
            leaseExpiresAt: new Date(Date.now() + 15 * 60_000),
            credentialDigest: digestStudyStreamCredential(evictedInitialCredential),
            credentialExpiresAt: new Date(Date.now() + 15 * 60_000),
            credentialLineage: [{
              digest: digestStudyStreamCredential(evictedInitialCredential),
              issuedAt: Date.now(),
              expiresAt: Date.now() + 15 * 60_000,
              parentDigest: null,
            }],
            clientRevision: 0,
          },
        },
      },
      include: { streamItems: true },
    });
    const evictedItem = evictedSession.streamItems[0];
    assert.ok(evictedItem);
    let evictedCurrentCredential = evictedInitialCredential;
    let credentialAfterOneRotation = evictedInitialCredential;
    let credentialAfterSevenRotations = evictedInitialCredential;
    for (let rotation = 1; rotation <= 8; rotation += 1) {
      const renewal = await renewStudyStreamCredential(user.id, {
        studySessionId: evictedSession.id,
        streamItemId: evictedItem.id,
        itemCredential: evictedCurrentCredential,
        clientKnownRevision: 0,
      });
      evictedCurrentCredential = renewal.itemCredential;
      if (rotation === 1) credentialAfterOneRotation = renewal.itemCredential;
      if (rotation === 7) credentialAfterSevenRotations = renewal.itemCredential;
    }
    const evictedLineage = await prisma.studyStreamItem.findUniqueOrThrow({
      where: { id: evictedItem.id },
      select: { credentialLineage: true },
    });
    assert.ok(Array.isArray(evictedLineage.credentialLineage));
    const evictedLineageDigests = evictedLineage.credentialLineage.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null || !("digest" in entry)) return [];
      return typeof entry.digest === "string" ? [entry.digest] : [];
    });
    // The original grant remains as a bounded recovery anchor even after
    // eight rotations; only the middle lineage entries are evicted.
    assert.equal(evictedLineageDigests.includes(digestStudyStreamCredential(evictedInitialCredential)), true);
    assert.equal(evictedLineageDigests.includes(digestStudyStreamCredential(credentialAfterOneRotation)), false);
    assert.equal(evictedLineageDigests.includes(digestStudyStreamCredential(credentialAfterSevenRotations)), true);

    const evictedReveal = await applyStudyStreamAction(user.id, {
      flowVersion: "v2",
      studySessionId: evictedSession.id,
      streamItemId: evictedItem.id,
      operationId: `evicted-device-b-reveal-${suffix}`,
      itemCredential: evictedCurrentCredential,
      actionKind: "REVEAL",
      clientKnownRevision: 0,
      payload: {},
    });
    assert.equal(evictedReveal.response.itemStatus, "LEASED");
    const evictedCompletion = await applyStudyStreamAction(user.id, {
      flowVersion: "v2",
      studySessionId: evictedSession.id,
      streamItemId: evictedItem.id,
      operationId: `evicted-device-b-self-${suffix}`,
      itemCredential: evictedCurrentCredential,
      actionKind: "SELF_RATING",
      clientKnownRevision: 0,
      payload: { selfRating: "selfRecalled" },
    });
    assert.equal(evictedCompletion.response.itemStatus, "ACKNOWLEDGED");
    const evictedEncounterCount = await prisma.studyEncounter.count({ where: { userId: user.id } });
    const evictedReceiptCount = await prisma.operationReceipt.count({ where: { userId: user.id } });
    const oldDeviceAction: StudyStreamActionInput = {
      flowVersion: "v2",
      studySessionId: evictedSession.id,
      streamItemId: evictedItem.id,
      operationId: `evicted-device-a-self-${suffix}`,
      itemCredential: evictedInitialCredential,
      actionKind: "SELF_RATING",
      clientKnownRevision: 0,
      payload: { selfRating: "selfForgot" },
    };
    // The old grant is still recognized, but a terminal item remains a
    // non-mutating conflict. Clients may remove exactly this operation after
    // the authoritative terminal check.
    await assert.rejects(
      () => applyStudyStreamAction(user.id, oldDeviceAction),
      (error: unknown) => error instanceof StudyStreamError && error.status === 409 && error.details.code === "STREAM_ITEM_COMPLETED",
    );
    const activeTerminal = await reconcileStudyStreamAction(user.id, oldDeviceAction);
    assert.equal(activeTerminal.ok, true);
    assert.equal(activeTerminal.terminal, true);
    if (activeTerminal.terminal) assert.equal(activeTerminal.code, "STREAM_ITEM_COMPLETED");
    const evictedCredentialAction: StudyStreamActionInput = {
      ...oldDeviceAction,
      operationId: `evicted-device-a-evicted-credential-${suffix}`,
      itemCredential: credentialAfterOneRotation,
    };
    await assert.rejects(
      () => applyStudyStreamAction(user.id, evictedCredentialAction),
      (error: unknown) => error instanceof StudyStreamError && error.status === 403 && error.details.code === "ITEM_CREDENTIAL_INVALID",
    );
    const evictedCredentialTerminal = await reconcileStudyStreamAction(user.id, evictedCredentialAction);
    assert.equal(evictedCredentialTerminal.ok, true);
    assert.equal(evictedCredentialTerminal.terminal, true);
    await prisma.studySession.update({
      where: { id: evictedSession.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const expiredTerminalEncounterCount = await prisma.studyEncounter.count({ where: { userId: user.id } });
    const expiredTerminalReceiptCount = await prisma.operationReceipt.count({ where: { userId: user.id } });
    const expiredEvictedCredentialAction: StudyStreamActionInput = {
      ...evictedCredentialAction,
      operationId: `evicted-device-a-expired-evicted-credential-${suffix}`,
    };
    await assert.rejects(
      () => applyStudyStreamAction(user.id, expiredEvictedCredentialAction),
      (error: unknown) => error instanceof StudyStreamError && error.status === 403 && error.details.code === "ITEM_CREDENTIAL_INVALID",
    );
    const expiredEvictedCredentialTerminal = await reconcileStudyStreamAction(user.id, expiredEvictedCredentialAction);
    assert.equal(expiredEvictedCredentialTerminal.ok, true);
    assert.equal(expiredEvictedCredentialTerminal.terminal, true);
    if (expiredEvictedCredentialTerminal.terminal) assert.equal(expiredEvictedCredentialTerminal.code, "STREAM_ITEM_COMPLETED");
    assert.equal(await prisma.studyEncounter.count({ where: { userId: user.id } }), expiredTerminalEncounterCount);
    assert.equal(await prisma.operationReceipt.count({ where: { userId: user.id } }), expiredTerminalReceiptCount);
    const retainedTerminalExpiryBefore = await prisma.studySession.findUniqueOrThrow({
      where: { id: evictedSession.id },
      select: { expiresAt: true },
    });
    await assert.rejects(
      () => recoverExpiredStudyStreamAction(user.id, {
        ...oldDeviceAction,
        operationId: `evicted-device-retained-recovery-${suffix}`,
        itemCredential: credentialAfterSevenRotations,
      }),
      (error: unknown) => error instanceof StudyStreamError && error.status === 409 && error.details.code === "STREAM_ITEM_COMPLETED",
    );
    const retainedTerminalExpiryAfter = await prisma.studySession.findUniqueOrThrow({
      where: { id: evictedSession.id },
      select: { expiresAt: true },
    });
    assert.equal(retainedTerminalExpiryAfter.expiresAt.getTime(), retainedTerminalExpiryBefore.expiresAt.getTime());
    await assert.rejects(
      () => applyStudyStreamAction(user.id, oldDeviceAction),
      (error: unknown) => error instanceof StudyStreamError && error.status === 403 && error.details.code === "SESSION_EXPIRED",
    );
    await assert.rejects(
      () => recoverExpiredStudyStreamAction(user.id, {
        ...oldDeviceAction,
        operationId: `evicted-device-a-recovery-${suffix}`,
      }),
      (error: unknown) => error instanceof StudyStreamError && error.status === 409 && error.details.code === "STREAM_ITEM_COMPLETED",
    );
    const expiredTerminal = await reconcileStudyStreamAction(user.id, {
      ...oldDeviceAction,
      operationId: `evicted-device-a-reconcile-${suffix}`,
    });
    assert.equal(expiredTerminal.ok, true);
    assert.equal(expiredTerminal.terminal, true);
    if (expiredTerminal.terminal) assert.equal(expiredTerminal.code, "STREAM_ITEM_COMPLETED");
    const unknownCredentialAction: StudyStreamActionInput = {
      ...oldDeviceAction,
      operationId: `evicted-device-unknown-${suffix}`,
      itemCredential: createStudyStreamCredential(),
    };
    await assert.rejects(
      () => applyStudyStreamAction(user.id, unknownCredentialAction),
      (error: unknown) => error instanceof StudyStreamError && error.status === 403 && error.details.code === "ITEM_CREDENTIAL_INVALID",
    );
    const unknownCredentialReconciliation = await reconcileStudyStreamAction(user.id, unknownCredentialAction);
    assert.equal(unknownCredentialReconciliation.ok, true);
    assert.equal(unknownCredentialReconciliation.terminal, true);
    if (unknownCredentialReconciliation.terminal) assert.equal(unknownCredentialReconciliation.code, "STREAM_ITEM_COMPLETED");
    await assert.rejects(
      () => reconcileStudyStreamAction(studyDayOnlyUserId!, unknownCredentialAction),
      (error: unknown) => error instanceof StudyStreamError && error.status === 403,
    );
    await prisma.studySession.update({
      where: { id: evictedSession.id },
      data: { retiredAt: new Date() },
    });
    await assert.rejects(
      () => reconcileStudyStreamAction(user.id, unknownCredentialAction),
      (error: unknown) => error instanceof StudyStreamError && error.status === 403 && error.details.code === "SESSION_REVOKED",
    );
    const evictedCompletedRow = await prisma.studyStreamItem.findUniqueOrThrow({
      where: { id: evictedItem.id },
      select: { status: true, usedAt: true },
    });
    assert.equal(evictedCompletedRow.status, "ACKNOWLEDGED");
    assert.ok(evictedCompletedRow.usedAt);
    assert.equal(await prisma.studyEncounter.count({ where: { userId: user.id } }), evictedEncounterCount);
    assert.equal(await prisma.operationReceipt.count({ where: { userId: user.id } }), evictedReceiptCount);
    const evictedSessionAfterTerminal = await prisma.studySession.findUniqueOrThrow({
      where: { id: evictedSession.id },
      select: { expiresAt: true },
    });
    assert.ok(evictedSessionAfterTerminal.expiresAt.getTime() <= Date.now());

    // The same eight-rotation boundary keeps the original grant recognizable
    // for an unresolved item. Recovery still requires the exact typed action,
    // and it never accepts an unknown credential.
    const pendingInitialCredential = createStudyStreamCredential();
    const pendingSession = await prisma.studySession.create({
      data: {
        userId: user.id,
        queueFingerprint: `evicted-pending-${suffix}`,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        flowVersion: "v2",
        learningPolicyVersion: "retrieval-v1",
        mode: "global",
        revision: 0,
        streamItems: {
          create: {
            streamItemKey: `evicted-pending-${suffix}`,
            wordId: wordIds[3],
            itemKind: "LEARNING_CARD",
            selectionReason: "credential-eviction-test",
            policyVersion: "retrieval-v1",
            status: "LEASED",
            leaseExpiresAt: new Date(Date.now() + 15 * 60_000),
            credentialDigest: digestStudyStreamCredential(pendingInitialCredential),
            credentialExpiresAt: new Date(Date.now() + 15 * 60_000),
            credentialLineage: [{
              digest: digestStudyStreamCredential(pendingInitialCredential),
              issuedAt: Date.now(),
              expiresAt: Date.now() + 15 * 60_000,
              parentDigest: null,
            }],
            clientRevision: 0,
          },
        },
      },
      include: { streamItems: true },
    });
    const pendingItem = pendingSession.streamItems[0];
    assert.ok(pendingItem);
    let pendingCurrentCredential = pendingInitialCredential;
    let pendingEvictedCredential = pendingInitialCredential;
    for (let rotation = 0; rotation < 8; rotation += 1) {
      const renewal = await renewStudyStreamCredential(user.id, {
        studySessionId: pendingSession.id,
        streamItemId: pendingItem.id,
        itemCredential: pendingCurrentCredential,
        clientKnownRevision: 0,
      });
      if (rotation === 0) pendingEvictedCredential = renewal.itemCredential;
      pendingCurrentCredential = renewal.itemCredential;
    }
    const legacyPendingAction: StudyStreamActionInput = {
      flowVersion: "v2",
      studySessionId: pendingSession.id,
      streamItemId: pendingItem.id,
      operationId: `legacy-pending-prepare-${suffix}`,
      itemCredential: pendingEvictedCredential,
      actionKind: "REVEAL",
      clientKnownRevision: 0,
      payload: {},
    };
    // A pre-proof row may arrive after the source session has expired. The
    // retained successor's parent digest (K2 -> K1) is enough for this one
    // explicit migration step; no study item or session is changed here.
    await prisma.studySession.update({
      where: { id: pendingSession.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const preparedLegacyRecovery = await prepareStudyStreamActionRecovery(user.id, legacyPendingAction);
    assert.equal(preparedLegacyRecovery.ok, true);
    assert.equal(preparedLegacyRecovery.terminal, false);
    if (!preparedLegacyRecovery.terminal) {
      assert.equal(preparedLegacyRecovery.recoveryCredential, createStudyStreamRecoveryCredential(pendingItem.id));
    }
    await prisma.studySession.update({
      where: { id: pendingSession.id },
      data: { expiresAt: new Date(Date.now() + 30 * 60_000) },
    });
    const pendingRebindEncounterCount = await prisma.studyEncounter.count({ where: { userId: user.id } });
    const pendingRebindReceiptCount = await prisma.operationReceipt.count({ where: { userId: user.id } });
    const reboundPendingView = await getOrCreateStudyStream(user.id, {
      itemCredential: pendingEvictedCredential,
    });
    assert.equal(reboundPendingView.session.id, pendingSession.id);
    assert.ok(reboundPendingView.item);
    assert.equal(reboundPendingView.item.streamItemId, pendingItem.id);
    assert.notEqual(reboundPendingView.item.itemCredential, pendingEvictedCredential);
    assert.equal(await prisma.studyEncounter.count({ where: { userId: user.id } }), pendingRebindEncounterCount);
    assert.equal(await prisma.operationReceipt.count({ where: { userId: user.id } }), pendingRebindReceiptCount);
    const unresolvedReconciliation = await reconcileStudyStreamAction(user.id, {
      flowVersion: "v2",
      studySessionId: pendingSession.id,
      streamItemId: pendingItem.id,
      operationId: `evicted-pending-reconcile-${suffix}`,
      itemCredential: pendingInitialCredential,
      actionKind: "REVEAL",
      clientKnownRevision: 0,
      payload: {},
    });
    assert.equal(unresolvedReconciliation.ok, true);
    assert.equal(unresolvedReconciliation.terminal, false);
    const legacyCredentialGoneAction = {
      ...legacyPendingAction,
      operationId: `legacy-pending-unverifiable-${suffix}`,
    };
    await assert.rejects(
      () => prepareStudyStreamActionRecovery(user.id, legacyCredentialGoneAction),
      (error: unknown) => error instanceof StudyStreamError && error.status === 403 && error.details.code === "LEGACY_ACTION_CREDENTIAL_UNVERIFIABLE",
    );
    const pendingRevealAction: StudyStreamActionInput = {
        flowVersion: "v2",
        studySessionId: pendingSession.id,
        streamItemId: pendingItem.id,
        operationId: `evicted-pending-reveal-${suffix}`,
        itemCredential: pendingEvictedCredential,
        actionKind: "REVEAL",
        clientKnownRevision: 0,
        payload: {},
      };
    await assert.rejects(
      () => applyStudyStreamAction(user.id, pendingRevealAction),
      (error: unknown) => error instanceof StudyStreamError && error.status === 403 && error.details.code === "ITEM_CREDENTIAL_INVALID",
    );
    const pendingReveal = await applyStudyStreamAction(user.id, {
      ...pendingRevealAction,
      // Rebinding changes only the transport credential; operationId and the
      // immutable action payload remain byte-for-byte identical.
      itemCredential: reboundPendingView.item.itemCredential,
    });
    assert.equal(pendingReveal.response.itemStatus, "LEASED");
    assert.equal(await prisma.studyEncounter.count({ where: { userId: user.id } }), pendingRebindEncounterCount);
    assert.equal(await prisma.operationReceipt.count({ where: { userId: user.id } }), pendingRebindReceiptCount + 1);
    await prisma.studyStreamItem.update({
      where: { id: pendingItem.id },
      data: { usedAt: null, revealedAt: null },
    });
    await prisma.studySession.update({
      where: { id: pendingSession.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    // K1 was the credential actually captured by a second device. It is
    // evicted after the eighth rotation while K0 remains as the lineage root.
    // The item-bound recovery proof must still recover this unresolved action
    // after the source session expires, without reading the current URL/scope.
    const expiredK1Recovery = await recoverExpiredStudyStreamAction(user.id, {
      ...pendingRevealAction,
      operationId: `evicted-pending-k1-proof-recovery-${suffix}`,
      itemCredential: pendingEvictedCredential,
    }, createStudyStreamRecoveryCredential(pendingItem.id));
    assert.equal(expiredK1Recovery.response.itemStatus, "LEASED");
    const expiredPendingRecovery = await recoverExpiredStudyStreamAction(user.id, {
      flowVersion: "v2",
      studySessionId: pendingSession.id,
      streamItemId: pendingItem.id,
      operationId: `evicted-pending-expired-recovery-${suffix}`,
      itemCredential: pendingInitialCredential,
      actionKind: "REVEAL",
      clientKnownRevision: 0,
      payload: {},
    });
    assert.equal(expiredPendingRecovery.response.itemStatus, "LEASED");
    await prisma.studySession.update({
      where: { id: pendingSession.id },
      data: { retiredAt: new Date() },
    });
    const reboundPending = await getOrCreateStudyStream(user.id, { itemCredential: pendingInitialCredential });
    assert.notEqual(reboundPending.session.id, pendingSession.id);
    await assert.rejects(
      () => applyStudyStreamAction(user.id, {
        flowVersion: "v2",
        studySessionId: pendingSession.id,
        streamItemId: pendingItem.id,
        operationId: `evicted-pending-unknown-${suffix}`,
        itemCredential: createStudyStreamCredential(),
        actionKind: "REVEAL",
        clientKnownRevision: reboundPending.item?.clientRevision ?? 0,
        payload: {},
      }),
      (error: unknown) => error instanceof StudyStreamError && error.status === 403 && error.details.code === "ITEM_CREDENTIAL_INVALID",
    );
    await prisma.evidenceObligation.update({
      where: { id: obligation.id },
      data: { eligibleAt: new Date(Date.now() - 1_000) },
    });

    const encountersBeforeObjective = await prisma.studyEncounter.count({ where: { userId: user.id } });
    const receiptsBeforeObjective = await prisma.operationReceipt.count({ where: { userId: user.id } });
    let intermediateLearningCards = 0;
    let probeBootstrap = await getOrCreateStudyStream(user.id, { itemCredential: learningItem.itemCredential });
    // A soft probe cap may legitimately return one non-probe item before the
    // eligible obligation. Complete that item through the real action path so
    // this smoke test does not assume a particular tie-break ordering.
    while (probeBootstrap.item?.kind === "LEARNING_CARD" && intermediateLearningCards < 4) {
      const card = probeBootstrap.item;
      const cardOperation = `stream-intermediate-card-${suffix}-${intermediateLearningCards}`;
      await applyStudyStreamAction(user.id, {
        flowVersion: "v2",
        studySessionId: probeBootstrap.session.id,
        streamItemId: card.streamItemId,
        operationId: `${cardOperation}-reveal`,
        itemCredential: card.itemCredential,
        actionKind: "REVEAL",
        clientKnownRevision: card.clientRevision,
        payload: {},
      });
      await applyStudyStreamAction(user.id, {
        flowVersion: "v2",
        studySessionId: probeBootstrap.session.id,
        streamItemId: card.streamItemId,
        operationId: `${cardOperation}-rating`,
        itemCredential: card.itemCredential,
        actionKind: "SELF_RATING",
        clientKnownRevision: card.clientRevision,
        payload: { selfRating: "selfForgot" },
      });
      intermediateLearningCards += 1;
      probeBootstrap = await getOrCreateStudyStream(user.id);
    }
    assert.ok(probeBootstrap.item);
    assert.equal(probeBootstrap.item.kind, "OBJECTIVE_PROBE");
    assert.ok(probeBootstrap.item.objectiveQuestion);
    assert.equal("correctOptionId" in probeBootstrap.item.objectiveQuestion, false);
    const probeItem = probeBootstrap.item;
    const question = probeItem.objectiveQuestion;
    assert.ok(question);
    const probeRow = await prisma.studyStreamItem.findUniqueOrThrow({
      where: { id: probeItem.streamItemId },
      select: { objectiveQuestionSnapshotId: true },
    });
    const snapshotRow = await prisma.objectiveQuestionSnapshot.findUniqueOrThrow({
      where: { id: probeRow.objectiveQuestionSnapshotId ?? "" },
      select: { correctOptionId: true },
    });
    const selectedOption = question.options.find(
      (option) => option.id !== snapshotRow.correctOptionId,
    );
    assert.ok(selectedOption);
    const answerInput: StudyStreamActionInput = {
      flowVersion: "v2",
      studySessionId: probeBootstrap.session.id,
      streamItemId: probeItem.streamItemId,
      operationId: `stream-answer-${suffix}`,
      itemCredential: probeItem.itemCredential,
      actionKind: "OBJECTIVE_ANSWER",
      clientKnownRevision: probeItem.clientRevision,
      payload: { selectedOptionId: selectedOption.id },
    };
    const answer = await applyStudyStreamAction(user.id, answerInput);
    assert.equal(answer.response.requiresFeedbackAck, true);
    assert.equal(answer.response.feedback?.quality, 2);
    const duplicateAnswer = await applyStudyStreamAction(user.id, answerInput);
    assert.equal(duplicateAnswer.duplicate, true);
    assert.equal(await prisma.reviewEvent.count({ where: { userId: user.id } }), 1);
    const event = await prisma.reviewEvent.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(event.operationId, answerInput.operationId);
    assert.equal(event.eventKind, "REVIEW");
    assert.equal(event.flowVersion, "v2");
    assert.equal(event.evidenceKind, "OBJECTIVE_PROBE");
    assert.equal(event.quality, 2);
    assert.ok(event.objectiveEvidenceTargetId);
    assert.equal(
      await prisma.studyEncounter.count({ where: { userId: user.id } }),
      encountersBeforeObjective + intermediateLearningCards,
    );
    assert.equal(
      await prisma.operationReceipt.count({ where: { userId: user.id } }),
      receiptsBeforeObjective + intermediateLearningCards * 2 + 1,
    );

    const resumed = await getOrCreateStudyStream(user.id, {
      itemCredential: probeItem.itemCredential,
    });
    assert.equal(resumed.resumedFeedback, true);
    assert.ok(resumed.item?.feedback);
    const ackInput: StudyStreamActionInput = {
      flowVersion: "v2",
      studySessionId: resumed.session.id,
      streamItemId: probeItem.streamItemId,
      operationId: `stream-feedback-${suffix}`,
      itemCredential: resumed.item.itemCredential,
      actionKind: "FEEDBACK_ACK",
      clientKnownRevision: resumed.item.clientRevision,
      payload: {},
    };
    const acknowledged = await applyStudyStreamAction(user.id, ackInput);
    assert.equal(acknowledged.response.itemStatus, "ACKNOWLEDGED");
    // A second tab may submit a new feedback acknowledgement after the first
    // tab has completed it. The read-only transition is safely replayed and
    // must not create another scored ReviewEvent.
    const lateAck = await applyStudyStreamAction(user.id, {
      ...ackInput,
      operationId: `stream-feedback-late-${suffix}`,
    });
    assert.equal(lateAck.duplicate, false);
    assert.equal(lateAck.response.itemStatus, "ACKNOWLEDGED");
    assert.equal(lateAck.response.feedback?.acknowledged, true);
    assert.equal(await prisma.reviewEvent.count({ where: { userId: user.id } }), 1);
    const feedbackReceiptCount = await prisma.operationReceipt.count({ where: { userId: user.id } });
    const unknownFeedbackAction: StudyStreamActionInput = {
      ...ackInput,
      operationId: `stream-feedback-unknown-${suffix}`,
      itemCredential: createStudyStreamCredential(),
    };
    await assert.rejects(
      () => applyStudyStreamAction(user.id, unknownFeedbackAction),
      (error: unknown) => error instanceof StudyStreamError && error.status === 403 && error.details.code === "ITEM_CREDENTIAL_INVALID",
    );
    const unknownFeedbackReconciliation = await reconcileStudyStreamAction(user.id, unknownFeedbackAction);
    assert.equal(unknownFeedbackReconciliation.ok, true);
    assert.equal(unknownFeedbackReconciliation.terminal, true);
    if (unknownFeedbackReconciliation.terminal) assert.equal(unknownFeedbackReconciliation.code, "FEEDBACK_ALREADY_ACKNOWLEDGED");
    assert.equal(await prisma.operationReceipt.count({ where: { userId: user.id } }), feedbackReceiptCount);
    let postFeedbackLearningCards = 0;
    let remediation = await getOrCreateStudyStream(user.id);
    // Remediation obeys the same learner-scoped spacing window as every
    // other candidate source. Complete any intervening card through the real
    // action path before asserting that the pending remediation is eventually
    // selected; a fixed immediate-selection expectation would reject the
    // intentional spacing contract.
    while (
      remediation.item?.kind === "LEARNING_CARD" &&
      remediation.item.selectionReason !== "remediation" &&
      postFeedbackLearningCards < 4
    ) {
      const card = remediation.item;
      const cardOperation = `stream-post-feedback-card-${suffix}-${postFeedbackLearningCards}`;
      await applyStudyStreamAction(user.id, {
        flowVersion: "v2",
        studySessionId: remediation.session.id,
        streamItemId: card.streamItemId,
        operationId: `${cardOperation}-reveal`,
        itemCredential: card.itemCredential,
        actionKind: "REVEAL",
        clientKnownRevision: card.clientRevision,
        payload: {},
      });
      await applyStudyStreamAction(user.id, {
        flowVersion: "v2",
        studySessionId: remediation.session.id,
        streamItemId: card.streamItemId,
        operationId: `${cardOperation}-rating`,
        itemCredential: card.itemCredential,
        actionKind: "SELF_RATING",
        clientKnownRevision: card.clientRevision,
        payload: { selfRating: "selfRecalled" },
      });
      postFeedbackLearningCards += 1;
      remediation = await getOrCreateStudyStream(user.id);
    }
    assert.ok(remediation.item);
    assert.equal(remediation.item.kind, "LEARNING_CARD");
    assert.equal(remediation.item.selectionReason, "remediation");
    const remediationItem = remediation.item;
    const remediationRow = await prisma.studyStreamItem.findUniqueOrThrow({
      where: { id: remediationItem.streamItemId },
      select: { workObligationId: true },
    });
    assert.ok(remediationRow.workObligationId);
    const remediationReveal: StudyStreamActionInput = {
      flowVersion: "v2",
      studySessionId: remediation.session.id,
      streamItemId: remediationItem.streamItemId,
      operationId: `stream-remediation-reveal-${suffix}`,
      itemCredential: remediationItem.itemCredential,
      actionKind: "REVEAL",
      clientKnownRevision: remediationItem.clientRevision,
      payload: {},
    };
    await applyStudyStreamAction(user.id, remediationReveal);
    const remediationForgot: StudyStreamActionInput = {
      ...remediationReveal,
      operationId: `stream-remediation-forgot-${suffix}`,
      actionKind: "SELF_RATING",
      payload: { selfRating: "selfForgot" },
    };
    const remediationResult = await applyStudyStreamAction(user.id, remediationForgot);
    assert.equal(remediationResult.response.evidenceObligation?.created, true);
    const answeredRemediation = await prisma.evidenceObligation.findUniqueOrThrow({
      where: { id: remediationRow.workObligationId },
      select: { status: true, activeKey: true },
    });
    assert.equal(answeredRemediation.status, "ANSWERED");
    assert.equal(answeredRemediation.activeKey, null);
    assert.equal(
      await prisma.studyEncounter.count({ where: { userId: user.id } }),
      encountersBeforeObjective + intermediateLearningCards + postFeedbackLearningCards + 1,
    );
    assert.equal(
      await prisma.operationReceipt.count({ where: { userId: user.id } }),
      receiptsBeforeObjective + intermediateLearningCards * 2 + postFeedbackLearningCards * 2 + 5,
    );

    // Exact negative controls prevent a vacuous SQL/Prisma equivalence pass on
    // a database containing only current words.
    const readyCatalogRevision = await prisma.catalogRevision.findFirstOrThrow({
      where: { status: "READY" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    const buildingCatalogRevision = await prisma.catalogRevision.create({
      data: {
        revisionKey: `stream-negative-${suffix}`,
        sourceDigest: `stream-negative-source-${suffix}`,
        taxonomyDigest: "stream-negative-taxonomy",
        validatorVersion: "stream-negative-validator",
        normalizationVersion: "stream-negative-normalization",
        activationBasis: "INTEGRATION_TEST",
        status: "BUILDING",
      },
    });
    catalogFixtureCatalogRevisionIds.push(buildingCatalogRevision.id);
    const negativeEntry = await prisma.catalogEntry.create({
      data: {
        catalogKey: `stream-negative-${suffix}`,
        lemma: `stream-negative-${suffix}`,
        normalizedLemma: `stream-negative-${suffix}`,
      },
    });
    catalogFixtureEntryIds.push(negativeEntry.id);

    async function createNegativeProjection(input: {
      label: string;
      status: "ACTIVE" | "DRAFT" | "RETIRED";
      approvedCatalogRevisionId: string | null;
      wordCatalogRevisionId: string;
    }) {
      const term = `stream-negative-${input.label}-${suffix}`;
      const sense = await prisma.wordSense.create({
        data: {
          catalogEntryId: negativeEntry.id,
          senseKey: `stream-negative:${input.label}:${suffix}`,
          term,
          normalizedTerm: term,
          pos: "noun",
          level: "A1",
          category: testUnitCategory,
          status: input.status,
        },
      });
      catalogFixtureSenseIds.push(sense.id);
      if (input.approvedCatalogRevisionId) {
        const revision = await prisma.wordSenseRevision.create({
          data: {
            senseId: sense.id,
            revision: 1,
            term,
            lemma: term,
            pos: "noun",
            level: "A1",
            category: testUnitCategory,
            definitionZh: "負面 current catalog 測試",
            contentDigest: `stream-negative:${input.label}:${suffix}`,
            catalogRevisionId: input.approvedCatalogRevisionId,
          },
        });
        catalogFixtureRevisionIds.push(revision.id);
        await prisma.wordSense.update({
          where: { id: sense.id },
          data: { approvedRevisionId: revision.id },
        });
      }
      const word = await prisma.word.create({
        data: {
          term,
          definition: "負面 current catalog 測試",
          level: "A1",
          category: testUnitCategory,
          synonyms: [],
          antonyms: [],
          senseId: sense.id,
          senseKey: sense.senseKey,
          catalogRevisionId: input.wordCatalogRevisionId,
        },
      });
      catalogFixtureWordIds.push(word.id);
      return word.id;
    }

    const legacyNullSenseWord = await prisma.word.create({
      data: {
        term: `stream-negative-legacy-${suffix}`,
        definition: "legacy null-sense negative control",
        level: "A1",
        category: testUnitCategory,
        synonyms: [],
        antonyms: [],
        catalogRevisionId: readyCatalogRevision.id,
      },
    });
    catalogFixtureWordIds.push(legacyNullSenseWord.id);

    const negativeCurrentWordIds = [
      legacyNullSenseWord.id,
      await createNegativeProjection({
        label: "word-catalog-building",
        status: "ACTIVE",
        approvedCatalogRevisionId: readyCatalogRevision.id,
        wordCatalogRevisionId: buildingCatalogRevision.id,
      }),
      await createNegativeProjection({
        label: "draft-sense",
        status: "DRAFT",
        approvedCatalogRevisionId: readyCatalogRevision.id,
        wordCatalogRevisionId: readyCatalogRevision.id,
      }),
      await createNegativeProjection({
        label: "retired-sense",
        status: "RETIRED",
        approvedCatalogRevisionId: readyCatalogRevision.id,
        wordCatalogRevisionId: readyCatalogRevision.id,
      }),
      await createNegativeProjection({
        label: "missing-approved-revision",
        status: "ACTIVE",
        approvedCatalogRevisionId: null,
        wordCatalogRevisionId: readyCatalogRevision.id,
      }),
      await createNegativeProjection({
        label: "approved-catalog-building",
        status: "ACTIVE",
        approvedCatalogRevisionId: buildingCatalogRevision.id,
        wordCatalogRevisionId: readyCatalogRevision.id,
      }),
    ];

    const thresholdWords = await prisma.word.findMany({
      where: withCurrentCatalogWord({ reviews: { none: { userId: user.id } } }),
      select: { id: true, senseId: true },
      orderBy: { id: "asc" },
      take: 2,
    });
    assert.equal(thresholdWords.length, 2);
    await prisma.review.createMany({
      data: [
        {
          userId: user.id,
          wordId: thresholdWords[0]!.id,
          senseId: thresholdWords[0]!.senseId,
          repetitions: 1,
          interval: 21,
          nextReviewDate: new Date(),
        },
        {
          userId: user.id,
          wordId: thresholdWords[1]!.id,
          senseId: thresholdWords[1]!.senseId,
          repetitions: 0,
          interval: 22,
          nextReviewDate: new Date(),
        },
      ],
    });
    const metrics = await getStudentLearningMetrics(user.id);
    assert.equal(metrics.reviewEventCount, 1);
    assert.equal(metrics.objectiveRecognitionCount, 1);
    assert.equal(
      metrics.selfRatedEncounterCount,
      encountersBeforeObjective + intermediateLearningCards + postFeedbackLearningCards + 1,
    );
    assert.equal(metrics.legacyUnknownEventCount, 0);
    assert.ok(metrics.learnedCount >= 1, "repetitions=1 must count as learned");
    assert.ok(metrics.masteredCount >= 1, "interval=22 must count as mastered");
    const [currentWordsFromPrisma, currentWordsFromSql] = await Promise.all([
      prisma.word.findMany({
        where: withCurrentCatalogWord(),
        select: { id: true },
        orderBy: { id: "asc" },
      }),
      prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        WITH ${currentCatalogWordCtesSql()}
        SELECT current_words."id"
        FROM current_words
        ORDER BY current_words."id" ASC
      `),
    ]);
    assert.deepEqual(
      currentWordsFromSql.map((word) => word.id),
      currentWordsFromPrisma.map((word) => word.id),
      "raw SQL and Prisma current-catalog predicates must select the exact same words",
    );
    const prismaCurrentIds = new Set(currentWordsFromPrisma.map((word) => word.id));
    const sqlCurrentIds = new Set(currentWordsFromSql.map((word) => word.id));
    for (const negativeWordId of negativeCurrentWordIds) {
      assert.equal(prismaCurrentIds.has(negativeWordId), false);
      assert.equal(sqlCurrentIds.has(negativeWordId), false);
    }
    for (const level of ["A1", "A2", "B1", "B2"] as const) {
      const [totalWords, learnedCount, masteredCount] = await Promise.all([
        prisma.word.count({ where: withCurrentCatalogWord({ level }) }),
        prisma.review.count({
          where: {
            userId: user.id,
            repetitions: { gte: 1 },
            word: withCurrentCatalogWord({ level }),
          },
        }),
        prisma.review.count({
          where: {
            userId: user.id,
            interval: { gte: 22 },
            word: withCurrentCatalogWord({ level }),
          },
        }),
      ]);
      const aggregate = metrics.library.byLevel.find((row) => row.level === level);
      assert.deepEqual(
        aggregate && {
          totalWords: aggregate.totalWords,
          learnedCount: aggregate.learnedCount,
          masteredCount: aggregate.masteredCount,
        },
        { totalWords, learnedCount, masteredCount },
        `${level} database aggregate must match canonical Prisma counts`,
      );
    }
    const unitComparisonNow = new Date();
    const [unitProgress, canonicalUnitWords] = await Promise.all([
      fetchUnitProgress(user.id, prisma, unitComparisonNow),
      prisma.word.findMany({
        where: withCurrentCatalogWord(),
        select: {
          level: true,
          category: true,
          reviews: {
            where: { userId: user.id },
            select: { repetitions: true, nextReviewDate: true },
          },
        },
      }),
    ]);
    const canonicalUnitCounts = new Map<
      string,
      { total: number; learned: number; mastered: number; due: number }
    >();
    for (const word of canonicalUnitWords) {
      const key = `${word.level}\u0000${word.category ?? "未分类"}`;
      const counts = canonicalUnitCounts.get(key) ?? {
        total: 0,
        learned: 0,
        mastered: 0,
        due: 0,
      };
      const review = word.reviews[0];
      counts.total += 1;
      if (review) {
        counts.learned += 1;
        if (review.repetitions >= 1) counts.mastered += 1;
        if (review.nextReviewDate <= unitComparisonNow) counts.due += 1;
      }
      canonicalUnitCounts.set(key, counts);
    }
    const unitRows = unitProgress.flatMap((level) =>
      level.units.map((unit) => ({ level: level.level, unit })),
    );
    assert.equal(unitRows.length, canonicalUnitCounts.size);
    for (const { level, unit } of unitRows) {
      assert.deepEqual(
        {
          total: unit.total,
          learned: unit.learned,
          mastered: unit.mastered,
          due: unit.due,
        },
        canonicalUnitCounts.get(`${level}\u0000${unit.name}`),
        `${level}/${unit.name} unit aggregate must match canonical Prisma rows`,
      );
    }
    await prisma.review.deleteMany({
      where: { userId: user.id, wordId: { in: thresholdWords.map((word) => word.id) } },
    });
    const dashboard = await getStudentDashboard(user.id);
    assert.equal(dashboard.today.objectiveRecognitionCount, 1);
    assert.equal(
      dashboard.today.selfRatedEncounterCount,
      encountersBeforeObjective + intermediateLearningCards + postFeedbackLearningCards + 1,
    );
    assert.equal(dashboard.library.masteredCount, 0);
    const unitSummaryAfter = await getOrCreateStudyStream(user.id, {
      mode: "unit",
      level: "A1",
      category: testUnitCategory,
    });
    assert.equal(unitSummaryAfter.unitSummary?.objectiveRecognitionCount, 1);
    assert.ok((unitSummaryAfter.unitSummary?.encounteredWordCount ?? 0) > 0);

    // A personal learning day is not a scored leaderboard streak. This
    // fixture has a StudyDay but no provenance-complete objective event.
    const studyDayOnlyUser = await prisma.user.create({
      data: {
        accountName: `codex-study-day-only-${suffix}`,
        passwordHash: "not-a-login-account",
        mustChangePassword: false,
        studentProfile: {
          create: {
            legalName: "學習日測試學生",
            nickname: "學習日測試生",
            nicknameNormalized: "學習日測試生",
          },
        },
      },
    });
    studyDayOnlyUserId = studyDayOnlyUser.id;
    await prisma.studentEnrollment.create({
      data: {
        studentId: studyDayOnlyUser.id,
        academicYearId: currentAcademicYear.id,
        grade: "JUNIOR_1",
      status: "ACTIVE",
      isCurrent: true,
        origin: "SEED",
        startedAt: new Date(),
      },
    });
    await prisma.studyDay.create({ data: { userId: studyDayOnlyUser.id, date: todayKey() } });
    // The scheduler must retain the database's nextReviewDate ordering when
    // all due candidates share the same urgency window. Deliberately choose
    // IDs whose lexical order disagrees with due age so a lost priority field
    // would select the newer review.
    const dueOrderWords = await prisma.word.findMany({
      where: withCurrentCatalogWord({ level: "A1", category: unitCategoryToStorage(testUnitCategory) }),
      orderBy: [{ term: "asc" }, { id: "asc" }],
      take: 2,
      select: { id: true },
    });
    if (dueOrderWords.length !== 2) throw new Error("unlocked A1 unit has fewer than two words for due-order regression");
    const dueOrderNow = new Date();
    await prisma.review.create({
      data: {
        id: `z-old-${suffix}`,
        userId: studyDayOnlyUser.id,
        wordId: dueOrderWords[0].id,
        nextReviewDate: new Date(dueOrderNow.getTime() - 60_000),
      },
    });
    await prisma.review.create({
      data: {
        id: `a-new-${suffix}`,
        userId: studyDayOnlyUser.id,
        wordId: dueOrderWords[1].id,
        nextReviewDate: new Date(dueOrderNow.getTime() - 30_000),
      },
    });
    const dueOrderStream = await getOrCreateStudyStream(studyDayOnlyUser.id);
    const dueOrderItem = await prisma.studyStreamItem.findUniqueOrThrow({
      where: { id: dueOrderStream.item?.streamItemId ?? "" },
      select: { itemKind: true, wordId: true, selectionReason: true },
    });
    assert.equal(dueOrderItem.itemKind, "OBJECTIVE_PROBE");
    assert.equal(dueOrderItem.wordId, dueOrderWords[0].id);
    assert.equal(dueOrderItem.selectionReason, "due-review");

    // A unit whose every word already has a due Review must still make
    // progress after a confirmed Objective Probe. Due probes are the normal
    // evidence source, while due-review-gap-filler cards provide the two
    // non-scoring acknowledged items required by the learner-wide spacing
    // policy before the next probe can be issued.
    const scheduleGapUser = await prisma.user.create({
      data: {
        accountName: `codex-schedule-gap-${suffix}`,
        passwordHash: "not-a-login-account",
        mustChangePassword: false,
        studentProfile: {
          create: {
            legalName: "排程間隔測試學生",
            nickname: "排程間隔測試生",
            nicknameNormalized: "排程間隔測試生",
          },
        },
      },
    });
    scheduleGapUserId = scheduleGapUser.id;
    await prisma.studentEnrollment.create({
      data: {
        studentId: scheduleGapUser.id,
        academicYearId: currentAcademicYear.id,
        grade: "JUNIOR_1",
        status: "ACTIVE",
        isCurrent: true,
        origin: "SEED",
        startedAt: new Date(),
      },
    });
    const scheduleGapWords = await prisma.word.findMany({
      where: withCurrentCatalogWord({ level: "A1", category: unitCategoryToStorage(testUnitCategory) }),
      orderBy: [{ term: "asc" }, { id: "asc" }],
      select: { id: true, senseId: true },
    });
    if (scheduleGapWords.length < 3) throw new Error("unlocked A1 unit has fewer than three words for probe-gap regression");
    const scheduleGapNow = new Date();
    await prisma.review.createMany({
      data: scheduleGapWords.map((word) => ({
        userId: scheduleGapUser.id,
        wordId: word.id,
        senseId: word.senseId,
        nextReviewDate: new Date(scheduleGapNow.getTime() - 60_000),
      })),
    });
    const scheduleGapCredential = createStudyStreamCredential();
    const scheduleGapSession = await prisma.studySession.create({
      data: {
        userId: scheduleGapUser.id,
        queueFingerprint: `schedule-gap-history-${suffix}`,
        expiresAt: new Date(scheduleGapNow.getTime() - 60_000),
        retiredAt: new Date(scheduleGapNow.getTime() - 60_000),
        flowVersion: "v2",
        learningPolicyVersion: "retrieval-v1",
        mode: "unit",
        scopeLevel: "A1",
        scopeCategory: unitCategoryToStorage(testUnitCategory),
        revision: 0,
        streamItems: {
          create: {
            streamItemKey: `schedule-gap-history-${suffix}`,
            wordId: scheduleGapWords[0].id,
            itemKind: "OBJECTIVE_PROBE",
            selectionReason: "schedule-gap-history",
            policyVersion: "retrieval-v1",
            status: "ACKNOWLEDGED",
            leaseExpiresAt: new Date(scheduleGapNow.getTime() - 30_000),
            credentialDigest: digestStudyStreamCredential(scheduleGapCredential),
            credentialExpiresAt: new Date(scheduleGapNow.getTime() - 30_000),
            usedAt: new Date(scheduleGapNow.getTime() - 45_000),
            feedbackAcknowledgedAt: new Date(scheduleGapNow.getTime() - 30_000),
            clientRevision: 0,
          },
        },
      },
    });
    const completeGapCard = async (stream: Awaited<ReturnType<typeof getOrCreateStudyStream>>, label: string) => {
      assert.equal(stream.item?.kind, "LEARNING_CARD");
      assert.equal(stream.item?.selectionReason, "due-review-gap-filler");
      assert.ok(stream.item);
      await applyStudyStreamAction(scheduleGapUser.id, {
        flowVersion: "v2",
        studySessionId: stream.session.id,
        streamItemId: stream.item.streamItemId,
        operationId: `schedule-gap-${label}-reveal-${suffix}`,
        itemCredential: stream.item.itemCredential,
        actionKind: "REVEAL",
        clientKnownRevision: stream.item.clientRevision,
        payload: {},
      });
      await applyStudyStreamAction(scheduleGapUser.id, {
        flowVersion: "v2",
        studySessionId: stream.session.id,
        streamItemId: stream.item.streamItemId,
        operationId: `schedule-gap-${label}-rating-${suffix}`,
        itemCredential: stream.item.itemCredential,
        actionKind: "SELF_RATING",
        clientKnownRevision: stream.item.clientRevision,
        payload: { selfRating: "selfRecalled" },
      });
    };
    const gapFirst = await getOrCreateStudyStream(scheduleGapUser.id, {
      mode: "unit",
      level: "A1",
      category: testUnitCategory,
    });
    await completeGapCard(gapFirst, "first");
    const gapSecond = await getOrCreateStudyStream(scheduleGapUser.id, {
      mode: "unit",
      level: "A1",
      category: testUnitCategory,
    });
    await completeGapCard(gapSecond, "second");
    const gapProbe = await getOrCreateStudyStream(scheduleGapUser.id, {
      mode: "unit",
      level: "A1",
      category: testUnitCategory,
    });
    assert.equal(gapProbe.item?.kind, "OBJECTIVE_PROBE");
    assert.equal(gapProbe.item?.selectionReason, "due-review");
    assert.notEqual(gapFirst.item?.streamItemId, gapSecond.item?.streamItemId);
    assert.notEqual(scheduleGapSession.id, gapFirst.session.id);

    // An evidence obligation without a Review must get the same safe spacing
    // fallback as a due Review. The gap-filler card is deliberately separate
    // from the obligation so self-rating cannot mark the objective target
    // ANSWERED before an Objective Probe is submitted.
    const obligationGapUser = await prisma.user.create({
      data: {
        accountName: `codex-obligation-gap-${suffix}`,
        passwordHash: "not-a-login-account",
        mustChangePassword: false,
        studentProfile: {
          create: {
            legalName: "補驗間隔測試學生",
            nickname: "補驗間隔測試生",
            nicknameNormalized: "補驗間隔測試生",
          },
        },
      },
    });
    obligationGapUserId = obligationGapUser.id;
    await prisma.studentEnrollment.create({
      data: {
        studentId: obligationGapUser.id,
        academicYearId: currentAcademicYear.id,
        grade: "JUNIOR_1",
        status: "ACTIVE",
        isCurrent: true,
        origin: "SEED",
        startedAt: new Date(),
      },
    });
    const obligationGapWords = await prisma.word.findMany({
      where: withCurrentCatalogWord({ level: "A1", category: unitCategoryToStorage(testUnitCategory) }),
      orderBy: [{ term: "asc" }, { id: "asc" }],
      select: { id: true, senseId: true },
    });
    if (obligationGapWords.length < 4) throw new Error("unlocked A1 unit has fewer than four words for obligation-gap regression");
    const obligationGapNow = new Date();
    const obligationGapHistoryCredential = createStudyStreamCredential();
    await prisma.studySession.create({
      data: {
        userId: obligationGapUser.id,
        queueFingerprint: `obligation-gap-history-${suffix}`,
        expiresAt: new Date(obligationGapNow.getTime() - 60_000),
        retiredAt: new Date(obligationGapNow.getTime() - 60_000),
        flowVersion: "v2",
        learningPolicyVersion: "retrieval-v1",
        mode: "unit",
        scopeLevel: "A1",
        scopeCategory: unitCategoryToStorage(testUnitCategory),
        revision: 0,
        streamItems: {
          create: {
            streamItemKey: `obligation-gap-history-${suffix}`,
            wordId: obligationGapWords[0].id,
            itemKind: "OBJECTIVE_PROBE",
            selectionReason: "obligation-gap-history",
            policyVersion: "retrieval-v1",
            status: "ACKNOWLEDGED",
            leaseExpiresAt: new Date(obligationGapNow.getTime() - 30_000),
            credentialDigest: digestStudyStreamCredential(obligationGapHistoryCredential),
            credentialExpiresAt: new Date(obligationGapNow.getTime() - 30_000),
            usedAt: new Date(obligationGapNow.getTime() - 45_000),
            feedbackAcknowledgedAt: new Date(obligationGapNow.getTime() - 30_000),
            clientRevision: 0,
          },
        },
      },
    });
    const obligationGapWork = await prisma.evidenceObligation.createMany({
      data: obligationGapWords.slice(1, 4).map((word) => ({
        userId: obligationGapUser.id,
        wordId: word.id,
        senseId: word.senseId,
        kind: "EVIDENCE_OBLIGATION",
        status: "PENDING",
        selectionReason: "obligation-gap-regression",
        policyVersion: "retrieval-v1",
        eligibleAt: new Date(obligationGapNow.getTime() - 1_000),
        expiresAt: new Date(obligationGapNow.getTime() + 24 * 60 * 60_000),
        activeKey: `${obligationGapUser.id}:EVIDENCE_OBLIGATION:${word.id}`,
      })),
    });
    assert.equal(obligationGapWork.count, 3);
    const obligationGapOptions = {
      mode: "unit" as const,
      level: "A1" as const,
      category: testUnitCategory,
    };
    const completeObligationGapCard = async (
      stream: Awaited<ReturnType<typeof getOrCreateStudyStream>>,
      label: string,
    ) => {
      assert.equal(stream.item?.kind, "LEARNING_CARD");
      assert.equal(stream.item?.selectionReason, "evidence-obligation-gap-filler");
      assert.ok(stream.item);
      const row = await prisma.studyStreamItem.findUniqueOrThrow({
        where: { id: stream.item.streamItemId },
        select: { workObligationId: true },
      });
      assert.equal(row.workObligationId, null);
      await applyStudyStreamAction(obligationGapUser.id, {
        flowVersion: "v2",
        studySessionId: stream.session.id,
        streamItemId: stream.item.streamItemId,
        operationId: `obligation-gap-${label}-reveal-${suffix}`,
        itemCredential: stream.item.itemCredential,
        actionKind: "REVEAL",
        clientKnownRevision: stream.item.clientRevision,
        payload: {},
      });
      await applyStudyStreamAction(obligationGapUser.id, {
        flowVersion: "v2",
        studySessionId: stream.session.id,
        streamItemId: stream.item.streamItemId,
        operationId: `obligation-gap-${label}-rating-${suffix}`,
        itemCredential: stream.item.itemCredential,
        actionKind: "SELF_RATING",
        clientKnownRevision: stream.item.clientRevision,
        payload: { selfRating: "selfRecalled" },
      });
    };
    const obligationGapFirst = await getOrCreateStudyStream(obligationGapUser.id, obligationGapOptions);
    await completeObligationGapCard(obligationGapFirst, "first");
    const obligationGapSecond = await getOrCreateStudyStream(obligationGapUser.id, obligationGapOptions);
    await completeObligationGapCard(obligationGapSecond, "second");
    const obligationGapProbe = await getOrCreateStudyStream(obligationGapUser.id, obligationGapOptions);
    assert.equal(obligationGapProbe.item?.kind, "OBJECTIVE_PROBE");
    assert.equal(obligationGapProbe.item?.selectionReason, "evidence-obligation");
    const obligationGapProbeRow = await prisma.studyStreamItem.findUniqueOrThrow({
      where: { id: obligationGapProbe.item?.streamItemId ?? "" },
      select: { workObligationId: true },
    });
    assert.ok(obligationGapProbeRow.workObligationId);
    const obligationGapStatuses = await prisma.evidenceObligation.findMany({
      where: { userId: obligationGapUser.id },
      select: { status: true },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(obligationGapStatuses.map((row) => row.status), ["LEASED", "PENDING", "PENDING"]);

    // A long-running learner can have more encounters than the bounded
    // contact-time history window. The contacted/untouched partition must
    // remain authoritative even when the latest contacted word is absent
    // from that 640-row timestamp window.
    const longHistoryUser = await prisma.user.create({
      data: {
        accountName: `codex-long-history-${suffix}`,
        passwordHash: "not-a-login-account",
        mustChangePassword: false,
        studentProfile: {
          create: {
            legalName: "長期歷史測試學生",
            nickname: "長期歷史測試生",
            nicknameNormalized: "長期歷史測試生",
          },
        },
      },
    });
    longHistoryUserId = longHistoryUser.id;
    await prisma.studentEnrollment.create({
      data: {
        studentId: longHistoryUser.id,
        academicYearId: currentAcademicYear.id,
        grade: "JUNIOR_1",
        status: "ACTIVE",
        isCurrent: true,
        origin: "SEED",
        startedAt: new Date(),
      },
    });
    const longHistoryWords = await prisma.word.findMany({
      where: withCurrentCatalogWord({ level: "A1", category: unitCategoryToStorage(testUnitCategory) }),
      orderBy: [{ term: "asc" }, { id: "asc" }],
      take: 3,
      select: { id: true, senseId: true, term: true },
    });
    if (longHistoryWords.length < 3) throw new Error("unlocked A1 unit has fewer than three words for long-history regression");
    const [longHistoryTarget, longHistoryUntouched, longHistoryFiller] = longHistoryWords;
    const longHistoryScopeWords = await prisma.word.findMany({
      where: withCurrentCatalogWord({ level: "A1", category: unitCategoryToStorage(testUnitCategory) }),
      select: { id: true, senseId: true },
    });
    const longHistoryReviewWords = longHistoryScopeWords.filter((word) =>
      word.id !== longHistoryTarget.id && word.id !== longHistoryUntouched.id,
    );
    await prisma.review.createMany({
      data: longHistoryReviewWords.map((word, index) => ({
        id: `long-history-review-${suffix}-${index}`,
        userId: longHistoryUser.id,
        wordId: word.id,
        senseId: word.senseId,
        nextReviewDate: new Date(Date.now() + 86_400_000),
      })),
    });
    const longHistorySession = await prisma.studySession.create({
      data: {
        userId: longHistoryUser.id,
        queueFingerprint: `long-history-${suffix}`,
        expiresAt: new Date(Date.now() - 60_000),
        retiredAt: new Date(Date.now() - 60_000),
        flowVersion: "v2",
        learningPolicyVersion: "retrieval-v1",
        mode: "unit",
        scopeLevel: "A1",
        scopeCategory: unitCategoryToStorage(testUnitCategory),
        revision: 0,
      },
    });
    const longHistoryItems: Array<PrismaTypes.StudyStreamItemCreateManyInput> = [];
    const longHistoryEncounters: Array<PrismaTypes.StudyEncounterCreateManyInput> = [];
    const longHistoryCount = 643;
    for (let index = 0; index < longHistoryCount; index += 1) {
      // Rows 0–639 are old filler contacts; the target is row 640, followed
      // by two newer filler contacts so it is not in recentWordIds either.
      const word = index === 640 ? longHistoryTarget : longHistoryFiller;
      const acknowledgedAt = new Date(Date.now() - (longHistoryCount - index) * 1_000);
      const streamItemId = `long-history-item-${suffix}-${index}`;
      const operationId = `long-history-operation-${suffix}-${index}`;
      const credential = `long-history-credential-${suffix}-${index}`;
      longHistoryItems.push({
        id: streamItemId,
        sessionId: longHistorySession.id,
        streamItemKey: `long-history-key-${suffix}-${index}`,
        wordId: word.id,
        senseId: word.senseId,
        itemKind: "LEARNING_CARD",
        selectionReason: "long-history-regression",
        policyVersion: "retrieval-v1",
        status: "ACKNOWLEDGED",
        leaseExpiresAt: new Date(Date.now() + 15 * 60_000),
        credentialDigest: digestStudyStreamCredential(credential),
        credentialExpiresAt: new Date(Date.now() + 15 * 60_000),
        usedAt: acknowledgedAt,
        feedbackAcknowledgedAt: acknowledgedAt,
        operationId,
        clientRevision: 1,
      });
      longHistoryEncounters.push({
        id: `long-history-encounter-${suffix}-${index}`,
        userId: longHistoryUser.id,
        wordId: word.id,
        senseId: word.senseId,
        streamItemId,
        operationId,
        selfRating: "selfRecalled",
        selectionReason: "long-history-regression",
        policyVersion: "retrieval-v1",
        requiresVerification: false,
        createdAt: acknowledgedAt,
        acknowledgedAt,
      });
    }
    await prisma.studyStreamItem.createMany({ data: longHistoryItems });
    await prisma.studyEncounter.createMany({ data: longHistoryEncounters });

    const longHistoryOptions = { mode: "unit" as const, level: "A1", category: testUnitCategory };
    const firstLongHistory = await getOrCreateStudyStream(longHistoryUser.id, longHistoryOptions);
    assert.ok(firstLongHistory.item);
    assert.equal(firstLongHistory.item.kind, "LEARNING_CARD");
    const firstLongHistoryRow = await prisma.studyStreamItem.findUniqueOrThrow({
      where: { id: firstLongHistory.item.streamItemId },
      select: { wordId: true, selectionReason: true },
    });
    assert.equal(firstLongHistoryRow.wordId, longHistoryUntouched.id);
    assert.equal(firstLongHistoryRow.selectionReason, "new-word");

    // Close that card directly as a durable fixture (without admitting work)
    // so the next selection is forced to compare the two contacted words.
    const untouchedAcknowledgedAt = new Date();
    const untouchedOperationId = `long-history-untouched-${suffix}`;
    await prisma.studyStreamItem.update({
      where: { id: firstLongHistory.item.streamItemId },
      data: {
        status: "ACKNOWLEDGED",
        usedAt: untouchedAcknowledgedAt,
        feedbackAcknowledgedAt: untouchedAcknowledgedAt,
        operationId: untouchedOperationId,
        clientRevision: 1,
      },
    });
    await prisma.studyEncounter.create({
      data: {
        userId: longHistoryUser.id,
        wordId: longHistoryUntouched.id,
        senseId: longHistoryUntouched.senseId,
        streamItemId: firstLongHistory.item.streamItemId,
        operationId: untouchedOperationId,
        selfRating: "selfRecalled",
        selectionReason: "long-history-regression",
        policyVersion: "retrieval-v1",
        requiresVerification: false,
        createdAt: untouchedAcknowledgedAt,
        acknowledgedAt: untouchedAcknowledgedAt,
      },
    });
    const secondLongHistory = await getOrCreateStudyStream(longHistoryUser.id, longHistoryOptions);
    assert.ok(secondLongHistory.item);
    const secondLongHistoryRow = await prisma.studyStreamItem.findUniqueOrThrow({
      where: { id: secondLongHistory.item.streamItemId },
      select: { wordId: true, selectionReason: true },
    });
    assert.equal(secondLongHistoryRow.wordId, longHistoryTarget.id);
    assert.equal(secondLongHistoryRow.selectionReason, "unverified-contact");

    const leaderboard = await getLeaderboard(user.id);
    const scoredStreak = leaderboard.lists.find((list) => list.type === "streak");
    assert.equal(scoredStreak?.label, "客觀認讀連續天數");
    assert.equal(scoredStreak?.entries.find((entry) => entry.userId === user.id)?.value, 1);
    const studyDayOnlyLeaderboard = await getLeaderboard(studyDayOnlyUser.id);
    const studyDayOnlyStreak = studyDayOnlyLeaderboard.lists.find((list) => list.type === "streak");
    assert.equal(studyDayOnlyStreak?.entries.find((entry) => entry.userId === studyDayOnlyUser.id)?.value, 0);

    // The dual-flow window must support one learner using both the legacy
    // review route and the V2 stream without sharing item identity. The global
    // receipt namespace still rejects an operationId crossing flow versions.
    const legacyWord = await prisma.word.create({
      data: {
        term: `dual-flow-${suffix}`,
        definition: "V1／V2 coexistence test",
        level: "A1",
        category: `dual-flow-${suffix}`,
        synonyms: [],
        antonyms: [],
      },
    });
    cleanupWordIds.push(legacyWord.id);
    await prisma.review.create({
      data: { userId: user.id, wordId: legacyWord.id, nextReviewDate: new Date() },
    });
    const legacyNonce = randomUUID();
    const legacySession = await prisma.studySession.create({
      data: {
        userId: user.id,
        queueFingerprint: `dual-flow-${suffix}`,
        expiresAt: new Date(Date.now() + 60_000),
        flowVersion: "v1",
        items: { create: { wordId: legacyWord.id, nonce: legacyNonce } },
      },
    });
    const legacyOperationId = `dual-flow-v1-${suffix}`;
    const legacyResult = await applyReviewEvent({
      userId: user.id,
      wordId: legacyWord.id,
      quality: 5,
      operationId: legacyOperationId,
      studySessionId: legacySession.id,
      nonce: legacyNonce,
    });
    assert.equal(legacyResult.duplicate, false);
    const legacyReceipt = await prisma.operationReceipt.findUniqueOrThrow({
      where: { userId_operationId: { userId: user.id, operationId: legacyOperationId } },
      select: { flowVersion: true, actionKind: true, outcomeStatus: true },
    });
    assert.deepEqual(legacyReceipt, {
      flowVersion: "v1",
      actionKind: "REVIEW",
      outcomeStatus: "SCORED",
    });
    await assert.rejects(
      () => applyReviewEvent({
        userId: user.id,
        wordId: legacyWord.id,
        quality: 5,
        operationId: selfRatingInput.operationId,
      }),
      (error: unknown) => error instanceof Error && error.message.includes("不同的學習流程"),
    );
    // Execute the real cleanup in a rollback transaction: no existing local
    // session is permanently removed by this regression.
    const rollbackRetention = new Error("rollback retention regression");
    await assert.rejects(prisma.$transaction(async (tx) => {
      const beforeEncounters = await tx.studyEncounter.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } });
      const beforeEvents = await tx.reviewEvent.count({ where: { userId: user.id } });
      const beforeCoverage = new Set(beforeEncounters.map(row => row.wordId)).size;
      assert.ok(beforeCoverage > 0);
      const past = new Date(Date.now() - STUDY_SESSION_RETENTION_MS - 60_000);
      await tx.studySession.updateMany({ where: { userId: user.id }, data: { expiresAt: past } });
      await cleanupExpiredStudySessions(new Date(), 100_000, tx);
      assert.equal(await tx.studySession.count({ where: { id: legacySession.id } }), 0);
      assert.ok(await tx.studySession.count({ where: { userId: user.id, flowVersion: "v2" } }));
      const afterEncounters = await tx.studyEncounter.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } });
      assert.deepEqual(afterEncounters, beforeEncounters);
      assert.equal(new Set(afterEncounters.map(row => row.wordId)).size, beforeCoverage);
      assert.equal(await tx.reviewEvent.count({ where: { userId: user.id } }), beforeEvents);
      throw rollbackRetention;
    }, { timeout: 30_000 }), error => error === rollbackRetention);

    // A fresh page has no outbox action or credential: recover an unanswered
    // due target by leasing the same immutable target/snapshot in a new session.
    await prisma.studySession.updateMany({ where: { userId: user.id }, data: { retiredAt: new Date() } });
    await prisma.evidenceObligation.updateMany({ where: { userId: user.id }, data: { status: "CANCELLED", activeKey: null } });
    await prisma.review.updateMany({ where: { userId: user.id }, data: { nextReviewDate: new Date(Date.now() + 86400_000) } });
    const recoveryWordId = (await prisma.studyStreamItem.findUniqueOrThrow({ where: { id: probeItem.streamItemId } })).wordId!;
    await prisma.review.upsert({
      where: { userId_wordId: { userId: user.id, wordId: recoveryWordId } },
      create: { userId: user.id, wordId: recoveryWordId, nextReviewDate: new Date(0) },
      update: { nextReviewDate: new Date(0) },
    });
    let oldDue = await getOrCreateStudyStream(user.id);
    let dueInterveningCards = 0;
    // The due word may still be inside the learner-scoped spacing window
    // because it was the probe exercised earlier in this smoke test. Advance
    // through the same real card path until the shared spacing rule permits
    // the due probe; do not weaken the production scheduler just for a fixed
    // immediate-selection assertion.
    while (
      oldDue.item?.kind === "LEARNING_CARD" &&
      oldDue.item.selectionReason !== "due-review" &&
      dueInterveningCards < 4
    ) {
      const card = oldDue.item;
      const cardOperation = `stream-before-due-card-${suffix}-${dueInterveningCards}`;
      await applyStudyStreamAction(user.id, {
        flowVersion: "v2",
        studySessionId: oldDue.session.id,
        streamItemId: card.streamItemId,
        operationId: `${cardOperation}-reveal`,
        itemCredential: card.itemCredential,
        actionKind: "REVEAL",
        clientKnownRevision: card.clientRevision,
        payload: {},
      });
      await applyStudyStreamAction(user.id, {
        flowVersion: "v2",
        studySessionId: oldDue.session.id,
        streamItemId: card.streamItemId,
        operationId: `${cardOperation}-rating`,
        itemCredential: card.itemCredential,
        actionKind: "SELF_RATING",
        clientKnownRevision: card.clientRevision,
        payload: { selfRating: "selfForgot" },
      });
      dueInterveningCards += 1;
      oldDue = await getOrCreateStudyStream(user.id);
    }
    assert.equal(oldDue.item?.selectionReason, "due-review");
    assert.ok(oldDue.item?.objectiveQuestion);
    const oldDueRow = await prisma.studyStreamItem.findUniqueOrThrow({ where: { id: oldDue.item.streamItemId } });
    await prisma.studySession.update({ where: { id: oldDue.session.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const renewedDue = await getOrCreateStudyStream(user.id);
    assert.ok(renewedDue.item?.objectiveQuestion);
    assert.notEqual(renewedDue.session.id, oldDue.session.id);
    const renewedDueRow = await prisma.studyStreamItem.findUniqueOrThrow({ where: { id: renewedDue.item.streamItemId } });
    assert.equal(renewedDueRow.objectiveEvidenceTargetId, oldDueRow.objectiveEvidenceTargetId);
    assert.equal(renewedDueRow.objectiveQuestionSnapshotId, oldDueRow.objectiveQuestionSnapshotId);
    assert.deepEqual(renewedDue.item.objectiveQuestion, oldDue.item.objectiveQuestion);
    const recoverySnapshot = await prisma.objectiveQuestionSnapshot.findUniqueOrThrow({ where: { id: oldDueRow.objectiveQuestionSnapshotId! } });
    const newAnswer: StudyStreamActionInput = {
      flowVersion: "v2", studySessionId: renewedDue.session.id, streamItemId: renewedDue.item.streamItemId,
      itemCredential: renewedDue.item.itemCredential, clientKnownRevision: renewedDue.item.clientRevision,
      operationId: `renewed-due-${suffix}`, actionKind: "OBJECTIVE_ANSWER", payload: { selectedOptionId: recoverySnapshot.correctOptionId },
    };
    await applyStudyStreamAction(user.id, newAnswer);
    await assert.rejects(() => recoverExpiredStudyStreamAction(user.id, {
      ...newAnswer, studySessionId: oldDue.session.id, streamItemId: oldDue.item!.streamItemId,
      itemCredential: oldDue.item!.itemCredential, clientKnownRevision: oldDue.item!.clientRevision,
      operationId: `old-due-late-${suffix}`,
    }), error => error instanceof StudyStreamError && error.status === 409 && error.details.code === "SUPERSEDED_STREAM_ITEM");
    assert.equal(await prisma.reviewEvent.count({ where: { objectiveEvidenceTargetId: oldDueRow.objectiveEvidenceTargetId } }), 1);
    assert.equal((await prisma.studyStreamItem.findUniqueOrThrow({ where: { id: oldDueRow.id } })).status, "SUPERSEDED");

    // Reverse the race: an offline old page wins after a new page has leased
    // the target. The losing presentation must not keep resuming a spent goal.
    await prisma.studySession.updateMany({ where: { userId: user.id }, data: { retiredAt: new Date() } });
    await prisma.review.update({ where: { userId_wordId: { userId: user.id, wordId: recoveryWordId } }, data: { nextReviewDate: new Date(0) } });
    const reverseOld = await getOrCreateStudyStream(user.id);
    assert.ok(reverseOld.item?.objectiveQuestion);
    await prisma.studySession.update({ where: { id: reverseOld.session.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const reverseNew = await getOrCreateStudyStream(user.id);
    assert.ok(reverseNew.item?.objectiveQuestion);
    const reverseRow = await prisma.studyStreamItem.findUniqueOrThrow({ where: { id: reverseNew.item.streamItemId } });
    const reverseSnapshot = await prisma.objectiveQuestionSnapshot.findUniqueOrThrow({ where: { id: reverseRow.objectiveQuestionSnapshotId! } });
    const reverseAction: StudyStreamActionInput = {
      ...newAnswer, studySessionId: reverseOld.session.id, streamItemId: reverseOld.item.streamItemId,
      itemCredential: reverseOld.item.itemCredential, clientKnownRevision: reverseOld.item.clientRevision,
      operationId: `old-due-winner-${suffix}`, payload: { selectedOptionId: reverseSnapshot.correctOptionId },
    };
    await recoverExpiredStudyStreamAction(user.id, reverseAction);
    await assert.rejects(() => applyStudyStreamAction(user.id, {
      ...reverseAction, studySessionId: reverseNew.session.id, streamItemId: reverseNew.item!.streamItemId,
      itemCredential: reverseNew.item!.itemCredential, clientKnownRevision: reverseNew.item!.clientRevision,
      operationId: `new-due-loser-${suffix}`,
    }), error => error instanceof StudyStreamError && error.status === 409 && error.details.code === "SUPERSEDED_STREAM_ITEM");
    const afterReverse = await getOrCreateStudyStream(user.id);
    assert.notEqual(afterReverse.item?.streamItemId, reverseNew.item.streamItemId);
    assert.equal(await prisma.reviewEvent.count({ where: { objectiveEvidenceTargetId: reverseRow.objectiveEvidenceTargetId } }), 1);

    // A review revision or target cancellation can invalidate an unanswered
    // objective presentation while its session is still alive. The next GET
    // must retire that presentation and issue a fresh target, rather than
    // repeatedly returning an item that can only produce a terminal 409.
    await prisma.studySession.updateMany({ where: { userId: user.id }, data: { retiredAt: new Date() } });
    await prisma.evidenceObligation.updateMany({ where: { userId: user.id }, data: { status: "CANCELLED", activeKey: null } });
    await prisma.review.update({
      where: { userId_wordId: { userId: user.id, wordId: recoveryWordId } },
      data: { nextReviewDate: new Date(0) },
    });
    const staleBefore = await getOrCreateStudyStream(user.id);
    assert.equal(staleBefore.item?.kind, "OBJECTIVE_PROBE");
    assert.ok(staleBefore.item);
    const staleBeforeRow = await prisma.studyStreamItem.findUniqueOrThrow({ where: { id: staleBefore.item.streamItemId } });
    const staleBeforeTargetId = staleBeforeRow.objectiveEvidenceTargetId;
    assert.ok(staleBeforeTargetId);
    await prisma.review.update({
      where: { userId_wordId: { userId: user.id, wordId: recoveryWordId } },
      data: { revision: { increment: 1 }, nextReviewDate: new Date(0) },
    });
    const staleAfter = await getOrCreateStudyStream(user.id);
    assert.equal(staleAfter.item?.kind, "OBJECTIVE_PROBE");
    assert.notEqual(staleAfter.item?.streamItemId, staleBefore.item.streamItemId);
    assert.equal((await prisma.studyStreamItem.findUniqueOrThrow({ where: { id: staleBeforeRow.id } })).status, "SUPERSEDED");
    assert.equal((await prisma.objectiveEvidenceTarget.findUniqueOrThrow({ where: { id: staleBeforeTargetId } })).status, "CANCELLED");

    // A remediation obligation is learner-wide even when two tabs use
    // different scopes. Issuing the same work in a new scope must supersede
    // the old presentation so its late action is an explicit terminal
    // conflict, rather than a generic retryable failure.
    await prisma.studySession.updateMany({ where: { userId: user.id }, data: { retiredAt: new Date() } });
    await prisma.evidenceObligation.updateMany({
      where: { userId: user.id, status: { in: ["PENDING", "LEASED"] } },
      data: { status: "CANCELLED", activeKey: null },
    });
    await prisma.review.updateMany({
      where: { userId: user.id },
      data: { nextReviewDate: new Date(Date.now() + 86400_000) },
    });
    const unitRemediationWord = await prisma.word.findFirstOrThrow({
      where: withCurrentCatalogWord({ level: "A1", category: testUnitCategory }),
      select: { id: true, senseId: true },
    });
    const remediationObligation = await prisma.evidenceObligation.create({
      data: {
        userId: user.id,
        wordId: unitRemediationWord.id,
        senseId: unitRemediationWord.senseId,
        kind: "REMEDIATION",
        status: "PENDING",
        sourceOperationId: `cross-scope-remediation-${suffix}`,
        selectionReason: "audit-cross-scope-remediation",
        policyVersion: "retrieval-v1",
        eligibleAt: new Date(),
        expiresAt: new Date(Date.now() + 86400_000),
        activeKey: `cross-scope-remediation:${suffix}`,
      },
    });
    const globalRemediation = await getOrCreateStudyStream(user.id);
    assert.equal(globalRemediation.item?.kind, "LEARNING_CARD");
    assert.equal(globalRemediation.item?.selectionReason, "remediation");
    const unitRemediation = await getOrCreateStudyStream(user.id, {
      mode: "unit",
      level: "A1",
      category: testUnitCategory,
    });
    assert.equal(unitRemediation.item?.kind, "LEARNING_CARD");
    assert.equal(unitRemediation.item?.selectionReason, "remediation");
    assert.notEqual(unitRemediation.session.id, globalRemediation.session.id);
    assert.equal(
      (await prisma.studyStreamItem.findUniqueOrThrow({ where: { id: globalRemediation.item!.streamItemId } })).status,
      "SUPERSEDED",
    );
    assert.equal(
      (await prisma.evidenceObligation.findUniqueOrThrow({ where: { id: remediationObligation.id } })).leaseOwnerSessionId,
      unitRemediation.session.id,
    );
    await assert.rejects(
      () => applyStudyStreamAction(user.id, {
        flowVersion: "v2",
        studySessionId: globalRemediation.session.id,
        streamItemId: globalRemediation.item!.streamItemId,
        operationId: `cross-scope-late-${suffix}`,
        itemCredential: globalRemediation.item!.itemCredential,
        actionKind: "REVEAL",
        clientKnownRevision: globalRemediation.item!.clientRevision,
        payload: {},
      }),
      (error: unknown) => error instanceof StudyStreamError && error.status === 409 && error.details.code === "SUPERSEDED_STREAM_ITEM",
    );

    // A remediation card must leave the continuation queue as soon as its
    // learner-wide obligation reaches a terminal state. Exercise expiry via
    // another scope, then cover cancellation and completion against the real
    // getOrCreateStudyStream path so an old card cannot cause a terminal-409
    // loop on every reload.
    await prisma.studySession.updateMany({ where: { userId: user.id }, data: { retiredAt: new Date() } });
    await prisma.evidenceObligation.updateMany({
      where: { userId: user.id, status: { in: ["PENDING", "LEASED"] } },
      data: { status: "CANCELLED", activeKey: null },
    });
    await prisma.review.updateMany({ where: { userId: user.id }, data: { nextReviewDate: new Date(Date.now() + 86400_000) } });
    const expiringObligation = await prisma.evidenceObligation.create({
      data: {
        userId: user.id,
        wordId: unitRemediationWord.id,
        senseId: unitRemediationWord.senseId,
        kind: "REMEDIATION",
        status: "PENDING",
        sourceOperationId: `expired-remediation-${suffix}`,
        selectionReason: "audit-expired-remediation",
        policyVersion: "retrieval-v1",
        eligibleAt: new Date(),
        expiresAt: new Date(Date.now() + 86400_000),
        activeKey: `expired-remediation:${suffix}`,
      },
    });
    const expiringGlobal = await getOrCreateStudyStream(user.id);
    assert.equal(expiringGlobal.item?.kind, "LEARNING_CARD");
    assert.equal(expiringGlobal.item?.selectionReason, "remediation");
    const expiringItemId = expiringGlobal.item!.streamItemId;
    await prisma.evidenceObligation.update({
      where: { id: expiringObligation.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await getOrCreateStudyStream(user.id, {
      mode: "unit",
      level: "A1",
      category: testUnitCategory,
    });
    assert.equal(
      (await prisma.evidenceObligation.findUniqueOrThrow({ where: { id: expiringObligation.id } })).status,
      "EXPIRED",
    );
    assert.equal(
      (await prisma.studyStreamItem.findUniqueOrThrow({ where: { id: expiringItemId } })).status,
      "SUPERSEDED",
    );
    const afterExpiryReload = await getOrCreateStudyStream(user.id);
    assert.notEqual(afterExpiryReload.item?.streamItemId, expiringItemId);

    for (const terminalStatus of ["CANCELLED", "ANSWERED"] as const) {
      await prisma.studySession.updateMany({ where: { userId: user.id }, data: { retiredAt: new Date() } });
      const terminalObligation = await prisma.evidenceObligation.create({
        data: {
          userId: user.id,
          wordId: unitRemediationWord.id,
          senseId: unitRemediationWord.senseId,
          kind: "REMEDIATION",
          status: terminalStatus,
          sourceOperationId: `terminal-remediation-${terminalStatus.toLowerCase()}-${suffix}`,
          selectionReason: `audit-${terminalStatus.toLowerCase()}-remediation`,
          policyVersion: "retrieval-v1",
          eligibleAt: new Date(),
          expiresAt: new Date(Date.now() + 86400_000),
        },
      });
      const terminalCredential = createStudyStreamCredential();
      const terminalSession = await prisma.studySession.create({
        data: {
          userId: user.id,
          queueFingerprint: `terminal-remediation-${terminalStatus.toLowerCase()}-${suffix}`,
          expiresAt: new Date(Date.now() + 30 * 60_000),
          flowVersion: "v2",
          learningPolicyVersion: "retrieval-v1",
          mode: "global",
          revision: 0,
          streamItems: {
            create: {
              streamItemKey: `terminal-remediation-${terminalStatus.toLowerCase()}-${suffix}`,
              wordId: unitRemediationWord.id,
              senseId: unitRemediationWord.senseId,
              itemKind: "LEARNING_CARD",
              selectionReason: "terminal-remediation-test",
              policyVersion: "retrieval-v1",
              status: "LEASED",
              leaseExpiresAt: new Date(Date.now() + 15 * 60_000),
              credentialDigest: digestStudyStreamCredential(terminalCredential),
              credentialExpiresAt: new Date(Date.now() + 15 * 60_000),
              clientRevision: 0,
              workObligationId: terminalObligation.id,
            },
          },
        },
        include: { streamItems: true },
      });
      const terminalItemId = terminalSession.streamItems[0]!.id;
      const terminalReload = await getOrCreateStudyStream(user.id);
      assert.notEqual(terminalReload.item?.streamItemId, terminalItemId);
      assert.equal(
        (await prisma.studyStreamItem.findUniqueOrThrow({ where: { id: terminalItemId } })).status,
        "SUPERSEDED",
      );
    }

    // Keep an immutable question snapshot from revision A, then advance the
    // projection and approved sense to revision B before submitting the old
    // probe. The scored event must retain the exact content shown to the
    // learner and remain idempotent on retry.
    await prisma.studySession.updateMany({ where: { userId: user.id }, data: { retiredAt: new Date() } });
    await prisma.evidenceObligation.updateMany({
      where: { userId: user.id, status: { in: ["PENDING", "LEASED"] } },
      data: { status: "CANCELLED", activeKey: null },
    });
    await prisma.review.updateMany({ where: { userId: user.id }, data: { nextReviewDate: new Date(Date.now() + 86400_000) } });
    const readyForProvenance = await prisma.catalogRevision.findFirstOrThrow({
      where: { status: "READY" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const provenanceCatalogRevisionB = await prisma.catalogRevision.create({
      data: {
        revisionKey: `stream-provenance-${suffix}`,
        sourceDigest: `stream-provenance-source-${suffix}`,
        taxonomyDigest: `stream-provenance-taxonomy-${suffix}`,
        validatorVersion: "stream-provenance-validator",
        normalizationVersion: "stream-provenance-normalization",
        activationBasis: "INTEGRATION_TEST",
        status: "READY",
      },
    });
    catalogFixtureCatalogRevisionIds.push(provenanceCatalogRevisionB.id);
    const provenanceEntry = await prisma.catalogEntry.create({
      data: {
        catalogKey: `stream-provenance-${suffix}`,
        lemma: `stream-provenance-${suffix}`,
        normalizedLemma: `stream-provenance-${suffix}`,
      },
    });
    catalogFixtureEntryIds.push(provenanceEntry.id);
    const provenanceTermA = `colour-${suffix}`;
    const provenanceTermB = `color-${suffix}`;
    const provenanceDefinitionA = `版本甲釋義-${suffix}`;
    const provenanceDefinitionB = `版本乙釋義-${suffix}`;
    const provenanceSense = await prisma.wordSense.create({
      data: {
        catalogEntryId: provenanceEntry.id,
        senseKey: `stream-provenance:${suffix}`,
        term: provenanceTermA,
        normalizedTerm: provenanceTermA,
        pos: "noun",
        level: "A1",
        category: testUnitCategory,
        status: "DRAFT",
      },
    });
    catalogFixtureSenseIds.push(provenanceSense.id);
    const provenanceRevisionA = await prisma.wordSenseRevision.create({
      data: {
        senseId: provenanceSense.id,
        revision: 1,
        term: provenanceTermA,
        lemma: provenanceTermA,
        pos: "noun",
        level: "A1",
        category: testUnitCategory,
        definitionZh: provenanceDefinitionA,
        acceptedAnswersZh: [provenanceDefinitionA],
        enableEnToZh: true,
        distractorZh: [`甲干擾一-${suffix}`, `甲干擾二-${suffix}`, `甲干擾三-${suffix}`, `甲干擾四-${suffix}`, `甲干擾五-${suffix}`],
        contentDigest: `stream-provenance-a-${suffix}`,
        catalogRevisionId: readyForProvenance.id,
      },
    });
    catalogFixtureRevisionIds.push(provenanceRevisionA.id);
    await prisma.wordSense.update({ where: { id: provenanceSense.id }, data: { status: "ACTIVE", approvedRevisionId: provenanceRevisionA.id } });
    const provenanceWord = await prisma.word.create({
      data: {
        term: provenanceTermA,
        definition: provenanceDefinitionA,
        level: "A1",
        category: testUnitCategory,
        synonyms: [],
        antonyms: [],
        acceptedAnswers: [provenanceDefinitionA],
        distractorZh: [`甲干擾一-${suffix}`, `甲干擾二-${suffix}`, `甲干擾三-${suffix}`, `甲干擾四-${suffix}`, `甲干擾五-${suffix}`],
        enableEnToZh: true,
        enableZhToEn: false,
        senseId: provenanceSense.id,
        senseKey: provenanceSense.senseKey,
        contentRevisionId: provenanceRevisionA.id,
        catalogRevisionId: readyForProvenance.id,
      },
    });
    catalogFixtureWordIds.push(provenanceWord.id);
    const provenanceRevisionB = await prisma.wordSenseRevision.create({
      data: {
        senseId: provenanceSense.id,
        revision: 2,
        term: provenanceTermB,
        lemma: provenanceTermB,
        pos: "noun",
        level: "B2",
        category: testUnitCategory,
        definitionZh: provenanceDefinitionB,
        acceptedAnswersZh: [provenanceDefinitionB],
        enableEnToZh: true,
        distractorZh: [`乙干擾一-${suffix}`, `乙干擾二-${suffix}`, `乙干擾三-${suffix}`, `乙干擾四-${suffix}`, `乙干擾五-${suffix}`],
        contentDigest: `stream-provenance-b-${suffix}`,
        catalogRevisionId: provenanceCatalogRevisionB.id,
      },
    });
    catalogFixtureRevisionIds.push(provenanceRevisionB.id);
    await prisma.review.upsert({
      where: { userId_wordId: { userId: user.id, wordId: provenanceWord.id } },
      create: { userId: user.id, wordId: provenanceWord.id, senseId: provenanceSense.id, nextReviewDate: new Date(0) },
      update: { nextReviewDate: new Date(0), senseId: provenanceSense.id },
    });
    await prisma.evidenceObligation.create({
      data: {
        userId: user.id,
        wordId: provenanceWord.id,
        senseId: provenanceSense.id,
        kind: "EVIDENCE_OBLIGATION",
        status: "PENDING",
        sourceOperationId: `provenance-obligation-${suffix}`,
        selectionReason: "audit-provenance-snapshot",
        policyVersion: "retrieval-v1",
        eligibleAt: new Date(),
        expiresAt: new Date(Date.now() + 86400_000),
        activeKey: `provenance-obligation:${suffix}`,
      },
    });
    const provenanceProbe = await getOrCreateStudyStream(user.id);
    assert.equal(provenanceProbe.item?.kind, "OBJECTIVE_PROBE");
    assert.ok(provenanceProbe.item);
    const provenanceStreamRow = await prisma.studyStreamItem.findUniqueOrThrow({
      where: { id: provenanceProbe.item.streamItemId },
      select: { wordId: true, objectiveQuestionSnapshotId: true },
    });
    assert.equal(provenanceStreamRow.wordId, provenanceWord.id);
    const provenanceSnapshot = await prisma.objectiveQuestionSnapshot.findUniqueOrThrow({
      where: { id: provenanceStreamRow.objectiveQuestionSnapshotId! },
    });
    assert.equal(provenanceSnapshot.contentRevisionId, provenanceRevisionA.id);
    assert.equal(provenanceSnapshot.catalogRevisionId, readyForProvenance.id);
    await prisma.wordSense.update({
      where: { id: provenanceSense.id },
      data: { term: provenanceTermB, normalizedTerm: provenanceTermB, level: "B2", approvedRevisionId: provenanceRevisionB.id },
    });
    await prisma.word.update({
      where: { id: provenanceWord.id },
      data: { term: provenanceTermB, definition: provenanceDefinitionB, level: "B2", contentRevisionId: provenanceRevisionB.id, catalogRevisionId: provenanceCatalogRevisionB.id },
    });
    const provenanceAnswer: StudyStreamActionInput = {
      flowVersion: "v2",
      studySessionId: provenanceProbe.session.id,
      streamItemId: provenanceProbe.item.streamItemId,
      operationId: `provenance-answer-${suffix}`,
      itemCredential: provenanceProbe.item.itemCredential,
      actionKind: "OBJECTIVE_ANSWER",
      clientKnownRevision: provenanceProbe.item.clientRevision,
      payload: { selectedOptionId: provenanceSnapshot.correctOptionId },
    };
    await applyStudyStreamAction(user.id, provenanceAnswer);
    const provenanceEvent = await prisma.reviewEvent.findFirstOrThrow({
      where: { userId: user.id, operationId: provenanceAnswer.operationId },
    });
    assert.equal(provenanceEvent.objectiveQuestionSnapshotId, provenanceSnapshot.id);
    assert.equal(provenanceEvent.contentRevisionId, provenanceRevisionA.id);
    assert.equal(provenanceEvent.catalogRevisionId, readyForProvenance.id);
    assert.equal(provenanceEvent.wordTerm, provenanceTermA);
    assert.equal(provenanceEvent.wordLevel, "A1");
    assert.equal(await prisma.reviewEvent.count({ where: { userId: user.id, objectiveQuestionSnapshotId: provenanceSnapshot.id } }), 1);
    const duplicateProvenanceAnswer = await applyStudyStreamAction(user.id, provenanceAnswer);
    assert.equal(duplicateProvenanceAnswer.duplicate, true);
    assert.equal(await prisma.reviewEvent.count({ where: { userId: user.id, objectiveQuestionSnapshotId: provenanceSnapshot.id } }), 1);

    // Feedback is a read-only continuation of the scored question, not a
    // lease owned by the short-lived session. Once the original session has
    // expired, a fresh bootstrap must still return the same pending feedback
    // (and never make the consumed question scorable again).
    await prisma.studySession.update({
      where: { id: provenanceProbe.session.id },
      data: { expiresAt: new Date(Date.now() - 31 * 60_000) },
    });
    const otherAccountBootstrap = await getOrCreateStudyStream(studyDayOnlyUserId!);
    assert.notEqual(otherAccountBootstrap.item?.streamItemId, provenanceProbe.item.streamItemId);

    // A revoked session is not an eligible feedback source, even if its item
    // still has an unacknowledged receipt. The normal bootstrap may create a
    // replacement session/item, but it must not expose the revoked question.
    await prisma.studySession.update({
      where: { id: provenanceProbe.session.id },
      data: { retiredAt: new Date() },
    });
    const revokedFeedbackReload = await getOrCreateStudyStream(user.id);
    assert.notEqual(revokedFeedbackReload.item?.streamItemId, provenanceProbe.item.streamItemId);

    // Retire any replacement V2 sessions created by the negative control, then
    // restore only the original non-revoked (but expired) session for the real
    // cross-session continuation assertions below.
    await prisma.studySession.updateMany({
      where: { userId: user.id, flowVersion: "v2", id: { not: provenanceProbe.session.id }, retiredAt: null },
      data: { retiredAt: new Date() },
    });
    await prisma.studySession.update({
      where: { id: provenanceProbe.session.id },
      data: { retiredAt: null, expiresAt: new Date(Date.now() - 31 * 60_000) },
    });
    const expiredFeedbackA = await getOrCreateStudyStream(user.id);
    assert.equal(expiredFeedbackA.resumedFeedback, true);
    assert.equal(expiredFeedbackA.session.id, provenanceProbe.session.id);
    assert.equal(expiredFeedbackA.item?.streamItemId, provenanceProbe.item.streamItemId);
    assert.equal(expiredFeedbackA.item?.feedback?.acknowledged, false);
    const expiredFeedbackItem = expiredFeedbackA.item;
    assert.ok(expiredFeedbackItem);
    await assert.rejects(
      () => applyStudyStreamAction(user.id, {
        flowVersion: "v2",
        studySessionId: expiredFeedbackA.session.id,
        streamItemId: expiredFeedbackItem.streamItemId,
        operationId: `provenance-expired-rescore-${suffix}`,
        itemCredential: expiredFeedbackItem.itemCredential,
        actionKind: "OBJECTIVE_ANSWER",
        clientKnownRevision: expiredFeedbackItem.clientRevision,
        payload: { selectedOptionId: provenanceSnapshot.correctOptionId },
      }),
      (error: unknown) => error instanceof StudyStreamError && error.status === 403 && error.details.code === "SESSION_EXPIRED",
    );
    const expiredFeedbackB = await getOrCreateStudyStream(user.id, {
      itemCredential: expiredFeedbackItem.itemCredential,
    });
    assert.equal(expiredFeedbackB.resumedFeedback, true);
    assert.equal(expiredFeedbackB.session.id, provenanceProbe.session.id);
    assert.equal(expiredFeedbackB.item?.streamItemId, provenanceProbe.item.streamItemId);
    assert.ok(expiredFeedbackB.item);

    // Two tabs can confirm the recovered feedback concurrently. Both callers
    // receive an authoritative acknowledgement, while the scored event stays
    // exactly once and the item leaves the pending-feedback state.
    const expiredFeedbackAcks = await Promise.allSettled([expiredFeedbackA, expiredFeedbackB].map((state, index) =>
      applyStudyStreamAction(user.id, {
        flowVersion: "v2",
        studySessionId: state.session.id,
        streamItemId: state.item!.streamItemId,
        operationId: `provenance-expired-feedback-${suffix}-${index}`,
        itemCredential: state.item!.itemCredential,
        actionKind: "FEEDBACK_ACK",
        clientKnownRevision: state.item!.clientRevision,
        payload: {},
      }),
    ));
    assert.equal(expiredFeedbackAcks.filter((result) => result.status === "fulfilled").length, 2);
    for (const result of expiredFeedbackAcks) {
      assert.equal(result.status, "fulfilled");
      if (result.status === "fulfilled") {
        assert.equal(result.value.response.itemStatus, "ACKNOWLEDGED");
        assert.equal(result.value.response.feedback?.acknowledged, true);
      }
    }
    const acknowledgedProvenanceItem = await prisma.studyStreamItem.findUniqueOrThrow({
      where: { id: provenanceProbe.item.streamItemId },
      select: { feedbackAcknowledgedAt: true, status: true },
    });
    assert.ok(acknowledgedProvenanceItem.feedbackAcknowledgedAt);
    assert.equal(acknowledgedProvenanceItem.status, "ACKNOWLEDGED");
    const expiredSourceSession = await prisma.studySession.findUniqueOrThrow({
      where: { id: provenanceProbe.session.id },
      select: { expiresAt: true },
    });
    assert.ok(expiredSourceSession.expiresAt.getTime() <= Date.now());
    assert.equal(await prisma.reviewEvent.count({ where: { userId: user.id, objectiveQuestionSnapshotId: provenanceSnapshot.id } }), 1);
    const afterExpiredFeedback = await getOrCreateStudyStream(user.id);
    assert.notEqual(afterExpiredFeedback.item?.streamItemId, provenanceProbe.item.streamItemId);

    // A read-only feedback acknowledgement may itself arrive after the
    // source session and its current credential have expired. It must not
    // revive that short-lived session merely to record the acknowledgement.
    const pendingFeedbackFixture = await prisma.studyStreamItem.findUniqueOrThrow({
      where: { id: provenanceProbe.item.streamItemId },
      select: { credentialLineage: true, credentialDigest: true },
    });
    const expiredLineage = Array.isArray(pendingFeedbackFixture.credentialLineage)
      ? pendingFeedbackFixture.credentialLineage.map((entry) => {
          if (typeof entry !== "object" || entry === null || !("digest" in entry)) return entry;
          return { ...entry, expiresAt: Date.now() - 1_000 };
        })
      : [];
    await prisma.studyStreamItem.update({
      where: { id: provenanceProbe.item.streamItemId },
      data: {
        status: "ANSWERED",
        feedbackAcknowledgedAt: null,
        credentialExpiresAt: new Date(Date.now() - 1_000),
        credentialLineage: expiredLineage as unknown as PrismaTypes.InputJsonValue,
      },
    });
    const pendingFeedbackSessionBeforeRecovery = await prisma.studySession.findUniqueOrThrow({
      where: { id: provenanceProbe.session.id },
      select: { expiresAt: true },
    });
    const expiredCredentialFeedback = await recoverExpiredStudyStreamAction(user.id, {
      flowVersion: "v2",
      studySessionId: provenanceProbe.session.id,
      streamItemId: provenanceProbe.item.streamItemId,
      operationId: `provenance-expired-credential-feedback-${suffix}`,
      itemCredential: provenanceProbe.item.itemCredential,
      actionKind: "FEEDBACK_ACK",
      clientKnownRevision: provenanceProbe.item.clientRevision,
      payload: {},
    });
    assert.equal(expiredCredentialFeedback.response.itemStatus, "ACKNOWLEDGED");
    const pendingFeedbackSessionAfterRecovery = await prisma.studySession.findUniqueOrThrow({
      where: { id: provenanceProbe.session.id },
      select: { expiresAt: true },
    });
    assert.equal(
      pendingFeedbackSessionAfterRecovery.expiresAt.getTime(),
      pendingFeedbackSessionBeforeRecovery.expiresAt.getTime(),
    );
    assert.equal(await prisma.reviewEvent.count({ where: { userId: user.id, objectiveQuestionSnapshotId: provenanceSnapshot.id } }), 1);

    const dualFlowSessions = await prisma.studySession.groupBy({
      by: ["flowVersion"],
      where: { userId: user.id },
      _count: { _all: true },
    });
    assert.ok(dualFlowSessions.some((row) => row.flowVersion === "v1" && row._count._all >= 1));
    assert.ok(dualFlowSessions.some((row) => row.flowVersion === "v2" && row._count._all >= 1));

    // The helper is intentionally exercised so this gate also catches accidental
    // replacement of opaque random credentials with a client-chosen value.
    assert.notEqual(createStudyStreamCredential(), createStudyStreamCredential());
    console.log("study stream v2 integration checks passed");
  } finally {
    // ObjectiveQuestionSnapshot keeps nullable links to users' targets,
    // stream items and review events (all are SetNull on delete). Collect and
    // remove every snapshot owned by this disposable learner before deleting
    // the user, otherwise each integration run would leave orphan snapshots.
    const snapshotOwnerIds = [userId, studyDayOnlyUserId, scheduleGapUserId, obligationGapUserId, longHistoryUserId].filter(
      (id): id is string => id !== null,
    );
    if (snapshotOwnerIds.length > 0) {
      const snapshotRows = await prisma.objectiveQuestionSnapshot.findMany({
        where: {
          OR: snapshotOwnerIds.flatMap((ownerId) => [
            { target: { userId: ownerId } },
            { streamItems: { some: { session: { userId: ownerId } } } },
            { reviewEvents: { some: { userId: ownerId } } },
          ]),
        },
        select: { id: true },
      });
      objectiveQuestionSnapshotIds.push(...snapshotRows.map((row) => row.id));
      if (objectiveQuestionSnapshotIds.length > 0) {
        await prisma.objectiveQuestionSnapshot.deleteMany({
          where: { id: { in: objectiveQuestionSnapshotIds } },
        });
      }
    }
    if (userId) await prisma.user.delete({ where: { id: userId } });
    if (studyDayOnlyUserId) await prisma.user.delete({ where: { id: studyDayOnlyUserId } });
    if (scheduleGapUserId) await prisma.user.delete({ where: { id: scheduleGapUserId } });
    if (obligationGapUserId) await prisma.user.delete({ where: { id: obligationGapUserId } });
    if (longHistoryUserId) await prisma.user.delete({ where: { id: longHistoryUserId } });
    const disposableWordIds = [...cleanupWordIds, ...catalogFixtureWordIds];
    if (disposableWordIds.length > 0) {
      await prisma.word.deleteMany({ where: { id: { in: disposableWordIds } } });
    }
    if (catalogFixtureSenseIds.length > 0) {
      await prisma.wordSense.updateMany({
        where: { id: { in: catalogFixtureSenseIds } },
        data: { approvedRevisionId: null },
      });
    }
    if (catalogFixtureRevisionIds.length > 0) {
      await prisma.wordSenseRevision.deleteMany({
        where: { id: { in: catalogFixtureRevisionIds } },
      });
    }
    if (catalogFixtureSenseIds.length > 0) {
      await prisma.wordSense.deleteMany({ where: { id: { in: catalogFixtureSenseIds } } });
    }
    if (catalogFixtureEntryIds.length > 0) {
      await prisma.catalogEntry.deleteMany({ where: { id: { in: catalogFixtureEntryIds } } });
    }
    if (catalogFixtureCatalogRevisionIds.length > 0) {
      await prisma.catalogRevision.deleteMany({
        where: { id: { in: catalogFixtureCatalogRevisionIds } },
      });
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
