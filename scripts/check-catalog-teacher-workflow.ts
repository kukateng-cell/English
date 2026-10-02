import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma";
import { payloadFingerprint, payloadFromRevision } from "../src/lib/catalog/governance";

dotenv.config({ path: ".env.local", override: true });
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const environment = process.env.DATABASE_ENVIRONMENT;
if (!environment || environment === "production" || process.env.CONFIRM_DATABASE_ENVIRONMENT !== environment) {
  throw new Error("check:catalog-teacher-workflow requires matching non-production DATABASE_ENVIRONMENT and CONFIRM_DATABASE_ENVIRONMENT");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const ROLLBACK = "CATALOG_TEACHER_WORKFLOW_CHECK_ROLLBACK";

async function expectDatabaseGuard(
  tx: Prisma.TransactionClient,
  label: string,
  run: () => Promise<unknown>,
): Promise<void> {
  await tx.$executeRawUnsafe(`SAVEPOINT ${label}`);
  let rejected = false;
  try {
    await run();
  } catch {
    rejected = true;
  } finally {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${label}`);
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${label}`);
  }
  if (!rejected) throw new Error(`${label} database guard did not reject the mutation.`);
}

async function main() {
  const metadata = await prisma.databaseMetadata.findUnique({ where: { key: "environment" }, select: { value: true } });
  if (metadata?.value !== environment) throw new Error("DatabaseMetadata.environment mismatch");
  let verified = false;
  try {
    await prisma.$transaction(async (tx) => {
      const actors = await tx.user.findMany({
        where: { status: "ACTIVE", role: { in: ["TEACHER", "ADMIN"] } },
        orderBy: [{ role: "asc" }, { id: "asc" }],
        take: 4,
        select: { id: true },
      });
      const reporter = actors[0];
      const resolver = actors.find((actor) => actor.id !== reporter?.id);
      if (!reporter || !resolver) throw new Error("Two active teacher/admin actors are required.");

      const sense = await tx.wordSense.findFirst({
        where: { status: "ACTIVE", approvedRevisionId: { not: null } },
        orderBy: { id: "asc" },
        include: { catalogEntry: { select: { catalogKey: true } }, approvedRevision: true },
      });
      if (!sense?.approvedRevision) throw new Error("An ACTIVE governed sense is required.");
      const payload = payloadFromRevision(sense.approvedRevision);
      const targetSuffix = randomUUID().replaceAll("-", "");
      const alternateEntry = await tx.catalogEntry.create({
        data: {
          catalogKey: `feedback_guard_${targetSuffix}`,
          lemma: "feedbackguard",
          normalizedLemma: "feedbackguard",
        },
      });
      const alternateSense = await tx.wordSense.create({
        data: {
          catalogEntryId: alternateEntry.id,
          senseKey: `feedback_guard_sense_${targetSuffix}`,
          term: "feedbackguard",
          normalizedTerm: "feedbackguard",
          pos: "noun",
          level: "A1",
          category: "other",
          status: "DRAFT",
        },
      });
      const beforeMutation = await tx.catalogMutationState.findUnique({ where: { id: 1 }, select: { revision: true } });
      const beforeSense = { status: sense.status, approvedRevisionId: sense.approvedRevisionId };

      const feedback = await tx.catalogFeedback.create({
        data: {
          operationId: randomUUID(),
          requestFingerprint: payloadFingerprint({ kind: "DISTRACTOR", senseKey: sense.senseKey, message: "integration check" }),
          reporterId: reporter.id,
          senseId: sense.id,
          senseKey: sense.senseKey,
          termSnapshot: sense.term,
          baseRevision: sense.approvedRevision.revision,
          kind: "DISTRACTOR",
          message: "整合檢查：干擾項需要改善",
        },
      });
      const resolved = await tx.catalogFeedback.updateMany({
        where: { id: feedback.id, status: "OPEN", revision: 0 },
        data: { status: "RESOLVED", resolutionNote: "整合檢查完成", resolverId: resolver.id, resolvedAt: new Date(), revision: { increment: 1 } },
      });
      if (resolved.count !== 1) throw new Error("Feedback CAS transition failed.");

      const original = await tx.catalogChangeRequest.create({
        data: {
          operationId: randomUUID(),
          requestFingerprint: payloadFingerprint({ kind: "UPDATE", payload, source: "teacher-workflow-check" }),
          kind: "UPDATE",
          status: "REJECTED",
          catalogKey: sense.catalogEntry.catalogKey,
          senseKey: sense.senseKey,
          senseId: sense.id,
          proposerId: reporter.id,
          reviewerId: resolver.id,
          baseRevision: sense.approvedRevision.revision,
          baseStatus: sense.status,
          payload: payload as unknown as Prisma.InputJsonValue,
          beforePayloadSnapshot: payload as unknown as Prisma.InputJsonValue,
          afterPayloadSnapshot: payload as unknown as Prisma.InputJsonValue,
          reviewNote: "請修正後重新提交",
          reviewedAt: new Date(),
        },
      });
      const successor = await tx.catalogChangeRequest.create({
        data: {
          operationId: randomUUID(),
          requestFingerprint: payloadFingerprint({ kind: "UPDATE", payload, source: "teacher-workflow-check-retry" }),
          kind: "UPDATE",
          status: "PENDING",
          catalogKey: sense.catalogEntry.catalogKey,
          senseKey: sense.senseKey,
          senseId: sense.id,
          proposerId: reporter.id,
          baseRevision: sense.approvedRevision.revision,
          baseStatus: sense.status,
          supersedesRequestId: original.id,
          payload: payload as unknown as Prisma.InputJsonValue,
          beforePayloadSnapshot: payload as unknown as Prisma.InputJsonValue,
          afterPayloadSnapshot: payload as unknown as Prisma.InputJsonValue,
        },
      });
      const lineage = await tx.catalogChangeRequest.findUnique({
        where: { id: original.id },
        select: { status: true, supersededBy: { select: { id: true } } },
      });
      if (lineage?.status !== "REJECTED" || lineage.supersededBy?.id !== successor.id) {
        throw new Error("Immutable request supersession lineage failed.");
      }
      await expectDatabaseGuard(tx, "guard_request_lineage", () => tx.catalogChangeRequest.update({
        where: { id: successor.id },
        data: { supersedesRequestId: null },
      }));
      await expectDatabaseGuard(tx, "guard_feedback_reopen", () => tx.catalogFeedback.update({
        where: { id: feedback.id },
        data: { status: "OPEN", resolverId: null, resolutionNote: null, resolvedAt: null, revision: { increment: 1 } },
      }));
      await expectDatabaseGuard(tx, "guard_feedback_message", () => tx.catalogFeedback.update({
        where: { id: feedback.id },
        data: { message: "不應容許修改已結案內容" },
      }));
      await expectDatabaseGuard(tx, "guard_feedback_terminal_sense", () => tx.catalogFeedback.update({
        where: { id: feedback.id },
        data: { senseId: alternateSense.id },
      }));

      const secondFeedback = await tx.catalogFeedback.create({
        data: {
          operationId: randomUUID(),
          requestFingerprint: payloadFingerprint({ kind: "EXAMPLE", senseKey: sense.senseKey, message: "open guard" }),
          reporterId: reporter.id,
          senseId: sense.id,
          senseKey: sense.senseKey,
          termSnapshot: sense.term,
          baseRevision: sense.approvedRevision.revision,
          kind: "EXAMPLE",
          message: "整合檢查：未處理意見",
        },
      });
      await expectDatabaseGuard(tx, "guard_feedback_open_resolver", () => tx.catalogFeedback.update({
        where: { id: secondFeedback.id },
        data: { resolverId: resolver.id },
      }));
      await expectDatabaseGuard(tx, "guard_feedback_resolve_and_retarget", () => tx.catalogFeedback.update({
        where: { id: secondFeedback.id },
        data: {
          senseId: alternateSense.id,
          status: "RESOLVED",
          resolverId: resolver.id,
          resolutionNote: "不應容許重綁目標",
          resolvedAt: new Date(),
          revision: { increment: 1 },
        },
      }));

      await tx.catalogFeedback.create({
        data: {
          operationId: randomUUID(),
          requestFingerprint: payloadFingerprint({ kind: "OTHER", senseKey: alternateSense.senseKey, message: "restrict guard" }),
          reporterId: reporter.id,
          senseId: alternateSense.id,
          senseKey: alternateSense.senseKey,
          termSnapshot: alternateSense.term,
          kind: "OTHER",
          message: "整合檢查：引用詞義不可刪除",
        },
      });
      await expectDatabaseGuard(tx, "guard_feedback_sense_delete", () => tx.wordSense.delete({
        where: { id: alternateSense.id },
      }));

      const readyRevision = await tx.catalogRevision.findFirst({
        where: { status: "READY" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      if (!readyRevision) throw new Error("A READY catalog revision is required.");
      const expiresAt = new Date(Date.now() + 86_400_000);
      const sourceBatch = await tx.catalogSubmissionBatch.create({
        data: {
          proposerId: reporter.id,
          operationId: randomUUID(),
          fileName: "guard-source.csv",
          fileHash: payloadFingerprint({ source: "guard-source" }),
          requestDigest: payloadFingerprint({ request: "guard-source" }),
          schemaVersion: "word-catalog-v1",
          validatorVersion: "catalog-validator-v1",
          normalizationVersion: "catalog-normalization-v1",
          taxonomyDigest: payloadFingerprint({ taxonomy: "guard" }),
          readyCatalogRevisionId: readyRevision.id,
          baseMutationRevision: beforeMutation?.revision ?? 0,
          status: "PREVIEW",
          rowCount: 0,
          summary: {},
          expiresAt,
          absoluteExpiresAt: expiresAt,
        },
      });
      const retryBatch = await tx.catalogSubmissionBatch.create({
        data: {
          proposerId: reporter.id,
          operationId: randomUUID(),
          fileName: "guard-retry.csv",
          fileHash: payloadFingerprint({ source: "guard-retry" }),
          requestDigest: payloadFingerprint({ request: "guard-retry" }),
          schemaVersion: "word-catalog-v1",
          validatorVersion: "catalog-validator-v1",
          normalizationVersion: "catalog-normalization-v1",
          taxonomyDigest: payloadFingerprint({ taxonomy: "guard" }),
          readyCatalogRevisionId: readyRevision.id,
          baseMutationRevision: beforeMutation?.revision ?? 0,
          status: "PREVIEW",
          rowCount: 0,
          summary: {},
          expiresAt,
          absoluteExpiresAt: expiresAt,
          retryOfBatchId: sourceBatch.id,
        },
      });
      await expectDatabaseGuard(tx, "guard_batch_retry_lineage", () => tx.catalogSubmissionBatch.update({
        where: { id: retryBatch.id },
        data: { retryOfBatchId: null },
      }));

      const afterSense = await tx.wordSense.findUnique({ where: { id: sense.id }, select: { status: true, approvedRevisionId: true } });
      const afterMutation = await tx.catalogMutationState.findUnique({ where: { id: 1 }, select: { revision: true } });
      const uniqueIndexes = await tx.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname IN (
            'CatalogChangeRequest_supersedesRequestId_key',
            'CatalogSubmissionBatch_retryOfBatchId_key',
            'CatalogFeedback_reporterId_operationId_key'
          )
      `;
      if (afterSense?.status !== beforeSense.status || afterSense.approvedRevisionId !== beforeSense.approvedRevisionId) {
        throw new Error("Feedback unexpectedly changed current catalog content.");
      }
      if (afterMutation?.revision !== beforeMutation?.revision) throw new Error("Feedback unexpectedly bumped catalog mutation state.");
      if (uniqueIndexes.length !== 3) throw new Error("Retry/idempotency unique indexes are incomplete.");
      verified = true;
      throw new Error(ROLLBACK);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== ROLLBACK || !verified) throw error;
  }
  console.log(JSON.stringify({ ready: true, checks: ["feedback-non-executable", "feedback-cas", "feedback-terminal-guards", "feedback-target-immutable", "feedback-sense-delete-restrict", "request-supersession", "request-lineage-guard", "batch-retry-lineage-guard", "unique-retry-lineage"] }, null, 2));
}

main().finally(async () => prisma.$disconnect());
