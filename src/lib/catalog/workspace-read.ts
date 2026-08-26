import { Prisma, prisma } from "@/lib/prisma";
import { catalogLegacyValidationIssue } from "@/lib/catalog/csv";
import {
  CATALOG_STRUCTURED_ISSUE_VERSION,
  CATALOG_UNSUPPORTED_STRUCTURED_ISSUE_CODE,
} from "@/lib/catalog/validation-issue-contract";
import type {
  CatalogWorkspaceFilters,
  CatalogWorkspaceSort,
} from "@/lib/catalog/workspace-query";
import {
  catalogPendingRequestForActor,
  type CatalogPendingSummary,
} from "@/lib/catalog/pending-visibility";
import type {
  CatalogContentScope,
  CatalogReadinessState,
  CatalogStructuredIssue,
  CatalogWorkflowState,
} from "@/lib/catalog/teacher-presentation";

export interface CatalogWorkspaceListRow {
  id: string;
  senseKey: string | null;
  catalogKey: string | null;
  sourceFile: string | null;
  sourceRow: number;
  term: string;
  lemma: string;
  definitionZh: string;
  displayIdentity: string;
  partOfSpeech: string;
  level: string;
  category: string;
  phoneticIpa: string | null;
  enableEnToZh: boolean;
  enableZhToEn: boolean;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  lifecycleState: "DRAFT" | "ACTIVE" | "RETIRED";
  workflowState: CatalogWorkflowState;
  readinessState: CatalogReadinessState;
  contentScope: CatalogContentScope;
  issueCount: number;
  structuredIssues: CatalogStructuredIssue[];
  revision: number | null;
  latestRevision: number | null;
  currentRevisionNumber: number | null;
  lastChangedAt: string;
  approvedRevisionId: string | null;
  primaryDisposition: string;
  eligibilityResult: string | null;
  /** Compatibility only; teacher UI must use structuredIssues. */
  validationErrors: string[];
  validationWarnings: string[];
  pendingRequest:
    | CatalogPendingSummary
    | {
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
      }
    | null;
  hasSense: boolean;
}

export interface CatalogWorkspaceFacetValue {
  value: string;
  count: number;
}

export interface CatalogWorkspacePageResult {
  rows: CatalogWorkspaceListRow[];
  filteredTotal: number;
  counts: Record<string, number>;
  facets: {
    partOfSpeech: CatalogWorkspaceFacetValue[];
    category: CatalogWorkspaceFacetValue[];
  };
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
  partOfSpeechFacets: unknown;
  categoryFacets: unknown;
  rows: unknown;
};

function filterSql(
  filters: CatalogWorkspaceFilters,
  exclude?: "partOfSpeech" | "category",
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (filters.mode === "LEGACY_V1") {
    if (
      filters.status === "ACTIVE" ||
      filters.status === "DRAFT" ||
      filters.status === "RETIRED"
    ) {
      conditions.push(Prisma.sql`"status" = ${filters.status}`);
    } else if (filters.status === "BLOCKED") {
      conditions.push(Prisma.sql`"eligibilityResult" = 'DRAFT_BLOCKED'`);
    } else if (filters.status === "VALIDATION_FAILED") {
      conditions.push(Prisma.sql`"primaryDisposition" = 'VALIDATION_FAILED'`);
    } else if (filters.status === "PENDING") {
      conditions.push(Prisma.sql`"workflowState" = 'PENDING'`);
    }
  }
  if (filters.lifecycle !== "ALL")
    conditions.push(Prisma.sql`"status" = ${filters.lifecycle}`);
  if (filters.workflow !== "ALL")
    conditions.push(Prisma.sql`"workflowState" = ${filters.workflow}`);
  if (filters.level !== "ALL")
    conditions.push(Prisma.sql`"level" = ${filters.level}`);
  if (filters.direction === "EN_ZH")
    conditions.push(Prisma.sql`"enableEnToZh" = TRUE`);
  if (filters.direction === "ZH_EN")
    conditions.push(Prisma.sql`"enableZhToEn" = TRUE`);
  if (filters.readiness !== "ALL")
    conditions.push(Prisma.sql`"readinessState" = ${filters.readiness}`);
  if (filters.issues === "NONE") conditions.push(Prisma.sql`"issueCount" = 0`);
  else if (filters.issues !== "ALL")
    conditions.push(
      Prisma.sql`"issueScope" = ${filters.issues} AND "issueCount" > 0`,
    );
  if (exclude !== "partOfSpeech" && filters.partOfSpeech !== "ALL") {
    if (filters.partOfSpeech === "UNCLASSIFIED")
      conditions.push(Prisma.sql`btrim("partOfSpeech") = ''`);
    else
      conditions.push(
        Prisma.sql`lower(btrim("partOfSpeech")) = lower(${filters.partOfSpeech})`,
      );
  }
  if (filters.initial !== "ALL") {
    if (filters.initial === "OTHER")
      conditions.push(Prisma.sql`upper(left(btrim("term"), 1)) !~ '^[A-Z]$'`);
    else
      conditions.push(
        Prisma.sql`upper(left(btrim("term"), 1)) = ${filters.initial}`,
      );
  }
  if (exclude !== "category" && filters.category !== "ALL") {
    if (filters.category === "UNCLASSIFIED")
      conditions.push(Prisma.sql`btrim("category") = ''`);
    else conditions.push(Prisma.sql`"category" = ${filters.category}`);
  }
  if (filters.q) {
    conditions.push(
      Prisma.sql`strpos(lower(concat_ws(' ', "term", "lemma", "definitionZh", "category", "phoneticIpa")), lower(${filters.q})) > 0`,
    );
  }
  return conditions.length
    ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
    : Prisma.empty;
}

function orderSql(sort: CatalogWorkspaceSort): Prisma.Sql {
  if (sort === "TERM_DESC")
    return Prisma.sql`lower("term") DESC, lower("definitionZh"), "senseKey" NULLS LAST, "id"`;
  if (sort === "UPDATED_DESC")
    return Prisma.sql`"lastChangedAt" DESC, lower("term"), "senseKey" NULLS LAST, "id"`;
  if (sort === "LEVEL_ASC")
    return Prisma.sql`CASE "level" WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 ELSE 5 END, lower("term"), lower("definitionZh"), "id"`;
  if (sort === "ACTION_REQUIRED_FIRST")
    return Prisma.sql`CASE WHEN "workflowState" = 'PENDING' OR "issueCount" > 0 OR "status" = 'DRAFT' THEN 0 ELSE 1 END, "lastChangedAt" DESC, lower("term"), "id"`;
  if (sort === "SOURCE_ORDER")
    return Prisma.sql`"sortGroup", "sourceFile" NULLS LAST, "sourceRow", lower("term"), "senseKey" NULLS LAST, "id"`;
  return Prisma.sql`lower("term"), lower("definitionZh"), "senseKey" NULLS LAST, "id"`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) ? (value as number) : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function catalogStoredStructuredIssues(
  value: unknown,
  legacyErrors: string[],
  legacyWarnings: string[],
): CatalogStructuredIssue[] {
  const contract =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const version = nullableString(contract.version);
  const stored = Array.isArray(contract.issues) ? contract.issues : [];
  const parsed = stored.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.code !== "string") return [];
    const direction: CatalogStructuredIssue["direction"] =
      row.direction === "EN_TO_ZH" || row.direction === "ZH_TO_EN"
        ? row.direction
        : null;
    const severity: CatalogStructuredIssue["severity"] =
      row.severity === "WARNING" ? "WARNING" : "ERROR";
    return [
      {
        code: row.code,
        field: typeof row.field === "string" ? row.field : null,
        direction,
        severity,
      },
    ];
  });
  if (version === CATALOG_STRUCTURED_ISSUE_VERSION) return parsed;
  if (version !== null) {
    return [
      {
        code: CATALOG_UNSUPPORTED_STRUCTURED_ISSUE_CODE,
        field: null,
        direction: null,
        severity: "ERROR",
      },
    ];
  }
  // Bounded compatibility adapter for pre-contract import rows. Only this
  // server-side boundary applies the allowlisted legacy message patterns; the
  // API and UI always receive structured issues.
  return [
    ...legacyErrors.map((message) =>
      catalogLegacyValidationIssue(message, "ERROR"),
    ),
    ...legacyWarnings.map((message) =>
      catalogLegacyValidationIssue(message, "WARNING"),
    ),
  ];
}

function normalizePendingRequest(
  value: unknown,
  actorUserId: string,
  canReview: boolean,
): CatalogWorkspaceListRow["pendingRequest"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.kind !== "string" ||
    typeof row.status !== "string" ||
    typeof row.proposerId !== "string" ||
    typeof row.revision !== "number" ||
    typeof row.createdAt !== "string"
  )
    return null;
  return catalogPendingRequestForActor(
    {
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
    },
    actorUserId,
    canReview,
  );
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
    const status =
      rawStatus === "ACTIVE" || rawStatus === "RETIRED" ? rawStatus : "DRAFT";
    const workflowState = row.workflowState === "PENDING" ? "PENDING" : "NONE";
    const readinessState =
      row.readinessState === "BOTH" ||
      row.readinessState === "EN_TO_ZH_ONLY" ||
      row.readinessState === "ZH_TO_EN_ONLY"
        ? row.readinessState
        : "UNAVAILABLE";
    const contentScope =
      row.contentScope === "PENDING_DRAFT" ||
      row.contentScope === "IMPORT_DRAFT"
        ? row.contentScope
        : "CURRENT_CONTENT";
    const term = stringValue(row.term);
    const definitionZh = stringValue(row.definitionZh);
    const partOfSpeech = stringValue(row.partOfSpeech);
    const level = stringValue(row.level);
    const validationErrors = stringList(row.validationErrors);
    const validationWarnings = stringList(row.validationWarnings);
    const structuredIssues = catalogStoredStructuredIssues(
      row.structuredIssuePayload,
      validationErrors,
      validationWarnings,
    );
    return [
      {
        id: row.id,
        senseKey: nullableString(row.senseKey),
        catalogKey: nullableString(row.catalogKey),
        sourceFile: nullableString(row.sourceFile),
        sourceRow: nullableInteger(row.sourceRow) ?? 0,
        term,
        lemma: stringValue(row.lemma),
        definitionZh,
        displayIdentity: [term, definitionZh, partOfSpeech, level]
          .filter(Boolean)
          .join(" · "),
        partOfSpeech,
        level,
        category: stringValue(row.category),
        phoneticIpa: nullableString(row.phoneticIpa),
        enableEnToZh: row.enableEnToZh === true,
        enableZhToEn: row.enableZhToEn === true,
        status,
        lifecycleState: status,
        workflowState,
        readinessState,
        contentScope,
        issueCount: structuredIssues.filter(
          (issue) => issue.severity === "ERROR",
        ).length,
        structuredIssues,
        revision: nullableInteger(row.revision),
        latestRevision: nullableInteger(row.latestRevision),
        currentRevisionNumber: nullableInteger(row.currentRevisionNumber),
        lastChangedAt: stringValue(row.lastChangedAt),
        approvedRevisionId: nullableString(row.approvedRevisionId),
        primaryDisposition: stringValue(row.primaryDisposition),
        eligibilityResult: nullableString(row.eligibilityResult),
        validationErrors,
        validationWarnings,
        pendingRequest: normalizePendingRequest(
          row.pendingRequest,
          actorUserId,
          canReview,
        ),
        hasSense: row.hasSense === true,
      },
    ];
  });
}

function normalizeFacets(value: unknown): CatalogWorkspaceFacetValue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const count = nullableInteger(row.count);
    return typeof row.value === "string" && count !== null
      ? [{ value: row.value || "UNCLASSIFIED", count }]
      : [];
  });
}

function retainSelectedFacet(
  facets: CatalogWorkspaceFacetValue[],
  selected: string,
): CatalogWorkspaceFacetValue[] {
  if (selected === "ALL" || facets.some((facet) => facet.value === selected))
    return facets;
  return [...facets, { value: selected, count: 0 }];
}

export interface CatalogWorkspacePageInput {
  batchId: string;
  filters: CatalogWorkspaceFilters;
  limit: number;
  offset: number;
  canReview: boolean;
  actorUserId: string;
}

export function catalogWorkspacePageSql(
  input: CatalogWorkspacePageInput,
): Prisma.Sql {
  const standaloneCreateScope = input.canReview
    ? Prisma.sql`TRUE`
    : Prisma.sql`request."proposerId" = ${input.actorUserId}`;
  const where = filterSql(input.filters);
  const partOfSpeechFacetWhere = filterSql(input.filters, "partOfSpeech");
  const categoryFacetWhere = filterSql(input.filters, "category");
  const order = orderSql(input.filters.sort);
  return Prisma.sql`
    WITH catalog_base AS MATERIALIZED (
      SELECT
        import_row."id" AS "id", import_row."senseKey" AS "senseKey", import_row."catalogKey" AS "catalogKey",
        import_row."sourceFile" AS "sourceFile", import_row."sourceRow" AS "sourceRow",
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
        latest_revision."revision" AS "latestRevision", approved_revision."revision" AS "currentRevisionNumber",
        sense."approvedRevisionId" AS "approvedRevisionId", import_row."primaryDisposition" AS "primaryDisposition",
        import_row."eligibilityResult" AS "eligibilityResult",
        CASE WHEN approved_revision."id" IS NOT NULL THEN '[]'::jsonb WHEN jsonb_typeof(import_row."issues"->'errors') = 'array' THEN import_row."issues"->'errors' ELSE '[]'::jsonb END AS "validationErrors",
        CASE WHEN jsonb_typeof(import_row."issues"->'warnings') = 'array' THEN import_row."issues"->'warnings' ELSE '[]'::jsonb END AS "validationWarnings",
        CASE
          WHEN approved_revision."id" IS NOT NULL THEN jsonb_build_object('version', CAST(${CATALOG_STRUCTURED_ISSUE_VERSION} AS text), 'issues', '[]'::jsonb)
          ELSE jsonb_build_object(
            'version', import_row."issues"->>'structuredIssueVersion',
            'issues', CASE WHEN jsonb_typeof(import_row."issues"->'structuredIssues') = 'array' THEN import_row."issues"->'structuredIssues' ELSE '[]'::jsonb END
          )
        END AS "structuredIssuePayload",
        CASE
          WHEN approved_revision."id" IS NOT NULL THEN 0
          WHEN import_row."issues"->>'structuredIssueVersion' IS NOT NULL
            AND import_row."issues"->>'structuredIssueVersion' <> ${CATALOG_STRUCTURED_ISSUE_VERSION} THEN 1
          WHEN import_row."issues"->>'structuredIssueVersion' = ${CATALOG_STRUCTURED_ISSUE_VERSION} THEN (
            SELECT COUNT(*)::integer
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(import_row."issues"->'structuredIssues') = 'array' THEN import_row."issues"->'structuredIssues' ELSE '[]'::jsonb END
            ) issue
            WHERE COALESCE(issue->>'severity', 'ERROR') <> 'WARNING'
          )
          ELSE jsonb_array_length(CASE WHEN jsonb_typeof(import_row."issues"->'errors') = 'array' THEN import_row."issues"->'errors' ELSE '[]'::jsonb END)
        END AS "issueCount",
        CASE WHEN approved_revision."id" IS NULL THEN 'IMPORT_DRAFT' ELSE 'CURRENT_CONTENT' END AS "contentScope",
        CASE WHEN approved_revision."id" IS NULL THEN 'IMPORT_DRAFT' ELSE 'CURRENT_CONTENT' END AS "issueScope",
        CASE WHEN pending."id" IS NULL THEN 'NONE' ELSE 'PENDING' END AS "workflowState",
        CASE WHEN pending."id" IS NULL THEN NULL ELSE jsonb_build_object(
          'id', pending."id", 'kind', pending."kind"::text, 'status', pending."status"::text,
          'proposerId', pending."proposerId", 'reviewerId', pending."reviewerId", 'baseRevision', pending."baseRevision",
          'revision', pending."revision", 'reason', pending."reason", 'reviewNote', pending."reviewNote",
          'createdAt', pending."createdAt", 'reviewedAt', pending."reviewedAt"
        ) END AS "pendingRequest",
        (sense."id" IS NOT NULL) AS "hasSense",
        CASE
          WHEN sense."id" IS NULL THEN import_batch."updatedAt"
          ELSE GREATEST(COALESCE(approved_revision."createdAt", sense."updatedAt"), sense."updatedAt")
        END AS "lastChangedAt",
        0 AS "sortGroup"
      FROM "CatalogImportRow" import_row
      JOIN "CatalogImportBatch" import_batch ON import_batch."id" = import_row."batchId"
      LEFT JOIN "WordSense" sense ON sense."senseKey" = import_row."senseKey"
      LEFT JOIN "WordSenseRevision" approved_revision ON approved_revision."id" = sense."approvedRevisionId"
      LEFT JOIN LATERAL (SELECT revision.* FROM "WordSenseRevision" revision WHERE revision."senseId" = sense."id" ORDER BY revision."revision" DESC LIMIT 1) latest_revision ON TRUE
      LEFT JOIN LATERAL (
        SELECT request.* FROM "CatalogChangeRequest" request
        WHERE request."status"::text = 'PENDING' AND request."submissionProposalGroupId" IS NULL
          AND ((sense."id" IS NOT NULL AND request."senseId" = sense."id") OR request."sourceImportRowId" = import_row."id")
        ORDER BY request."createdAt" DESC, request."id" DESC LIMIT 1
      ) pending ON TRUE
      WHERE import_row."batchId" = ${input.batchId}

      UNION ALL

      SELECT
        sense."id", sense."senseKey", entry."catalogKey", 'governance'::text, 0,
        COALESCE(approved_revision."term", latest_revision."term", sense."term", ''),
        COALESCE(approved_revision."lemma", latest_revision."lemma", entry."lemma", ''),
        COALESCE(approved_revision."definitionZh", latest_revision."definitionZh", ''),
        COALESCE(approved_revision."pos", latest_revision."pos", sense."pos", ''),
        COALESCE(approved_revision."level"::text, latest_revision."level"::text, sense."level"::text),
        COALESCE(approved_revision."category", latest_revision."category", sense."category", ''),
        COALESCE(approved_revision."phoneticIpa", latest_revision."phoneticIpa"),
        COALESCE(approved_revision."enableEnToZh", latest_revision."enableEnToZh", FALSE),
        COALESCE(approved_revision."enableZhToEn", latest_revision."enableZhToEn", FALSE),
        sense."status"::text, COALESCE(approved_revision."revision", latest_revision."revision"), latest_revision."revision", approved_revision."revision",
        sense."approvedRevisionId", 'NO_CHANGE'::text,
        CASE WHEN sense."status"::text = 'ACTIVE' THEN 'ACTIVATION_ELIGIBLE' ELSE 'DRAFT_BLOCKED' END,
        '[]'::jsonb, '[]'::jsonb, jsonb_build_object('version', CAST(${CATALOG_STRUCTURED_ISSUE_VERSION} AS text), 'issues', '[]'::jsonb), 0,
        CASE WHEN approved_revision."id" IS NULL THEN 'IMPORT_DRAFT' ELSE 'CURRENT_CONTENT' END,
        CASE WHEN approved_revision."id" IS NULL THEN 'IMPORT_DRAFT' ELSE 'CURRENT_CONTENT' END,
        CASE WHEN pending."id" IS NULL THEN 'NONE' ELSE 'PENDING' END,
        CASE WHEN pending."id" IS NULL THEN NULL ELSE jsonb_build_object(
          'id', pending."id", 'kind', pending."kind"::text, 'status', pending."status"::text,
          'proposerId', pending."proposerId", 'reviewerId', pending."reviewerId", 'baseRevision', pending."baseRevision",
          'revision', pending."revision", 'reason', pending."reason", 'reviewNote', pending."reviewNote",
          'createdAt', pending."createdAt", 'reviewedAt', pending."reviewedAt"
        ) END,
        TRUE,
        GREATEST(COALESCE(approved_revision."createdAt", sense."updatedAt"), sense."updatedAt"),
        1
      FROM "WordSense" sense
      JOIN "CatalogEntry" entry ON entry."id" = sense."catalogEntryId"
      LEFT JOIN "WordSenseRevision" approved_revision ON approved_revision."id" = sense."approvedRevisionId"
      LEFT JOIN LATERAL (SELECT revision.* FROM "WordSenseRevision" revision WHERE revision."senseId" = sense."id" ORDER BY revision."revision" DESC LIMIT 1) latest_revision ON TRUE
      LEFT JOIN LATERAL (
        SELECT request.* FROM "CatalogChangeRequest" request
        WHERE request."status"::text = 'PENDING' AND request."submissionProposalGroupId" IS NULL AND request."senseId" = sense."id"
        ORDER BY request."createdAt" DESC, request."id" DESC LIMIT 1
      ) pending ON TRUE
      WHERE NOT EXISTS (SELECT 1 FROM "CatalogImportRow" import_row WHERE import_row."batchId" = ${input.batchId} AND import_row."senseKey" = sense."senseKey")

      UNION ALL

      SELECT
        request."id", request."senseKey", request."catalogKey", NULL::text, 0,
        COALESCE(request."payload"->>'term', ''), COALESCE(request."payload"->>'lemma', ''), COALESCE(request."payload"->>'definitionZh', ''),
        COALESCE(request."payload"->>'partOfSpeech', request."payload"->>'pos', ''), COALESCE(request."payload"->>'level', ''),
        COALESCE(request."payload"->>'category', ''), request."payload"->>'phoneticIpa',
        COALESCE(lower(request."payload"->>'enableEnToZh') = 'true', FALSE), COALESCE(lower(request."payload"->>'enableZhToEn') = 'true', FALSE),
        'DRAFT'::text, NULL::integer, NULL::integer, NULL::integer, NULL::text, 'CREATED_DRAFT'::text, 'DRAFT_BLOCKED'::text,
        '[]'::jsonb, '[]'::jsonb, jsonb_build_object('version', CAST(${CATALOG_STRUCTURED_ISSUE_VERSION} AS text), 'issues', '[]'::jsonb), 0, 'PENDING_DRAFT'::text, 'PENDING_DRAFT'::text, 'PENDING'::text,
        jsonb_build_object(
          'id', request."id", 'kind', request."kind"::text, 'status', request."status"::text,
          'proposerId', request."proposerId", 'reviewerId', request."reviewerId", 'baseRevision', request."baseRevision",
          'revision', request."revision", 'reason', request."reason", 'reviewNote', request."reviewNote",
          'createdAt', request."createdAt", 'reviewedAt', request."reviewedAt"
        ),
        FALSE, request."updatedAt", 2
      FROM "CatalogChangeRequest" request
      WHERE request."status"::text = 'PENDING' AND request."kind"::text = 'CREATE'
        AND request."submissionProposalGroupId" IS NULL AND request."senseId" IS NULL AND request."sourceImportRowId" IS NULL
        AND ${standaloneCreateScope}
    ), catalog_rows AS MATERIALIZED (
      SELECT catalog_base.*,
        CASE
          WHEN "issueCount" > 0 THEN 'UNAVAILABLE'
          WHEN "enableEnToZh" AND "enableZhToEn" THEN 'BOTH'
          WHEN "enableEnToZh" THEN 'EN_TO_ZH_ONLY'
          WHEN "enableZhToEn" THEN 'ZH_TO_EN_ONLY'
          ELSE 'UNAVAILABLE'
        END AS "readinessState"
      FROM catalog_base
    ), filtered_rows AS MATERIALIZED (
      SELECT * FROM catalog_rows ${where}
    ), page_rows AS MATERIALIZED (
      SELECT * FROM filtered_rows ORDER BY ${order} OFFSET ${input.offset} LIMIT ${input.limit}
    ), part_of_speech_facets AS (
      SELECT COALESCE(NULLIF(lower(btrim("partOfSpeech")), ''), 'UNCLASSIFIED') AS value, COUNT(*)::integer AS count
      FROM catalog_rows ${partOfSpeechFacetWhere}
      GROUP BY value ORDER BY count DESC, value
    ), category_facets AS (
      SELECT COALESCE(NULLIF(btrim("category"), ''), 'UNCLASSIFIED') AS value, COUNT(*)::integer AS count
      FROM catalog_rows ${categoryFacetWhere}
      GROUP BY value ORDER BY count DESC, value
    )
    SELECT
      COUNT(*)::integer AS "allCount",
      COUNT(*) FILTER (WHERE "status" = 'ACTIVE')::integer AS "activeCount",
      COUNT(*) FILTER (WHERE "status" = 'DRAFT')::integer AS "draftCount",
      COUNT(*) FILTER (WHERE "status" = 'RETIRED')::integer AS "retiredCount",
      COUNT(*) FILTER (WHERE "eligibilityResult" = 'DRAFT_BLOCKED')::integer AS "blockedCount",
      COUNT(*) FILTER (WHERE "primaryDisposition" = 'VALIDATION_FAILED')::integer AS "validationFailedCount",
      COUNT(*) FILTER (WHERE "workflowState" = 'PENDING')::integer AS "pendingCount",
      (SELECT COUNT(*)::integer FROM filtered_rows) AS "filteredTotal",
      COALESCE((SELECT jsonb_agg(to_jsonb(part_of_speech_facets) ORDER BY count DESC, value) FROM part_of_speech_facets), '[]'::jsonb) AS "partOfSpeechFacets",
      COALESCE((SELECT jsonb_agg(to_jsonb(category_facets) ORDER BY count DESC, value) FROM category_facets), '[]'::jsonb) AS "categoryFacets",
      COALESCE((SELECT jsonb_agg(to_jsonb(page_rows) - 'sortGroup' ORDER BY ${order}) FROM page_rows), '[]'::jsonb) AS "rows"
    FROM catalog_rows
  `;
}

export async function readCatalogWorkspacePage(
  input: CatalogWorkspacePageInput,
): Promise<CatalogWorkspacePageResult> {
  const result = await prisma.$queryRaw<RawCatalogWorkspaceResult[]>(
    catalogWorkspacePageSql(input),
  );
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
    facets: {
      partOfSpeech: retainSelectedFacet(
        normalizeFacets(row.partOfSpeechFacets),
        input.filters.partOfSpeech,
      ),
      category: retainSelectedFacet(
        normalizeFacets(row.categoryFacets),
        input.filters.category,
      ),
    },
  };
}
