import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

/**
 * Disposable local-only lifecycle probe.  It exercises the database fallback
 * rather than an HTTP route so a raw User delete cannot strand staged PII.
 */
async function main() {
  const { prisma, Prisma } = await import("../src/lib/prisma");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const subjectAccount = `lifecycle-subject-${suffix}`;
  const actorAccount = `lifecycle-actor-${suffix}`;
  const ids = { subject: "", actor: "", importBatch: "", mutationBatch: "" };
  try {
    const [subject, actor] = await prisma.$transaction(async (tx) => {
      const createdSubject = await tx.user.create({
        data: {
          accountName: subjectAccount,
          accountNameCanonical: subjectAccount,
          passwordHash: "not-a-login-account",
          credentialRevision: 1,
          mustChangePassword: true,
          studentProfile: {
            create: {
              legalName: "Lifecycle Subject",
              nickname: "Lifecycle Nickname",
              nicknameNormalized: "lifecycle nickname",
            },
          },
        },
        select: { id: true },
      });
      const createdActor = await tx.user.create({
        data: {
          accountName: actorAccount,
          accountNameCanonical: actorAccount,
          passwordHash: "not-a-login-account",
          credentialRevision: 1,
          mustChangePassword: false,
          role: "TEACHER",
          teacherProfile: { create: { legalName: "Lifecycle Actor" } },
        },
        select: { id: true },
      });
      return [createdSubject, createdActor] as const;
    });
    ids.subject = subject.id;
    ids.actor = actor.id;

    const importBatch = await prisma.rosterImportBatch.create({
      data: {
        actorUserId: actor.id,
        entityType: "STUDENT",
        format: "CSV",
        fileHash: `file-${suffix}`,
        operationId: `import-${suffix}`,
        mode: "CREATE_ONLY",
        fingerprint: `fingerprint-${suffix}`,
        canonicalDigest: `digest-${suffix}`,
        status: "PREVIEWED",
        rowCount: 1,
        stagedRows: [{ accountName: subjectAccount, legalName: "Lifecycle Subject" }],
        errorReport: [{ code: "EXAMPLE", row: 2 }],
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
      select: { id: true },
    });
    ids.importBatch = importBatch.id;
    await prisma.rosterImportBatchUserLink.create({
      data: { batchId: importBatch.id, userId: subject.id, linkRole: "TARGET" },
    });

    const mutationBatch = await prisma.adminMutationBatch.create({
      data: {
        actorUserId: actor.id,
        operationKind: "BULK_CLASS",
        operationId: `mutation-${suffix}`,
        status: "PREVIEWED",
        canonicalDigest: `mutation-digest-${suffix}`,
        payload: { studentId: subject.id, legalName: "Lifecycle Subject" },
        errorReport: [{ code: "EXAMPLE", targetUserId: subject.id }],
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
      select: { id: true },
    });
    ids.mutationBatch = mutationBatch.id;
    await prisma.adminMutationBatchUserLink.create({
      data: { batchId: mutationBatch.id, userId: subject.id, linkRole: "TARGET" },
    });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.roster_hard_delete', 'on', true)`;
      await tx.user.delete({ where: { id: subject.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    assert.equal(await prisma.user.count({ where: { id: subject.id } }), 0);
    const cancelledImport = await prisma.rosterImportBatch.findUniqueOrThrow({ where: { id: importBatch.id } });
    assert.equal(cancelledImport.status, "CANCELLED");
    assert.equal(cancelledImport.stagedRows, null);
    assert.equal(cancelledImport.errorReport, null);
    const cancelledMutation = await prisma.adminMutationBatch.findUniqueOrThrow({ where: { id: mutationBatch.id } });
    assert.equal(cancelledMutation.status, "CANCELLED");
    assert.equal(cancelledMutation.payload, null);
    assert.equal(cancelledMutation.errorReport, null);
    console.log("Roster hard-delete staging purge check passed");
  } finally {
    if (ids.subject) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.roster_hard_delete', 'on', true)`;
        await tx.user.deleteMany({ where: { id: ids.subject } });
      }).catch(() => undefined);
    }
    if (ids.actor) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.roster_hard_delete', 'on', true)`;
        await tx.user.deleteMany({ where: { id: ids.actor } });
      }).catch(() => undefined);
    }
    await prisma.rosterImportBatch.deleteMany({ where: { id: ids.importBatch } }).catch(() => undefined);
    await prisma.adminMutationBatch.deleteMany({ where: { id: ids.mutationBatch } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "roster-lifecycle-check-failed");
  process.exitCode = 1;
});
