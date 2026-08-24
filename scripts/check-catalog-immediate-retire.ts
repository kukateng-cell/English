import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma";
import { requireCatalogReviewerInTransaction } from "../src/lib/catalog/access";
import {
  cancelSupersededStandaloneRetireRequests,
  ensureCatalogMutationStateLocked,
  reviewCatalogChange,
} from "../src/lib/catalog/change-application";
import { isRetryableTransactionConflict, waitForTransactionRetry } from "../src/lib/transaction-retry";

dotenv.config({ path: ".env.local", override: true });
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const environment = process.env.DATABASE_ENVIRONMENT;
if (!environment || environment === "production" || process.env.CONFIRM_DATABASE_ENVIRONMENT !== environment) {
  throw new Error("check:catalog-immediate-retire requires matching non-production DATABASE_ENVIRONMENT and CONFIRM_DATABASE_ENVIRONMENT");
}

function createClient() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const prisma = createClient();
const ROLLBACK = "CATALOG_IMMEDIATE_RETIRE_CHECK_ROLLBACK";
const temporaryUserIds: string[] = [];

async function runWithTransactionRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const staleWrite = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
      if ((!isRetryableTransactionConflict(error) && !staleWrite) || attempt === 2) throw error;
      await waitForTransactionRetry(attempt);
    }
  }
  throw new Error("Concurrent catalog decision retry exhausted.");
}

async function main() {
  const metadata = await prisma.databaseMetadata.findUnique({ where: { key: "environment" }, select: { value: true } });
  if (metadata?.value !== environment) {
    throw new Error("DatabaseMetadata.environment does not match DATABASE_ENVIRONMENT");
  }
  let verified = false;
  let rollbackRequestId = "";
  let rollbackSenseId = "";
  let rollbackApprovedRevisionId = "";
  let rollbackProjectionId = "";
  let rollbackMutationRevision = 0;
  try {
    await prisma.$transaction(async (tx) => {
      const actor = await tx.user.findFirst({
        where: {
          status: "ACTIVE",
          OR: [
            { role: "ADMIN" },
            { role: "TEACHER", teacherProfile: { is: { canManageWordCatalog: true } } },
          ],
        },
        select: { id: true },
      });
      if (!actor) throw new Error("No active catalog reviewer exists.");

      const sense = await tx.wordSense.findFirst({
        where: {
          status: "ACTIVE",
          approvedRevisionId: { not: null },
          changeRequests: { none: { status: "PENDING" } },
        },
        orderBy: { id: "asc" },
        select: {
          id: true,
          senseKey: true,
          normalizedTerm: true,
          status: true,
          approvedRevisionId: true,
          approvedRevision: true,
          catalogEntry: { select: { catalogKey: true } },
          wordProjection: { select: { id: true } },
        },
      });
      if (!sense?.approvedRevision || !sense.approvedRevisionId || !sense.wordProjection) {
        throw new Error("No eligible ACTIVE catalog sense exists.");
      }

      const unauthorizedTeacher = await tx.user.findFirst({
        where: {
          role: "TEACHER",
          status: "ACTIVE",
          teacherProfile: { is: { canManageWordCatalog: false } },
        },
        select: { id: true },
      });
      if (!unauthorizedTeacher) throw new Error("No ordinary active teacher exists for the authorization check.");
      await assert.rejects(
        () => requireCatalogReviewerInTransaction(tx, unauthorizedTeacher.id),
        /CATALOG_REVIEW_FORBIDDEN/,
      );

      await requireCatalogReviewerInTransaction(tx, actor.id);
      const operationId = randomUUID();
      const reason = "本機即時停用交易回歸檢查";
      const request = await tx.catalogChangeRequest.create({
        data: {
          operationId,
          requestFingerprint: `immediate-retire-check:${operationId}`,
          kind: "RETIRE",
          catalogKey: sense.catalogEntry.catalogKey,
          senseKey: sense.senseKey,
          senseId: sense.id,
          proposerId: actor.id,
          baseRevision: sense.approvedRevision.revision,
          baseStatus: sense.status,
          payload: {},
          reason,
        },
        select: { id: true, revision: true },
      });
      const mutationState = await tx.catalogMutationState.findUniqueOrThrow({ where: { id: 1 }, select: { revision: true } });
      rollbackRequestId = request.id;
      rollbackSenseId = sense.id;
      rollbackApprovedRevisionId = sense.approvedRevisionId;
      rollbackProjectionId = sense.wordProjection.id;
      rollbackMutationRevision = mutationState.revision;

      const first = await reviewCatalogChange(tx, {
        requestId: request.id,
        reviewerId: actor.id,
        expectedRevision: request.revision,
        decision: "APPROVE",
        reviewNote: reason,
        batchMode: false,
        reviewMode: "AUTHORIZED_IMMEDIATE_RETIRE",
      });
      assert.equal(first.replay, false);
      assert.equal(first.request.status, "APPROVED");

      const retiredSense = await tx.wordSense.findUnique({ where: { id: sense.id }, select: { status: true, approvedRevisionId: true, wordProjection: { select: { id: true } } } });
      const decidedRequest = await tx.catalogChangeRequest.findUnique({ where: { id: request.id }, select: { status: true, proposerId: true, reviewerId: true, reviewNote: true } });
      const retiredAudit = await tx.catalogAuditEvent.findFirst({ where: { requestId: request.id, action: "RETIRED" }, select: { actorUserId: true, toStatus: true } });
      const history = await tx.catalogHistoryFeedEntry.findUnique({ where: { requestId: request.id }, select: { sourceKind: true } });
      assert.deepEqual(retiredSense, { status: "RETIRED", approvedRevisionId: sense.approvedRevisionId, wordProjection: sense.wordProjection });
      assert.deepEqual(decidedRequest, { status: "APPROVED", proposerId: actor.id, reviewerId: actor.id, reviewNote: reason });
      assert.deepEqual(retiredAudit, { actorUserId: actor.id, toStatus: "RETIRED" });
      assert.deepEqual(history, { sourceKind: "STANDALONE_REQUEST" });

      const reactivateOperationId = randomUUID();
      const reactivateRequest = await tx.catalogChangeRequest.create({
        data: {
          operationId: reactivateOperationId,
          requestFingerprint: `reactivate-validation-check:${reactivateOperationId}`,
          kind: "REACTIVATE",
          catalogKey: sense.catalogEntry.catalogKey,
          senseKey: sense.senseKey,
          senseId: sense.id,
          proposerId: unauthorizedTeacher.id,
          baseRevision: sense.approvedRevision.revision,
          baseStatus: "RETIRED",
          payload: {},
          reason: "本機重新啟用現行規則回歸檢查",
        },
        select: { id: true, revision: true },
      });

      await tx.wordSenseRevision.update({
        where: { id: sense.approvedRevisionId },
        data: { category: "__invalid_reactivation_category__" },
      });
      await assert.rejects(
        () => reviewCatalogChange(tx, {
          requestId: reactivateRequest.id,
          reviewerId: actor.id,
          expectedRevision: reactivateRequest.revision,
          decision: "APPROVE",
          reviewNote: "invalid taxonomy must block reactivation",
          batchMode: false,
        }),
        /CATALOG_PAYLOAD_REJECTED/,
      );
      await tx.wordSenseRevision.update({
        where: { id: sense.approvedRevisionId },
        data: { category: sense.approvedRevision.category, enableEnToZh: false, enableZhToEn: false },
      });
      await assert.rejects(
        () => reviewCatalogChange(tx, {
          requestId: reactivateRequest.id,
          reviewerId: actor.id,
          expectedRevision: reactivateRequest.revision,
          decision: "APPROVE",
          reviewNote: "disabled directions must block reactivation",
          batchMode: false,
        }),
        /CATALOG_NO_ENABLED_DIRECTION/,
      );
      await tx.wordSenseRevision.update({
        where: { id: sense.approvedRevisionId },
        data: {
          enableEnToZh: sense.approvedRevision.enableEnToZh,
          enableZhToEn: sense.approvedRevision.enableZhToEn,
        },
      });

      const duplicateCandidate = await tx.wordSense.findFirst({
        where: {
          id: { not: sense.id },
          status: "ACTIVE",
          approvedRevisionId: { not: null },
        },
        orderBy: { id: "asc" },
        select: {
          id: true,
          normalizedTerm: true,
          approvedRevisionId: true,
          approvedRevision: {
            select: {
              term: true,
              lemma: true,
              definitionZh: true,
              acceptedAnswersZh: true,
              acceptedFormsEn: true,
              synonymsEn: true,
              antonymsEn: true,
              pos: true,
            },
          },
        },
      });
      if (!duplicateCandidate?.approvedRevisionId || !duplicateCandidate.approvedRevision) {
        throw new Error("No duplicate candidate exists for REACTIVATE validation.");
      }
      await tx.wordSense.update({
        where: { id: duplicateCandidate.id },
        data: { normalizedTerm: sense.normalizedTerm },
      });
      await tx.wordSenseRevision.update({
        where: { id: duplicateCandidate.approvedRevisionId },
        data: {
          term: sense.approvedRevision.term,
          lemma: sense.approvedRevision.lemma,
          definitionZh: sense.approvedRevision.definitionZh,
          acceptedAnswersZh: sense.approvedRevision.acceptedAnswersZh,
          acceptedFormsEn: sense.approvedRevision.acceptedFormsEn,
          synonymsEn: sense.approvedRevision.synonymsEn,
          antonymsEn: sense.approvedRevision.antonymsEn,
          pos: sense.approvedRevision.pos,
        },
      });
      await assert.rejects(
        () => reviewCatalogChange(tx, {
          requestId: reactivateRequest.id,
          reviewerId: actor.id,
          expectedRevision: reactivateRequest.revision,
          decision: "APPROVE",
          reviewNote: "duplicate sense must block reactivation",
          batchMode: false,
        }),
        /CATALOG_ALREADY_EXISTS/,
      );
      await tx.wordSense.update({
        where: { id: duplicateCandidate.id },
        data: { normalizedTerm: duplicateCandidate.normalizedTerm },
      });
      await tx.wordSenseRevision.update({
        where: { id: duplicateCandidate.approvedRevisionId },
        data: duplicateCandidate.approvedRevision,
      });

      const reactivated = await reviewCatalogChange(tx, {
        requestId: reactivateRequest.id,
        reviewerId: actor.id,
        expectedRevision: reactivateRequest.revision,
        decision: "APPROVE",
        reviewNote: "current reactivation checks passed",
        batchMode: false,
      });
      assert.equal(reactivated.request.status, "APPROVED");
      assert.equal((await tx.wordSense.findUniqueOrThrow({ where: { id: sense.id }, select: { status: true } })).status, "ACTIVE");

      const replay = await reviewCatalogChange(tx, {
        requestId: request.id,
        reviewerId: actor.id,
        expectedRevision: request.revision,
        decision: "REJECT",
        reviewNote: "late competing decision",
        batchMode: false,
      });
      assert.equal(replay.replay, true);
      assert.equal(replay.request.status, "APPROVED");
      verified = true;
      throw new Error(ROLLBACK);
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== ROLLBACK) throw error;
  }

  assert.equal(verified, true);
  const rolledBackRequest = await prisma.catalogChangeRequest.findUnique({ where: { id: rollbackRequestId }, select: { id: true } });
  const rolledBackAuditCount = await prisma.catalogAuditEvent.count({ where: { requestId: rollbackRequestId } });
  const rolledBackHistory = await prisma.catalogHistoryFeedEntry.findUnique({ where: { requestId: rollbackRequestId }, select: { id: true } });
  const restoredSense = await prisma.wordSense.findUniqueOrThrow({ where: { id: rollbackSenseId }, select: { status: true, approvedRevisionId: true, wordProjection: { select: { id: true } } } });
  const restoredMutationState = await prisma.catalogMutationState.findUniqueOrThrow({ where: { id: 1 }, select: { revision: true } });
  assert.equal(rolledBackRequest, null);
  assert.equal(rolledBackAuditCount, 0);
  assert.equal(rolledBackHistory, null);
  assert.deepEqual(restoredSense, { status: "ACTIVE", approvedRevisionId: rollbackApprovedRevisionId, wordProjection: { id: rollbackProjectionId } });
  assert.equal(restoredMutationState.revision, rollbackMutationRevision);

  const fixtureSuffix = randomUUID().replaceAll("-", "");
  const createTeacherFixture = async (label: string, canManageWordCatalog: boolean) => {
    const accountName = `catalog-check-${label}-${fixtureSuffix}`;
    const user = await prisma.user.create({
      data: {
        accountName,
        accountNameCanonical: accountName,
        passwordHash: "catalog-check-not-a-login-credential",
        legacyName: `Catalog check ${label}`,
        role: "TEACHER",
        mustChangePassword: false,
        teacherProfile: { create: { legalName: `Catalog check ${label}`, canManageWordCatalog } },
      },
      select: { id: true },
    });
    temporaryUserIds.push(user.id);
    return user;
  };
  const raceReviewers = [
    await createTeacherFixture("reviewer-a", true),
    await createTeacherFixture("reviewer-b", true),
  ];
  const raceProposer = await createTeacherFixture("proposer", false);
  const raceSense = await prisma.wordSense.findFirst({
    where: { status: "ACTIVE", approvedRevisionId: { not: null }, changeRequests: { none: { status: "PENDING" } } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      senseKey: true,
      status: true,
      approvedRevisionId: true,
      approvedRevision: { select: { revision: true } },
      catalogEntry: { select: { catalogKey: true } },
      wordProjection: { select: { id: true } },
    },
  });
  if (!raceSense?.approvedRevision || !raceSense.approvedRevisionId || !raceSense.wordProjection) {
    throw new Error("Two independent reviewers and a concurrent decision fixture are required.");
  }
  const [ordinaryReviewer, immediateReviewer] = raceReviewers;
  const raceMutationRevision = await prisma.catalogMutationState.findUniqueOrThrow({ where: { id: 1 }, select: { revision: true } });
  const raceOperationId = randomUUID();
  const raceRequest = await prisma.catalogChangeRequest.create({
    data: {
      operationId: raceOperationId,
      requestFingerprint: `terminal-race-check:${raceOperationId}`,
      kind: "RETIRE",
      catalogKey: raceSense.catalogEntry.catalogKey,
      senseKey: raceSense.senseKey,
      senseId: raceSense.id,
      proposerId: raceProposer.id,
      baseRevision: raceSense.approvedRevision.revision,
      baseStatus: raceSense.status,
      payload: {},
      reason: "本機終局決定競態檢查",
    },
    select: { id: true, revision: true },
  });
  const immediateOperationId = randomUUID();
  const ordinaryClient = createClient();
  const immediateClient = createClient();
  try {
    const ordinaryDecision = runWithTransactionRetry(() => ordinaryClient.$transaction(async (tx) => {
      await requireCatalogReviewerInTransaction(tx, ordinaryReviewer.id);
      return reviewCatalogChange(tx, {
        requestId: raceRequest.id,
        reviewerId: ordinaryReviewer.id,
        expectedRevision: raceRequest.revision,
        decision: "APPROVE",
        reviewNote: "concurrent ordinary reviewer",
        batchMode: false,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 }));

    const immediateDecision = runWithTransactionRetry(() => immediateClient.$transaction(async (tx) => {
      await requireCatalogReviewerInTransaction(tx, immediateReviewer.id);
      await ensureCatalogMutationStateLocked(tx);
      const currentSense = await tx.wordSense.findUniqueOrThrow({
        where: { id: raceSense.id },
        select: {
          id: true,
          status: true,
          approvedRevisionId: true,
          approvedRevision: { select: { revision: true } },
          changeRequests: {
            where: { status: "PENDING", kind: "RETIRE", submissionProposalGroupId: null },
            select: { id: true },
          },
        },
      });
      if (currentSense.status === "RETIRED") return { outcome: "ALREADY_RETIRED" as const, requestId: null };
      if (currentSense.status !== "ACTIVE" || !currentSense.approvedRevisionId || !currentSense.approvedRevision) {
        throw new Error("CATALOG_NOT_ACTIVE");
      }
      await cancelSupersededStandaloneRetireRequests(tx, {
        requestIds: currentSense.changeRequests.map((request) => request.id),
        reviewerId: immediateReviewer.id,
        senseId: currentSense.id,
        baseRevision: currentSense.approvedRevision.revision,
      });
      const created = await tx.catalogChangeRequest.create({
        data: {
          operationId: immediateOperationId,
          requestFingerprint: `immediate-retire-race-check:${immediateOperationId}`,
          kind: "RETIRE",
          catalogKey: raceSense.catalogEntry.catalogKey,
          senseKey: raceSense.senseKey,
          senseId: raceSense.id,
          proposerId: immediateReviewer.id,
          baseRevision: currentSense.approvedRevision.revision,
          baseStatus: currentSense.status,
          payload: {},
          reason: "本機即時停用與普通審核交叉競態檢查",
        },
        select: { id: true, revision: true },
      });
      await tx.catalogAuditEvent.create({
        data: {
          requestId: created.id,
          actorUserId: immediateReviewer.id,
          senseId: raceSense.id,
          action: "SUBMITTED",
          fromStatus: "ACTIVE",
          toStatus: "PENDING",
          revision: currentSense.approvedRevision.revision,
        },
      });
      const reviewed = await reviewCatalogChange(tx, {
        requestId: created.id,
        reviewerId: immediateReviewer.id,
        expectedRevision: created.revision,
        decision: "APPROVE",
        reviewNote: "本機即時停用與普通審核交叉競態檢查",
        batchMode: false,
        reviewMode: "AUTHORIZED_IMMEDIATE_RETIRE",
      });
      return { outcome: reviewed.request.status, requestId: created.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 }));

    const [ordinaryOutcome, immediateOutcome] = await Promise.all([ordinaryDecision, immediateDecision]);
    assert.equal(ordinaryOutcome.request.status === "APPROVED" || ordinaryOutcome.request.status === "CANCELLED", true);
    assert.equal(immediateOutcome.outcome === "APPROVED" || immediateOutcome.outcome === "ALREADY_RETIRED", true);
    const directRequest = await prisma.catalogChangeRequest.findUnique({
      where: { proposerId_operationId: { proposerId: immediateReviewer.id, operationId: immediateOperationId } },
      select: { id: true, status: true },
    });
    const terminalSense = await prisma.wordSense.findUniqueOrThrow({ where: { id: raceSense.id }, select: { status: true } });
    const raceRequestIds = [raceRequest.id, directRequest?.id].filter((id): id is string => Boolean(id));
    const retiredAuditCount = await prisma.catalogAuditEvent.count({ where: { requestId: { in: raceRequestIds }, action: "RETIRED" } });
    const duplicateTerminalAudit = await prisma.catalogAuditEvent.groupBy({
      by: ["requestId", "action"],
      where: { requestId: { in: raceRequestIds }, action: { in: ["APPROVED", "REJECTED", "RETIRED", "CANCELLED"] } },
      _count: { _all: true },
      having: { requestId: { _count: { gt: 1 } } },
    });
    assert.equal(terminalSense.status, "RETIRED");
    assert.equal(retiredAuditCount, 1);
    assert.equal(duplicateTerminalAudit.length, 0);
    assert.equal(
      (ordinaryOutcome.request.status === "APPROVED" && immediateOutcome.outcome === "ALREADY_RETIRED" && directRequest === null)
      || (ordinaryOutcome.request.status === "CANCELLED" && immediateOutcome.outcome === "APPROVED" && directRequest?.status === "APPROVED"),
      true,
    );
  } finally {
    await Promise.all([ordinaryClient.$disconnect(), immediateClient.$disconnect()]);
    const directRequest = await prisma.catalogChangeRequest.findUnique({
      where: { proposerId_operationId: { proposerId: immediateReviewer.id, operationId: immediateOperationId } },
      select: { id: true },
    });
    const cleanupRequestIds = [raceRequest.id, directRequest?.id].filter((id): id is string => Boolean(id));
    await prisma.$transaction(async (tx) => {
      await tx.catalogHistoryFeedEntry.deleteMany({ where: { requestId: { in: cleanupRequestIds } } });
      await tx.catalogAuditEvent.deleteMany({ where: { requestId: { in: cleanupRequestIds } } });
      await tx.catalogChangeRequest.deleteMany({ where: { id: { in: cleanupRequestIds } } });
      await tx.wordSense.update({ where: { id: raceSense.id }, data: { status: "ACTIVE" } });
    });
  }
  assert.equal(await prisma.catalogChangeRequest.count({ where: { id: raceRequest.id } }), 0);
  assert.equal(await prisma.catalogAuditEvent.count({ where: { requestId: raceRequest.id } }), 0);
  assert.equal(await prisma.catalogHistoryFeedEntry.count({ where: { requestId: raceRequest.id } }), 0);
  assert.deepEqual(
    await prisma.wordSense.findUniqueOrThrow({ where: { id: raceSense.id }, select: { status: true, approvedRevisionId: true, wordProjection: { select: { id: true } } } }),
    { status: "ACTIVE", approvedRevisionId: raceSense.approvedRevisionId, wordProjection: raceSense.wordProjection },
  );
  assert.ok((await prisma.catalogMutationState.findUniqueOrThrow({ where: { id: 1 }, select: { revision: true } })).revision >= raceMutationRevision.revision + 1);

  const oppositeOperationId = randomUUID();
  const oppositeRequest = await prisma.catalogChangeRequest.create({
    data: {
      operationId: oppositeOperationId,
      requestFingerprint: `opposite-terminal-race-check:${oppositeOperationId}`,
      kind: "RETIRE",
      catalogKey: raceSense.catalogEntry.catalogKey,
      senseKey: raceSense.senseKey,
      senseId: raceSense.id,
      proposerId: raceProposer.id,
      baseRevision: raceSense.approvedRevision.revision,
      baseStatus: "ACTIVE",
      payload: {},
      reason: "本機相反終局決定競態檢查",
    },
    select: { id: true, revision: true },
  });
  const approveClient = createClient();
  const rejectClient = createClient();
  try {
    const approve = runWithTransactionRetry(() => approveClient.$transaction(async (tx) => {
      await requireCatalogReviewerInTransaction(tx, ordinaryReviewer.id);
      return reviewCatalogChange(tx, {
        requestId: oppositeRequest.id,
        reviewerId: ordinaryReviewer.id,
        expectedRevision: oppositeRequest.revision,
        decision: "APPROVE",
        reviewNote: "independent reviewer A approval",
        batchMode: false,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 }));
    const reject = runWithTransactionRetry(() => rejectClient.$transaction(async (tx) => {
      await requireCatalogReviewerInTransaction(tx, immediateReviewer.id);
      return reviewCatalogChange(tx, {
        requestId: oppositeRequest.id,
        reviewerId: immediateReviewer.id,
        expectedRevision: oppositeRequest.revision,
        decision: "REJECT",
        reviewNote: "independent reviewer B rejection",
        batchMode: false,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 }));
    const outcomes = await Promise.all([approve, reject]);
    assert.equal(outcomes[0].request.status, outcomes[1].request.status);
    assert.equal(outcomes.filter((outcome) => outcome.replay).length, 1);
    assert.equal(outcomes.filter((outcome) => !outcome.replay).length, 1);
    assert.equal(["APPROVED", "REJECTED"].includes(outcomes[0].request.status), true);
    const terminalAuditCount = await prisma.catalogAuditEvent.count({
      where: { requestId: oppositeRequest.id, action: { in: ["RETIRED", "REJECTED"] } },
    });
    const finalSense = await prisma.wordSense.findUniqueOrThrow({ where: { id: raceSense.id }, select: { status: true } });
    assert.equal(terminalAuditCount, 1);
    assert.equal(finalSense.status, outcomes[0].request.status === "APPROVED" ? "RETIRED" : "ACTIVE");
  } finally {
    await Promise.all([approveClient.$disconnect(), rejectClient.$disconnect()]);
    await prisma.$transaction(async (tx) => {
      await tx.catalogHistoryFeedEntry.deleteMany({ where: { requestId: oppositeRequest.id } });
      await tx.catalogAuditEvent.deleteMany({ where: { requestId: oppositeRequest.id } });
      await tx.catalogChangeRequest.deleteMany({ where: { id: oppositeRequest.id } });
      await tx.wordSense.update({ where: { id: raceSense.id }, data: { status: "ACTIVE" } });
    });
  }
  assert.equal(await prisma.catalogChangeRequest.count({ where: { id: oppositeRequest.id } }), 0);
  assert.equal(await prisma.catalogAuditEvent.count({ where: { requestId: oppositeRequest.id } }), 0);
  assert.equal(await prisma.catalogHistoryFeedEntry.count({ where: { requestId: oppositeRequest.id } }), 0);

  console.log(JSON.stringify({ ready: true, rollback: true, checks: [
    "ordinary teachers are denied immediate-retire review authority",
    "reviewer authority rechecked inside transaction",
    "authorized immediate RETIRE reaches APPROVED and RETIRED atomically",
    "approved revision, projection, history and audit are preserved",
    "REACTIVATE re-runs current taxonomy, enabled-direction and duplicate-sense checks before restoring ACTIVE",
    "a later competing decision replays the first terminal result",
    "rollback is re-read outside the transaction with zero request, audit or history residue",
    "two independent reviewers race ordinary approval against immediate retirement without deadlock or duplicate retirement audit",
    "two independent reviewers race APPROVE against REJECT and replay the first terminal decision",
  ] }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "catalog immediate retire check failed");
  process.exitCode = 1;
}).finally(async () => {
  if (temporaryUserIds.length) await prisma.user.deleteMany({ where: { id: { in: temporaryUserIds } } });
  await prisma.$disconnect();
});
