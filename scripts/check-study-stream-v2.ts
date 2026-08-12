import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import type { StudyStreamActionInput } from "../src/lib/study-stream/contracts";

dotenv.config({ path: ".env.local" });

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const {
    applyStudyStreamAction,
    getOrCreateStudyStream,
  } = await import("../src/lib/study-stream/server");
  const {
    createStudyStreamCredential,
    digestStudyStreamCredential,
  } = await import("../src/lib/study-stream/contracts");
  const suffix = randomUUID();
  let userId: string | null = null;
  const wordIds: string[] = [];

  try {
    const user = await prisma.user.create({
      data: {
        email: `codex-stream-${suffix}`,
        passwordHash: "not-a-login-account",
        mustChangePassword: false,
      },
    });
    userId = user.id;
    for (let index = 0; index < 8; index += 1) {
      const word = await prisma.word.create({
        data: {
          term: `streamword-${suffix}-${index}`,
          definition: `测试释义${index}；学习词条`,
          level: "A1",
          category: "Hello and Goodbye",
          synonyms: [],
          antonyms: [],
        },
      });
      wordIds.push(word.id);
    }

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
      category: "Hello and Goodbye",
    });
    assert.equal(unitBootstrap.session.mode, "unit");
    assert.ok(unitBootstrap.item);
    assert.equal(unitBootstrap.item.kind, "LEARNING_CARD");
    assert.ok(unitBootstrap.item.prompt.length > 0);

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
    assert.equal(await prisma.studyEncounter.count({ where: { userId: user.id } }), 8);
    assert.equal(await prisma.operationReceipt.count({ where: { userId: user.id } }), 12);

    // The helper is intentionally exercised so this gate also catches accidental
    // replacement of opaque random credentials with a client-chosen value.
    assert.notEqual(createStudyStreamCredential(), createStudyStreamCredential());
    console.log("study stream v2 integration checks passed");
  } finally {
    if (userId) await prisma.user.delete({ where: { id: userId } });
    if (wordIds.length > 0) await prisma.word.deleteMany({ where: { id: { in: wordIds } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
