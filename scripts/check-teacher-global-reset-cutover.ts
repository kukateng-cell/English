import { createHash } from "node:crypto";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const apply = process.argv.includes("--apply");
const expectedEnvironment = "development";

function assertLocalTarget() {
  if (process.env.DATABASE_ENVIRONMENT !== expectedEnvironment || process.env.CONFIRM_DATABASE_ENVIRONMENT !== expectedEnvironment) {
    throw new Error("拒絕 teacher reset cutover：只容許 DATABASE_ENVIRONMENT=development 並有相同確認值");
  }
  const migrateUrl = process.env.MIGRATE_URL;
  if (!migrateUrl) throw new Error("拒絕 teacher reset cutover：必须显式提供 MIGRATE_URL");
  const url = new URL(migrateUrl);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error("拒絕 teacher reset cutover：MIGRATE_URL 必须指向本机");
  if (apply && process.env.CONFIRM_TEACHER_GLOBAL_RESET_CUTOVER !== expectedEnvironment) {
    throw new Error("拒絕 teacher reset cutover：--apply 必须有 CONFIRM_TEACHER_GLOBAL_RESET_CUTOVER=development");
  }
}

function pseudonym(id: string) {
  const digest = createHash("sha256").update(`teacher-global-reset-cutover:${id}`).digest("hex");
  return `teacher-v1:${digest.slice(0, 16)}`;
}

async function main() {
  assertLocalTarget();
  const { prisma, Prisma } = await import("../src/lib/prisma");
  try {
    const result = await prisma.$transaction(async (tx) => {
      const state = await tx.rosterMutationState.findUnique({ where: { id: 1 }, select: { revision: true } });
      if (!state) throw new Error("ROSTER_MUTATION_STATE_MISSING");
      await tx.$queryRaw`SELECT "id" FROM "RosterMutationState" WHERE "id" = 1 FOR UPDATE`;
      const teachers = await tx.user.findMany({
        where: { role: "TEACHER", teacherProfile: { isNot: null } },
        select: { id: true, teacherProfile: { select: { canResetStudentPassword: true, classAccess: { where: { schoolClass: { academicYear: { status: { in: ["CURRENT", "PLANNED"] } } } }, select: { canResetStudentPassword: true } } } } },
      });
      const rows = teachers.map((teacher) => {
        const global = teacher.teacherProfile?.canResetStudentPassword ?? false;
        const nonClosed = teacher.teacherProfile?.classAccess ?? [];
        const drift = nonClosed.filter((access) => access.canResetStudentPassword !== global).length;
        return { id: teacher.id, global, nonClosed: nonClosed.length, drift };
      });
      const driftRows = rows.reduce((sum, row) => sum + row.drift, 0);
      const legacyTrueRows = rows.reduce((sum, row) => sum + (row.global ? row.nonClosed - row.drift : nonClosedTrue(row)), 0);
      if (apply && driftRows > 0) {
        for (const row of rows) {
          if (!row.drift) continue;
          await tx.teacherClassAccess.updateMany({
            where: { teacherId: row.id, schoolClass: { academicYear: { status: { in: ["CURRENT", "PLANNED"] } } } },
            data: { canResetStudentPassword: row.global },
          });
        }
        await tx.rosterMutationState.update({ where: { id: 1 }, data: { revision: { increment: 1 } } });
      }
      return {
        mode: apply ? "apply" : "dry-run",
        teacherCount: rows.length,
        globalEnabledTeacherCount: rows.filter((row) => row.global).length,
        legacyTrueRows,
        driftRows,
        changed: apply ? driftRows : 0,
        rosterRevision: apply ? state.revision + (driftRows > 0 ? 1 : 0) : state.revision,
        teacherPseudonyms: rows.filter((row) => row.drift > 0).map((row) => pseudonym(row.id)),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    console.log(JSON.stringify(result, null, 2));
    if (!apply) console.log("Dry-run only. Add --apply with the exact development confirmation after reviewing the summary.");
  } finally {
    await prisma.$disconnect();
  }
}

function nonClosedTrue(row: { global: boolean; nonClosed: number; drift: number }) {
  // A global-off teacher's legacy true rows are exactly the drift rows.  For a
  // global-on teacher, all projected rows are true after reconciliation.
  return row.global ? row.nonClosed : row.drift;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "TEACHER_GLOBAL_RESET_CUTOVER_FAILED");
  process.exitCode = 1;
});
