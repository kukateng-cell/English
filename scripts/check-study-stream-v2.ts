import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import type { StudyStreamActionInput } from "../src/lib/study-stream/contracts";
import { CATALOG_CATEGORIES } from "../src/lib/catalog/taxonomy";
import {
  currentCatalogWordCtesSql,
  withCurrentCatalogWord,
} from "../src/lib/catalog/runtime";

dotenv.config({ path: ".env.local" });

async function main() {
  const { Prisma, prisma } = await import("../src/lib/prisma");
  const { applyReviewEvent } = await import("../src/app/api/study/route");
  const {
    applyStudyStreamAction,
    getOrCreateStudyStream,
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
  const wordIds: string[] = [];
  const cleanupWordIds: string[] = [];
  const catalogFixtureWordIds: string[] = [];
  const catalogFixtureSenseIds: string[] = [];
  const catalogFixtureEntryIds: string[] = [];
  const catalogFixtureRevisionIds: string[] = [];
  const catalogFixtureCatalogRevisionIds: string[] = [];

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

    await prisma.evidenceObligation.update({
      where: { id: obligation.id },
      data: { eligibleAt: new Date(Date.now() - 1_000) },
    });

    const probeBootstrap = await getOrCreateStudyStream(user.id, { itemCredential: learningItem.itemCredential });
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
    const remediation = await getOrCreateStudyStream(user.id);
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
    assert.equal(await prisma.studyEncounter.count({ where: { userId: user.id } }), 10);
    assert.equal(await prisma.operationReceipt.count({ where: { userId: user.id } }), 16);

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
    assert.equal(metrics.selfRatedEncounterCount, 10);
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
    assert.equal(dashboard.today.selfRatedEncounterCount, 10);
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
    const oldDue = await getOrCreateStudyStream(user.id);
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
    if (userId) await prisma.user.delete({ where: { id: userId } });
    if (studyDayOnlyUserId) await prisma.user.delete({ where: { id: studyDayOnlyUserId } });
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
