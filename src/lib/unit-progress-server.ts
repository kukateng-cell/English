import { Prisma, prisma } from "@/lib/prisma";
import { currentCatalogWordCtesSql } from "@/lib/catalog/runtime";
import { aggregateUnitStatRows } from "@/lib/units";

type UnitProgressDatabase = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function fetchUnitProgress(
  userId: string,
  db: UnitProgressDatabase = prisma,
  now = new Date(),
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
    WITH ${currentCatalogWordCtesSql()},
    user_reviews AS MATERIALIZED (
      SELECT
        review."wordId",
        review."repetitions",
        review."nextReviewDate"
      FROM "Review" AS review
      WHERE review."userId" = ${userId}
    )
    SELECT
      current_words."level"::text AS "level",
      current_words."category" AS "category",
      COUNT(*)::integer AS "total",
      COUNT(user_reviews."wordId")::integer AS "learned",
      COUNT(user_reviews."wordId") FILTER (
        WHERE user_reviews."repetitions" >= 1
      )::integer AS "mastered",
      COUNT(user_reviews."wordId") FILTER (
        WHERE user_reviews."nextReviewDate" <= ${now}
      )::integer AS "due"
    FROM current_words
    LEFT JOIN user_reviews
      ON user_reviews."wordId" = current_words."id"
    GROUP BY current_words."level", current_words."category"
  `);
  return aggregateUnitStatRows(rows);
}
