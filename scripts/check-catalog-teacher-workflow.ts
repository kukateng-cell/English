import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma";
import { payloadFingerprint, payloadFromRevision } from "../src/lib/catalog/governance";

dotenv.config({ path: ".env.local", override: true });
if (!process.env.MIGRATE_URL) throw new Error("MIGRATE_URL is required.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATE_URL }) });
const ROLLBACK = "CATALOG_TEACHER_WORKFLOW_CHECK_ROLLBACK";

async function main() {
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
  console.log(JSON.stringify({ ready: true, checks: ["feedback-non-executable", "feedback-cas", "request-supersession", "unique-retry-lineage"] }, null, 2));
}

main().finally(async () => prisma.$disconnect());
