import type { Prisma } from "@/lib/prisma";

type DbClient = Prisma.TransactionClient;

export async function lockRosterMutationState(tx: DbClient) {
  const state = await tx.rosterMutationState.findUnique({
    where: { id: 1 },
  });
  if (!state) throw new Error("ROSTER_MUTATION_STATE_MISSING");
  await tx.$queryRaw`SELECT "id" FROM "RosterMutationState" WHERE "id" = 1 FOR UPDATE`;
  return state;
}

/**
 * Serialize canonical account/contact ownership checks without putting raw
 * identity values in logs or durable rows.  Every caller supplies the complete
 * set and this helper sorts/deduplicates it, giving concurrent writers one
 * deterministic advisory-lock order.
 */
export async function lockRosterIdentityKeys(tx: DbClient, keys: readonly (string | null | undefined)[]) {
  const ordered = [...new Set(keys.filter((key): key is string => Boolean(key)).map((key) => key.normalize("NFKC").trim().toLowerCase()))].sort();
  for (const key of ordered) {
    // pg_advisory_xact_lock returns PostgreSQL `void`; cast it so Prisma's
    // driver can deserialize the raw-query result while retaining the lock.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked`;
  }
}

export async function getAcademicYear(
  tx: DbClient,
  academicYearId: string,
) {
  return tx.academicYear.findUnique({ where: { id: academicYearId } });
}

export async function requireAcademicYear(
  tx: DbClient,
  academicYearId: string,
  allowed: Array<"PLANNED" | "CURRENT" | "CLOSED">,
) {
  const year = await getAcademicYear(tx, academicYearId);
  if (!year) throw new Error("ACADEMIC_YEAR_NOT_FOUND");
  if (!allowed.includes(year.status)) throw new Error("ACADEMIC_YEAR_STATE_INVALID");
  return year;
}

export function academicYearDatesForLabel(label: string) {
  const match = /^(\d{4})-(\d{4})$/.exec(label.trim());
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return null;
  const startYear = Number(match[1]);
  return {
    label: `${startYear}-${startYear + 1}`,
    startsOn: new Date(`${startYear}-09-01T00:00:00.000Z`),
    endsOn: new Date(`${startYear + 1}-08-31T00:00:00.000Z`),
  };
}

export function yearLabelForDateRange(startsOn: Date, endsOn: Date): string | null {
  const start = startsOn.getUTCFullYear();
  const end = endsOn.getUTCFullYear();
  return end === start + 1 ? `${start}-${end}` : null;
}
