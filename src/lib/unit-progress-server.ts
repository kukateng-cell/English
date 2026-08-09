import { Prisma, prisma } from "@/lib/prisma";
import { aggregateUnitStatRows } from "@/lib/units";

type UnitProgressDatabase = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function fetchUnitProgress(
  userId: string,
  db: UnitProgressDatabase = prisma,
) {
  const rows = await db.$queryRaw<
    Array<{
      level: string;
      category: string | null;
      total: number;
      learned: number;
      mastered: number;
      due: number;
    }>
  >(Prisma.sql`
    SELECT
      word."level"::text AS "level",
      word."category" AS "category",
      COUNT(*)::integer AS "total",
      COUNT(review."id")::integer AS "learned",
      COUNT(review."id") FILTER (
        WHERE review."repetitions" >= 1
      )::integer AS "mastered",
      COUNT(review."id") FILTER (
        WHERE review."nextReviewDate" <= CURRENT_TIMESTAMP
      )::integer AS "due"
    FROM "Word" AS word
    LEFT JOIN "Review" AS review
      ON review."wordId" = word."id"
      AND review."userId" = ${userId}
    GROUP BY word."level", word."category"
  `);
  return aggregateUnitStatRows(rows);
}
