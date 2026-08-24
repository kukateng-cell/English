import { Prisma, prisma } from "@/lib/prisma";
import type { CatalogWorkspaceFilters } from "@/lib/catalog/workspace-query";
import {
  catalogPendingRequestForActor,
  type CatalogPendingSummary,
} from "@/lib/catalog/pending-visibility";

export interface CatalogWorkspaceListRow {
  id: string;
  senseKey: string | null;
  catalogKey: string | null;
  sourceFile: string | null;
  sourceRow: number;
  term: string;
  lemma: string;
  definitionZh: string;
  partOfSpeech: string;
  level: string;
  category: string;
  phoneticIpa: string | null;
  enableEnToZh: boolean;
  enableZhToEn: boolean;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  revision: number | null;
  latestRevision: number | null;
  approvedRevisionId: string | null;
  primaryDisposition: string;
  eligibilityResult: string | null;
  validationErrors: string[];
  validationWarnings: string[];
  pendingRequest: CatalogPendingSummary | {
    restricted?: false;
    id: string;
    kind: string;
    status: string;
    proposerId: string;
    reviewerId: string | null;
    baseRevision: number | null;
    revision: number;
    reason: string | null;
    reviewNote: string | null;
    createdAt: string;
    reviewedAt: string | null;
  } | null;
  hasSense: boolean;
}

export interface CatalogWorkspacePageResult {
  rows: CatalogWorkspaceListRow[];
  filteredTotal: number;
  counts: Record<string, number>;
}

type RawCatalogWorkspaceResult = {
  allCount: number;
  activeCount: number;
  draftCount: number;
  retiredCount: number;
  blockedCount: number;
  validationFailedCount: number;
  pendingCount: number;
  filteredTotal: number;
  rows: unknown;
};

function filterSql(filters: CatalogWorkspaceFilters): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (filters.status === "ACTIVE" || filters.status === "DRAFT" || filters.status === "RETIRED") {
    conditions.push(Prisma.sql`"status" = ${filters.status}`);
  } else if (filters.status === "BLOCKED") {
    conditions.push(Prisma.sql`"eligibilityResult" = 'DRAFT_BLOCKED'`);
  } else if (filters.status === "VALIDATION_FAILED") {
    conditions.push(Prisma.sql`"primaryDisposition" = 'VALIDATION_FAILED'`);
  } else if (filters.status === "PENDING") {
    conditions.push(Prisma.sql`"pendingRequest" IS NOT NULL`);
  }
  if (filters.level !== "ALL") conditions.push(Prisma.sql`"level" = ${filters.level}`);
  if (filters.direction === "EN_ZH") conditions.push(Prisma.sql`"enableEnToZh" = TRUE`);
  if (filters.direction === "ZH_EN") conditions.push(Prisma.sql`"enableZhToEn" = TRUE`);
  if (filters.q) {
    conditions.push(Prisma.sql`strpos(lower(concat_ws(' ', "term", "lemma", "definitionZh", "senseKey", "catalogKey", "category", "phoneticIpa")), lower(${filters.q})) > 0`);
  }
  return conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) ? value as number : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizePendingRequest(
  value: unknown,
  actorUserId: string,
  canReview: boolean,
): CatalogWorkspaceListRow["pendingRequest"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.kind !== "string" || typeof row.status !== "string" || typeof row.proposerId !== "string" || typeof row.revision !== "number" || typeof row.createdAt !== "string") return null;
  return catalogPendingRequestForActor({
    id: row.id,
    kind: row.kind,
    status: row.status,
    proposerId: row.proposerId,
    reviewerId: nullableString(row.reviewerId),
    baseRevision: nullableInteger(row.baseRevision),
    revision: row.revision,
    reason: nullableString(row.reason),
    reviewNote: nullableString(row.reviewNote),
    createdAt: row.createdAt,
    reviewedAt: nullableString(row.reviewedAt),
  }, actorUserId, canReview);
}

function normalizeRows(
  value: unknown,
  actorUserId: string,
  canReview: boolean,
): CatalogWorkspaceListRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string") return [];
    const rawStatus = row.status;
    const status = rawStatus === "ACTIVE" || rawStatus === "RETIRED" ? rawStatus : "DRAFT";
    return [{
      id: row.id,
      senseKey: nullableString(row.senseKey),
      catalogKey: nullableString(row.catalogKey),
      sourceFile: nullableString(row.sourceFile),
      sourceRow: nullableInteger(row.sourceRow) ?? 0,
      term: stringValue(row.term),
      lemma: stringValue(row.lemma),
      definitionZh: stringValue(row.definitionZh),
      partOfSpeech: stringValue(row.partOfSpeech),
      level: stringValue(row.level),
      category: stringValue(row.category),
      phoneticIpa: nullableString(row.phoneticIpa),
      enableEnToZh: row.enableEnToZh === true,
      enableZhToEn: row.enableZhToEn === true,
      status,
      revision: nullableInteger(row.revision),
      latestRevision: nullableInteger(row.latestRevision),
      approvedRevisionId: nullableString(row.approvedRevisionId),
      primaryDisposition: stringValue(row.primaryDisposition),
      eligibilityResult: nullableString(row.eligibilityResult),
      validationErrors: stringList(row.validationErrors),
      validationWarnings: stringList(row.validationWarnings),
      pendingRequest: normalizePendingRequest(row.pendingRequest, actorUserId, canReview),
      hasSense: row.hasSense === true,
    }];
  });
}

export async function readCatalogWorkspacePage(input: {
  batchId: string;
  filters: CatalogWorkspaceFilters;
  limit: number;
  offset: number;
  canReview: boolean;
  actorUserId: string;
}): Promise<CatalogWorkspacePageResult> {
  const standaloneCreateScope = input.canReview
    ? Prisma.sql`TRUE`
    : Prisma.sql`request."proposerId" = ${input.actorUserId}`;
  const where = filterSql(input.filters);
  const result = await prisma.$queryRaw<RawCatalogWorkspaceResult[]>(Prisma.sql`
    WITH catalog_rows AS MATERIALIZED (
      SELECT
        import_row."id" AS "id",
        import_row."senseKey" AS "senseKey",
        import_row."catalogKey" AS "catalogKey",
        import_row."sourceFile" AS "sourceFile",
        import_row."sourceRow" AS "sourceRow",
        COALESCE(approved_revision."term", latest_revision."term", import_row."sourceData"->>'term', '') AS "term",
        COALESCE(approved_revision."lemma", latest_revision."lemma", import_row."sourceData"->>'lemma', '') AS "lemma",
        COALESCE(approved_revision."definitionZh", latest_revision."definitionZh", import_row."sourceData"->>'definitionZh', '') AS "definitionZh",
        COALESCE(approved_revision."pos", latest_revision."pos", import_row."sourceData"->>'pos', import_row."sourceData"->>'partOfSpeech', '') AS "partOfSpeech",
        COALESCE(approved_revision."level"::text, latest_revision."level"::text, import_row."sourceData"->>'level', '') AS "level",
        COALESCE(approved_revision."category", latest_revision."category", import_row."sourceData"->>'category', '') AS "category",
        COALESCE(approved_revision."phoneticIpa", latest_revision."phoneticIpa", import_row."sourceData"->>'phoneticIpa') AS "phoneticIpa",
        COALESCE(approved_revision."enableEnToZh", latest_revision."enableEnToZh", lower(import_row."sourceData"->>'enableEnToZh') = 'true', FALSE) AS "enableEnToZh",
        COALESCE(approved_revision."enableZhToEn", latest_revision."enableZhToEn", lower(import_row."sourceData"->>'enableZhToEn') = 'true', FALSE) AS "enableZhToEn",
        COALESCE(sense."status"::text, 'DRAFT') AS "status",
        COALESCE(approved_revision."revision", latest_revision."revision") AS "revision",
        latest_revision."revision" AS "latestRevision",
        sense."approvedRevisionId" AS "approvedRevisionId",
        import_row."primaryDisposition" AS "primaryDisposition",
        import_row."eligibilityResult" AS "eligibilityResult",
        CASE WHEN jsonb_typeof(import_row."issues"->'errors') = 'array' THEN import_row."issues"->'errors' ELSE '[]'::jsonb END AS "validationErrors",
        CASE WHEN jsonb_typeof(import_row."issues"->'warnings') = 'array' THEN import_row."issues"->'warnings' ELSE '[]'::jsonb END AS "validationWarnings",
        CASE WHEN pending."id" IS NULL THEN NULL ELSE jsonb_build_object(
          'id', pending."id", 'kind', pending."kind"::text, 'status', pending."status"::text,
          'proposerId', pending."proposerId", 'reviewerId', pending."reviewerId",
          'baseRevision', pending."baseRevision", 'revision', pending."revision",
          'reason', pending."reason", 'reviewNote', pending."reviewNote",
          'createdAt', pending."createdAt", 'reviewedAt', pending."reviewedAt"
        ) END AS "pendingRequest",
        (sense."id" IS NOT NULL) AS "hasSense",
        0 AS "sortGroup"
      FROM "CatalogImportRow" import_row
      LEFT JOIN "WordSense" sense ON sense."senseKey" = import_row."senseKey"
      LEFT JOIN "WordSenseRevision" approved_revision ON approved_revision."id" = sense."approvedRevisionId"
      LEFT JOIN LATERAL (
        SELECT revision.* FROM "WordSenseRevision" revision
        WHERE revision."senseId" = sense."id"
        ORDER BY revision."revision" DESC
        LIMIT 1
      ) latest_revision ON TRUE
      LEFT JOIN LATERAL (
        SELECT request.* FROM "CatalogChangeRequest" request
        WHERE request."status"::text = 'PENDING'
          AND request."submissionProposalGroupId" IS NULL
          AND ((sense."id" IS NOT NULL AND request."senseId" = sense."id") OR request."sourceImportRowId" = import_row."id")
        ORDER BY request."createdAt" DESC, request."id" DESC
        LIMIT 1
      ) pending ON TRUE
      WHERE import_row."batchId" = ${input.batchId}

      UNION ALL

      SELECT
        sense."id" AS "id",
        sense."senseKey" AS "senseKey",
        entry."catalogKey" AS "catalogKey",
        'governance'::text AS "sourceFile",
        0 AS "sourceRow",
        COALESCE(approved_revision."term", latest_revision."term", sense."term", '') AS "term",
        COALESCE(approved_revision."lemma", latest_revision."lemma", entry."lemma", '') AS "lemma",
        COALESCE(approved_revision."definitionZh", latest_revision."definitionZh", '') AS "definitionZh",
        COALESCE(approved_revision."pos", latest_revision."pos", sense."pos", '') AS "partOfSpeech",
        COALESCE(approved_revision."level"::text, latest_revision."level"::text, sense."level"::text) AS "level",
        COALESCE(approved_revision."category", latest_revision."category", sense."category", '') AS "category",
        COALESCE(approved_revision."phoneticIpa", latest_revision."phoneticIpa") AS "phoneticIpa",
        COALESCE(approved_revision."enableEnToZh", latest_revision."enableEnToZh", FALSE) AS "enableEnToZh",
        COALESCE(approved_revision."enableZhToEn", latest_revision."enableZhToEn", FALSE) AS "enableZhToEn",
        sense."status"::text AS "status",
        COALESCE(approved_revision."revision", latest_revision."revision") AS "revision",
        latest_revision."revision" AS "latestRevision",
        sense."approvedRevisionId" AS "approvedRevisionId",
        'NO_CHANGE'::text AS "primaryDisposition",
        CASE WHEN sense."status"::text = 'ACTIVE' THEN 'ACTIVATION_ELIGIBLE' ELSE 'DRAFT_BLOCKED' END AS "eligibilityResult",
        '[]'::jsonb AS "validationErrors",
        '[]'::jsonb AS "validationWarnings",
        CASE WHEN pending."id" IS NULL THEN NULL ELSE jsonb_build_object(
          'id', pending."id", 'kind', pending."kind"::text, 'status', pending."status"::text,
          'proposerId', pending."proposerId", 'reviewerId', pending."reviewerId",
          'baseRevision', pending."baseRevision", 'revision', pending."revision",
          'reason', pending."reason", 'reviewNote', pending."reviewNote",
          'createdAt', pending."createdAt", 'reviewedAt', pending."reviewedAt"
        ) END AS "pendingRequest",
        TRUE AS "hasSense",
        1 AS "sortGroup"
      FROM "WordSense" sense
      JOIN "CatalogEntry" entry ON entry."id" = sense."catalogEntryId"
      LEFT JOIN "WordSenseRevision" approved_revision ON approved_revision."id" = sense."approvedRevisionId"
      LEFT JOIN LATERAL (
        SELECT revision.* FROM "WordSenseRevision" revision
        WHERE revision."senseId" = sense."id"
        ORDER BY revision."revision" DESC
        LIMIT 1
      ) latest_revision ON TRUE
      LEFT JOIN LATERAL (
        SELECT request.* FROM "CatalogChangeRequest" request
        WHERE request."status"::text = 'PENDING'
          AND request."submissionProposalGroupId" IS NULL
          AND request."senseId" = sense."id"
        ORDER BY request."createdAt" DESC, request."id" DESC
        LIMIT 1
      ) pending ON TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM "CatalogImportRow" import_row
        WHERE import_row."batchId" = ${input.batchId} AND import_row."senseKey" = sense."senseKey"
      )

      UNION ALL

      SELECT
        request."id" AS "id",
        request."senseKey" AS "senseKey",
        request."catalogKey" AS "catalogKey",
        NULL::text AS "sourceFile",
        0 AS "sourceRow",
        COALESCE(request."payload"->>'term', '') AS "term",
        COALESCE(request."payload"->>'lemma', '') AS "lemma",
        COALESCE(request."payload"->>'definitionZh', '') AS "definitionZh",
        COALESCE(request."payload"->>'partOfSpeech', request."payload"->>'pos', '') AS "partOfSpeech",
        COALESCE(request."payload"->>'level', '') AS "level",
        COALESCE(request."payload"->>'category', '') AS "category",
        request."payload"->>'phoneticIpa' AS "phoneticIpa",
        COALESCE(lower(request."payload"->>'enableEnToZh') = 'true', FALSE) AS "enableEnToZh",
        COALESCE(lower(request."payload"->>'enableZhToEn') = 'true', FALSE) AS "enableZhToEn",
        'DRAFT'::text AS "status",
        NULL::integer AS "revision",
        NULL::integer AS "latestRevision",
        NULL::text AS "approvedRevisionId",
        'CREATED_DRAFT'::text AS "primaryDisposition",
        'DRAFT_BLOCKED'::text AS "eligibilityResult",
        jsonb_build_array('PENDING_CREATE') AS "validationErrors",
        '[]'::jsonb AS "validationWarnings",
        jsonb_build_object(
          'id', request."id", 'kind', request."kind"::text, 'status', request."status"::text,
          'proposerId', request."proposerId", 'reviewerId', request."reviewerId",
          'baseRevision', request."baseRevision", 'revision', request."revision",
          'reason', request."reason", 'reviewNote', request."reviewNote",
          'createdAt', request."createdAt", 'reviewedAt', request."reviewedAt"
        ) AS "pendingRequest",
        FALSE AS "hasSense",
        2 AS "sortGroup"
      FROM "CatalogChangeRequest" request
      WHERE request."status"::text = 'PENDING'
        AND request."kind"::text = 'CREATE'
        AND request."submissionProposalGroupId" IS NULL
        AND request."senseId" IS NULL
        AND request."sourceImportRowId" IS NULL
        AND ${standaloneCreateScope}
    ), filtered_rows AS MATERIALIZED (
      SELECT * FROM catalog_rows
      ${where}
    ), page_rows AS (
      SELECT * FROM filtered_rows
      ORDER BY "sortGroup", "sourceFile" NULLS LAST, "sourceRow", lower("term"), "senseKey" NULLS LAST, "id"
      OFFSET ${input.offset}
      LIMIT ${input.limit}
    )
    SELECT
      COUNT(*)::integer AS "allCount",
      COUNT(*) FILTER (WHERE "status" = 'ACTIVE')::integer AS "activeCount",
      COUNT(*) FILTER (WHERE "status" = 'DRAFT')::integer AS "draftCount",
      COUNT(*) FILTER (WHERE "status" = 'RETIRED')::integer AS "retiredCount",
      COUNT(*) FILTER (WHERE "eligibilityResult" = 'DRAFT_BLOCKED')::integer AS "blockedCount",
      COUNT(*) FILTER (WHERE "primaryDisposition" = 'VALIDATION_FAILED')::integer AS "validationFailedCount",
      COUNT(*) FILTER (WHERE "pendingRequest" IS NOT NULL)::integer AS "pendingCount",
      (SELECT COUNT(*)::integer FROM filtered_rows) AS "filteredTotal",
      COALESCE((
        SELECT jsonb_agg(
          to_jsonb(page_rows) - 'sortGroup'
          ORDER BY "sortGroup", "sourceFile" NULLS LAST, "sourceRow", lower("term"), "senseKey" NULLS LAST, "id"
        ) FROM page_rows
      ), '[]'::jsonb) AS "rows"
    FROM catalog_rows
  `);
  const row = result[0];
  if (!row) throw new Error("CATALOG_WORKSPACE_QUERY_EMPTY");
  return {
    rows: normalizeRows(row.rows, input.actorUserId, input.canReview),
    filteredTotal: row.filteredTotal,
    counts: {
      all: row.allCount,
      ACTIVE: row.activeCount,
      DRAFT: row.draftCount,
      RETIRED: row.retiredCount,
      blocked: row.blockedCount,
      validationFailed: row.validationFailedCount,
      pending: row.pendingCount,
    },
  };
}
