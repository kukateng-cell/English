import { Prisma, prisma } from "@/lib/prisma";
import { aggregateUnitStatRows } from "@/lib/units";
import { catalogRuntimeEnvironment } from "@/lib/catalog/runtime";

type UnitProgressDatabase = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function fetchUnitProgress(
  userId: string,
  db: UnitProgressDatabase = prisma,
) {
  const environment = catalogRuntimeEnvironment();
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
    WHERE word."senseId" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "CatalogRevision" AS revision
        WHERE revision."id" = word."catalogRevisionId"
          AND revision."status" = 'READY'
      )
      AND EXISTS (
        SELECT 1 FROM "WordSense" AS sense
        WHERE sense."id" = word."senseId"
          AND (
            (sense."status" = 'ACTIVE' AND sense."approvedRevisionId" IS NOT NULL)
            OR (
              ${environment} <> 'production'
              AND sense."status" = 'DRAFT'
              AND EXISTS (
                SELECT 1 FROM "CatalogEligibility" AS eligibility
                JOIN "CatalogRevision" AS eligibility_revision
                  ON eligibility_revision."id" = eligibility."catalogRevisionId"
                WHERE eligibility."senseId" = sense."id"
                  AND eligibility."environment" = ${environment}
                  AND eligibility."basis" = 'LOCAL_DEMO_BOOTSTRAP'
                  AND eligibility_revision."status" = 'READY'
              )
            )
          )
      )
    GROUP BY word."level", word."category"
  `);
  return aggregateUnitStatRows(rows);
}
