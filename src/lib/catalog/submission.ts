import { createHash } from "node:crypto";
import { auditKeyVersion, hashSecurityAuditValue } from "@/lib/security-events";
import {
  CATALOG_NORMALIZATION_VERSION,
  CATALOG_SCHEMA_VERSION,
  CATALOG_VALIDATOR_VERSION,
  CATALOG_GOVERNANCE_HEADERS,
  CATALOG_HEADERS,
  normalizeCatalogRow,
  normalizeCatalogText,
  validateCatalogRow,
  type CatalogSourceRow,
  type NormalizedCatalogRow,
} from "./csv";
import { CATALOG_CATEGORIES, CATALOG_TAXONOMY_VERSION } from "./taxonomy";
import {
  payloadFingerprint,
  type CatalogGovernancePayload,
} from "./governance";

export const CATALOG_REVIEW_RISK_VERSION = "catalog-review-risk-v1" as const;
export const CATALOG_PROPOSAL_PAYLOAD_VERSION = "catalog-proposal-v1" as const;
export const CATALOG_PREVIEW_ACTIVITY_DAYS = 7;
export const CATALOG_PREVIEW_ABSOLUTE_DAYS = 30;

export type CatalogBatchErrorDescriptor = { field: string; excelColumn: string; code: string; message: string; fix: string };

function excelColumnForCatalogField(field: string): string {
  let index = CATALOG_GOVERNANCE_HEADERS.indexOf(field as (typeof CATALOG_HEADERS)[number]) + 1;
  if (index <= 0) return "";
  let output = "";
  while (index > 0) {
    index -= 1;
    output = String.fromCharCode(65 + (index % 26)) + output;
    index = Math.floor(index / 26);
  }
  return output;
}

export function describeCatalogBatchError(detail: string): CatalogBatchErrorDescriptor {
  const range = (first: string, last: string) => `${excelColumnForCatalogField(first)}:${excelColumnForCatalogField(last)}`;
  const directional = detail.startsWith("en-zh ")
    ? { field: "distractor_zh_1…distractor_zh_6", excelColumn: range("distractor_zh_1", "distractor_zh_6") }
    : detail.startsWith("zh-en ")
      ? { field: "distractor_en_1…distractor_en_6", excelColumn: range("distractor_en_1", "distractor_en_6") }
      : null;
  const fieldAliases: Record<string, string> = {
    partOfSpeech: "part_of_speech", definitionZh: "definition_zh", acceptedAnswersZh: "accepted_answers_zh",
    phoneticIpa: "phonetic_ipa", exampleEn: "example_en", exampleZh: "example_zh", acceptedFormsEn: "accepted_forms_en",
    synonymsEn: "synonyms_en", antonymsEn: "antonyms_en", enableEnToZh: "enable_en_to_zh", distractorZh: "distractor_zh_1",
    enableZhToEn: "enable_zh_to_en", distractorEn: "distractor_en_1", sourceReference: "source_reference",
    contributorRef: "contributor_ref", changeNote: "change_note", retirementReason: "retirement_reason",
  };
  const token = detail.match(/^([A-Za-z][A-Za-z0-9_]*)/u)?.[1] ?? "";
  const mapped = directional?.field ?? fieldAliases[token] ?? (CATALOG_HEADERS.includes(token as (typeof CATALOG_HEADERS)[number]) ? token : detail.startsWith("UPDATE") ? "sense_key" : detail.startsWith("CREATE") ? "requested_action" : "");
  const code = `CATALOG_ROW_${detail.toUpperCase().replace(/[^A-Z0-9]+/gu, "_").replace(/^_|_$/gu, "").slice(0, 48) || "INVALID"}`;
  const message = detail.includes("stale") ? "匯出的詞條版本已過期。" : detail.includes("does not exist") ? "指定的現有詞條不存在。" : detail.includes("required") ? "必填內容未填寫或格式不正確。" : detail.includes("distractor") ? "干擾項不符合題目安全或數量規則。" : detail.includes("taxonomy") || detail.includes("category") ? "分類不在允許清單內。" : "詞條內容未通過驗證。";
  const fix = directional ? `檢查 ${directional.field}（Excel ${directional.excelColumn}），確保有 5–6 個不重複、非正確答案的干擾項。` : detail.includes("stale") ? "重新由系統匯出最新 UPDATE CSV，再套用修改。" : detail.includes("does not exist") ? "確認 sense key，或重新匯出該詞條。" : "按 field 及 technical_detail 修正該欄，然後重新上載預覽。";
  return { field: mapped, excelColumn: directional?.excelColumn ?? excelColumnForCatalogField(mapped), code, message, fix };
}

export type SubmissionAction = "CREATE" | "UPDATE";
export type SubmissionResolution =
  | "MERGE"
  | "KEEP_SEPARATE"
  | "REPLACE_EXISTING"
  | "REJECT"
  | "ESCALATE";

export interface CatalogDatabaseSenseSnapshot {
  id: string;
  catalogKey: string;
  senseKey: string;
  status: "ACTIVE" | "DRAFT" | "RETIRED";
  revision: number;
  payload: CatalogGovernancePayload;
}

export interface CatalogPendingChangeSnapshot {
  senseId: string | null;
  senseKey: string | null;
  normalizedTerm: string | null;
}

export interface CatalogPendingDependencySnapshot extends CatalogPendingChangeSnapshot {
  requestFingerprint: string;
}

export interface CatalogSubmissionPreviewRow {
  rowNumber: number;
  rowDigest: string;
  requestedAction: SubmissionAction;
  primaryDisposition: "CREATE" | "UPDATE" | "DUPLICATE" | "NO_CHANGE" | "CONFLICT" | "VALIDATION_FAILED";
  warnings: string[];
  errors: string[];
  normalizedTerm: string;
  normalizedLemma: string;
  normalizedSourcePayload: CatalogGovernancePayload;
  proposalGroupNumber: number | null;
  rowRole: "CANONICAL_SOURCE" | "MERGED_SOURCE" | "EXCLUDED";
}

export interface CatalogSubmissionPreviewGroup {
  groupNumber: number;
  requestedAction: SubmissionAction;
  sourceRowNumbers: number[];
  resolution: SubmissionResolution | null;
  resolutionReason: string | null;
  targetCatalogKey: string | null;
  targetSenseKey: string | null;
  targetSenseId: string | null;
  baseRevision: number | null;
  baseStatus: "ACTIVE" | "DRAFT" | "RETIRED" | null;
  dependencyDigest: string;
  finalProposalPayload: CatalogGovernancePayload;
  payloadDigest: string;
  reviewRisk: "MATERIAL" | "LOW_RISK_METADATA";
  reviewRiskReason: string[];
  needsResolution: boolean;
}

export interface CatalogSubmissionPreview {
  rows: CatalogSubmissionPreviewRow[];
  groups: CatalogSubmissionPreviewGroup[];
  status: "PREVIEW" | "NEEDS_RESOLUTION";
  summary: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    proposalGroups: number;
    unresolvedGroups: number;
    createGroups: number;
    updateGroups: number;
  };
}

export type CatalogRetryPreviewBlockedRow = {
  rowNumber: number;
  errors: string[];
};

export class CatalogRetryPreviewBlockedError extends Error {
  readonly rows: CatalogRetryPreviewBlockedRow[];

  constructor(rows: CatalogRetryPreviewBlockedRow[]) {
    super("CATALOG_BATCH_RETRY_BLOCKED");
    this.name = "CatalogRetryPreviewBlockedError";
    this.rows = rows;
  }
}

export function assertCatalogRetryPreviewActionable(preview: CatalogSubmissionPreview): void {
  const blockedRows = preview.rows
    .filter((row) => row.primaryDisposition === "VALIDATION_FAILED")
    .map((row) => ({ rowNumber: row.rowNumber, errors: [...row.errors] }));
  if (blockedRows.length) throw new CatalogRetryPreviewBlockedError(blockedRows);
  if (preview.groups.length === 0) throw new Error("CATALOG_BATCH_RETRY_NO_LONGER_APPLICABLE");
}

const MATERIAL_FIELDS: ReadonlySet<keyof CatalogGovernancePayload> = new Set([
  "term", "lemma", "partOfSpeech", "level", "category", "definitionZh",
  "acceptedAnswersZh", "phoneticIpa", "exampleEn", "exampleZh",
  "acceptedFormsEn", "synonymsEn", "antonymsEn", "enableEnToZh",
  "distractorZh", "enableZhToEn", "distractorEn", "retirementReason",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function catalogTaxonomyDigest(): string {
  return sha256(JSON.stringify({ version: CATALOG_TAXONOMY_VERSION, categories: CATALOG_CATEGORIES }));
}

export function catalogProposalPayload(row: NormalizedCatalogRow): CatalogGovernancePayload {
  return {
    term: row.term,
    lemma: row.lemma,
    partOfSpeech: row.partOfSpeech,
    level: row.level,
    category: row.category,
    definitionZh: row.definitionZh,
    acceptedAnswersZh: row.acceptedAnswersZh,
    phoneticIpa: row.phoneticIpa,
    exampleEn: row.exampleEn,
    exampleZh: row.exampleZh,
    acceptedFormsEn: row.acceptedFormsEn,
    synonymsEn: row.synonymsEn,
    antonymsEn: row.antonymsEn,
    enableEnToZh: row.enableEnToZh,
    distractorZh: row.distractorZh,
    enableZhToEn: row.enableZhToEn,
    distractorEn: row.distractorEn,
    sourceReference: row.sourceReference,
    contributorRef: row.contributorRef,
    changeNote: row.changeNote,
    retirementReason: row.retirementReason,
  };
}

/**
 * Teacher CSV deliberately omits server-managed provenance. UPDATE proposals
 * therefore inherit those fields from the current revision instead of
 * interpreting an absent column as a destructive clear.
 */
export function catalogSubmissionProposalPayload(
  row: NormalizedCatalogRow,
  target: CatalogDatabaseSenseSnapshot | null,
): CatalogGovernancePayload {
  const proposed = catalogProposalPayload(row);
  if (row.requestedAction !== "UPDATE" || !target) return proposed;
  return {
    ...proposed,
    sourceReference: target.payload.sourceReference,
    contributorRef: target.payload.contributorRef,
    changeNote: target.payload.changeNote,
    retirementReason: target.payload.retirementReason,
  };
}

function canonicalArray(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return [...value].map(String).sort((a, b) => a.localeCompare(b, "en"));
}

export interface CatalogFieldDiff {
  field: keyof CatalogGovernancePayload;
  before: unknown;
  after: unknown;
  material: boolean;
}

export function diffCatalogPayload(
  before: CatalogGovernancePayload | null,
  after: CatalogGovernancePayload,
): CatalogFieldDiff[] {
  const fields = Object.keys(after) as Array<keyof CatalogGovernancePayload>;
  return fields.flatMap((field) => {
    const beforeValue = before?.[field] ?? null;
    const afterValue = after[field];
    const comparableBefore = canonicalArray(beforeValue);
    const comparableAfter = canonicalArray(afterValue);
    if (JSON.stringify(comparableBefore) === JSON.stringify(comparableAfter)) return [];
    return [{ field, before: beforeValue, after: afterValue, material: MATERIAL_FIELDS.has(field) }];
  });
}

export function classifyCatalogReviewRisk(
  before: CatalogGovernancePayload | null,
  after: CatalogGovernancePayload,
): { risk: "MATERIAL" | "LOW_RISK_METADATA"; reasons: string[] } {
  const diff = diffCatalogPayload(before, after);
  const material = diff.filter((item) => item.material).map((item) => String(item.field));
  return material.length
    ? { risk: "MATERIAL", reasons: material }
    : { risk: "LOW_RISK_METADATA", reasons: diff.map((item) => String(item.field)) };
}

function semanticIdentity(row: NormalizedCatalogRow): string {
  return [row.normalizedTerm, normalizeCatalogText(row.partOfSpeech), row.level, normalizeCatalogText(row.category), normalizeCatalogText(row.definitionZh)].join("\u0000");
}

function headwordConflictIdentity(row: NormalizedCatalogRow): string {
  return [row.normalizedTerm, normalizeCatalogText(row.partOfSpeech), row.level].join("\u0000");
}

export function catalogDependencyDigest(input: {
  action: SubmissionAction;
  target: CatalogDatabaseSenseSnapshot | null;
  siblingDigests: string[];
  pendingConflictDigests?: string[];
}): string {
  return sha256(JSON.stringify({
    action: input.action,
    target: input.target ? {
      id: input.target.id,
      catalogKey: input.target.catalogKey,
      senseKey: input.target.senseKey,
      status: input.target.status,
      revision: input.target.revision,
      payloadDigest: payloadFingerprint(input.target.payload),
    } : null,
    siblingDigests: [...input.siblingDigests].sort(),
    pendingConflictDigests: [...(input.pendingConflictDigests ?? [])].sort(),
  }));
}

function addDigest(index: Map<string, Set<string>>, key: string | null, value: string): void {
  if (!key) return;
  const values = index.get(key) ?? new Set<string>();
  values.add(value);
  index.set(key, values);
}

export function buildCatalogPreviewDependencyDigests(
  groups: readonly CatalogSubmissionPreviewGroup[],
  snapshots: readonly CatalogDatabaseSenseSnapshot[],
  pendingChanges: readonly CatalogPendingDependencySnapshot[],
): Map<number, string> {
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const siblingDigestsByTerm = new Map<string, Set<string>>();
  const siblingDigestsByLemma = new Map<string, Set<string>>();
  for (const snapshot of snapshots) {
    const fingerprint = payloadFingerprint(snapshot.payload);
    addDigest(siblingDigestsByTerm, normalizeCatalogText(snapshot.payload.term), fingerprint);
    addDigest(siblingDigestsByLemma, normalizeCatalogText(snapshot.payload.lemma), fingerprint);
  }
  const pendingDigestsBySense = new Map<string, Set<string>>();
  const pendingDigestsByTerm = new Map<string, Set<string>>();
  for (const pending of pendingChanges) {
    addDigest(pendingDigestsBySense, pending.senseId, pending.requestFingerprint);
    addDigest(pendingDigestsByTerm, pending.normalizedTerm, pending.requestFingerprint);
  }
  return new Map(groups.map((group) => {
    const normalizedTerm = normalizeCatalogText(group.finalProposalPayload.term);
    const normalizedLemma = normalizeCatalogText(group.finalProposalPayload.lemma);
    const siblingDigests = new Set([
      ...(siblingDigestsByTerm.get(normalizedTerm) ?? []),
      ...(siblingDigestsByLemma.get(normalizedLemma) ?? []),
    ]);
    const pendingConflictDigests = new Set([
      ...(group.targetSenseId ? pendingDigestsBySense.get(group.targetSenseId) ?? [] : []),
      ...(pendingDigestsByTerm.get(normalizedTerm) ?? []),
    ]);
    return [group.groupNumber, catalogDependencyDigest({
      action: group.requestedAction,
      target: group.targetSenseId ? snapshotById.get(group.targetSenseId) ?? null : null,
      siblingDigests: [...siblingDigests],
      pendingConflictDigests: [...pendingConflictDigests],
    })];
  }));
}

export function buildCatalogSubmissionPreview(
  sourceRows: readonly CatalogSourceRow[],
  databaseSenses: readonly CatalogDatabaseSenseSnapshot[],
  pendingChanges: readonly CatalogPendingChangeSnapshot[] = [],
): CatalogSubmissionPreview {
  const normalized = sourceRows.map((row, index) => normalizeCatalogRow(row, index));
  const sourceByNumber = new Map(sourceRows.map((row) => [row.sourceRow, row]));
  const bySenseKey = new Map(databaseSenses.map((sense) => [sense.senseKey, sense]));
  const siblingRows = normalized;
  const initialRows = normalized.map((row) => {
    const source = sourceByNumber.get(row.sourceRow);
    const validation = validateCatalogRow(row, siblingRows.filter((item) => item !== row && item.normalizedTerm === row.normalizedTerm), "governance", source);
    const action: SubmissionAction = row.requestedAction === "UPDATE" ? "UPDATE" : "CREATE";
    const errors = [...validation.errors];
    let target: CatalogDatabaseSenseSnapshot | null = null;
    if (action === "UPDATE") {
      target = bySenseKey.get(row.senseKey) ?? null;
      if (!target) errors.push("UPDATE target sense does not exist");
      else {
        if (target.catalogKey !== row.catalogKey) errors.push("UPDATE catalog_key does not match current target");
        if (target.revision !== row.recordRevision) errors.push("UPDATE record_revision is stale");
        if (target.status !== row.catalogStatus) errors.push("UPDATE catalog_status is stale");
        if (normalizeCatalogText(target.payload.lemma) !== row.normalizedLemma) errors.push("UPDATE cannot move a sense to another lemma");
        if (pendingChanges.some((pending) => pending.senseId === target?.id || pending.senseKey === target?.senseKey)) errors.push("UPDATE target already has a pending request");
      }
    }
    const proposedPayload = catalogSubmissionProposalPayload(row, target);
    const noChange = action === "UPDATE" && Boolean(target) && payloadFingerprint(target!.payload) === payloadFingerprint(proposedPayload);
    return { row, action, errors, warnings: validation.warnings, payload: proposedPayload, noChange };
  });

  const candidates = initialRows.filter((item) => item.errors.length === 0 && !item.noChange);
  const buckets = new Map<string, typeof candidates>();
  for (const item of candidates) {
    const key = item.action === "UPDATE" ? `UPDATE:${item.row.senseKey}` : `CREATE:${semanticIdentity(item.row)}`;
    const current = buckets.get(key) ?? [];
    current.push(item);
    buckets.set(key, current);
  }

  const createConflictCounts = new Map<string, number>();
  for (const values of buckets.values()) {
    const first = values[0];
    if (first?.action !== "CREATE") continue;
    const key = headwordConflictIdentity(first.row);
    createConflictCounts.set(key, (createConflictCounts.get(key) ?? 0) + 1);
  }

  const groups: CatalogSubmissionPreviewGroup[] = [];
  const groupForRow = new Map<number, number>();
  let groupNumber = 1;
  for (const values of [...buckets.values()].sort((a, b) => a[0]!.row.sourceRow - b[0]!.row.sourceRow)) {
    const first = values[0]!;
    const payloadDigests = new Set(values.map((item) => payloadFingerprint(item.payload)));
    const target = first.action === "UPDATE"
      ? bySenseKey.get(first.row.senseKey) ?? null
      : databaseSenses.find((sense) => semanticIdentity(normalizeCatalogRow({
          ...sourceRows[0]!,
          sourceFile: "database",
          sourceRow: 0,
          requested_action: "CREATE",
          catalog_key: "",
          sense_key: "",
          record_revision: "",
          catalog_status: "",
          term: sense.payload.term,
          lemma: sense.payload.lemma,
          part_of_speech: sense.payload.partOfSpeech,
          level: sense.payload.level,
          category: sense.payload.category,
          definition_zh: sense.payload.definitionZh,
        }, 0)) === semanticIdentity(first.row)) ?? null;
    const ambiguousCreate = first.action === "CREATE" && (createConflictCounts.get(headwordConflictIdentity(first.row)) ?? 0) > 1;
    const pendingCreateConflict = first.action === "CREATE" && pendingChanges.some((pending) => pending.normalizedTerm === first.row.normalizedTerm);
    const needsResolution = payloadDigests.size > 1 || Boolean(target && first.action === "CREATE") || ambiguousCreate || pendingCreateConflict;
    const before = first.action === "UPDATE" ? target?.payload ?? null : null;
    const risk = classifyCatalogReviewRisk(before, first.payload);
    const related = databaseSenses.filter((sense) => normalizeCatalogText(sense.payload.term) === first.row.normalizedTerm || normalizeCatalogText(sense.payload.lemma) === first.row.normalizedLemma);
    const group: CatalogSubmissionPreviewGroup = {
      groupNumber,
      requestedAction: first.action,
      sourceRowNumbers: values.map((item) => item.row.sourceRow),
      resolution: needsResolution ? null : values.length > 1 ? "MERGE" : "KEEP_SEPARATE",
      resolutionReason: needsResolution ? "duplicate or identity conflict requires an explicit decision" : null,
      targetCatalogKey: target?.catalogKey ?? (first.action === "UPDATE" ? first.row.catalogKey : null),
      targetSenseKey: target?.senseKey ?? (first.action === "UPDATE" ? first.row.senseKey : null),
      targetSenseId: target?.id ?? null,
      baseRevision: target?.revision ?? null,
      baseStatus: target?.status ?? null,
      dependencyDigest: catalogDependencyDigest({ action: first.action, target, siblingDigests: related.map((sense) => payloadFingerprint(sense.payload)) }),
      finalProposalPayload: first.payload,
      payloadDigest: payloadFingerprint(first.payload),
      reviewRisk: risk.risk,
      reviewRiskReason: risk.reasons,
      needsResolution,
    };
    groups.push(group);
    for (const item of values) groupForRow.set(item.row.sourceRow, groupNumber);
    groupNumber += 1;
  }

  const previewRows: CatalogSubmissionPreviewRow[] = initialRows.map((item) => {
    const assignedGroup = groupForRow.get(item.row.sourceRow) ?? null;
    const group = groups.find((candidate) => candidate.groupNumber === assignedGroup);
    const isFirst = group?.sourceRowNumbers[0] === item.row.sourceRow;
    const primaryDisposition: CatalogSubmissionPreviewRow["primaryDisposition"] = item.errors.length
      ? "VALIDATION_FAILED"
      : item.noChange
        ? "NO_CHANGE"
      : group?.needsResolution
        ? "CONFLICT"
        : group && group.sourceRowNumbers.length > 1
          ? "DUPLICATE"
          : item.action;
    return {
      rowNumber: item.row.sourceRow,
      rowDigest: item.row.rowDigest,
      requestedAction: item.action,
      primaryDisposition,
      warnings: item.warnings,
      errors: item.errors,
      normalizedTerm: item.row.normalizedTerm,
      normalizedLemma: item.row.normalizedLemma,
      normalizedSourcePayload: item.payload,
      proposalGroupNumber: assignedGroup,
      rowRole: item.errors.length || item.noChange ? "EXCLUDED" : isFirst ? "CANONICAL_SOURCE" : "MERGED_SOURCE",
    };
  });
  const unresolvedGroups = groups.filter((group) => group.needsResolution).length;
  return {
    rows: previewRows,
    groups,
    status: unresolvedGroups ? "NEEDS_RESOLUTION" : "PREVIEW",
    summary: {
      totalRows: previewRows.length,
      validRows: previewRows.filter((row) => row.errors.length === 0).length,
      invalidRows: previewRows.filter((row) => row.errors.length > 0).length,
      proposalGroups: groups.length,
      unresolvedGroups,
      createGroups: groups.filter((group) => group.requestedAction === "CREATE").length,
      updateGroups: groups.filter((group) => group.requestedAction === "UPDATE").length,
    },
  };
}

export function submissionExpiry(now = new Date()): { expiresAt: Date; absoluteExpiresAt: Date } {
  return {
    expiresAt: new Date(now.getTime() + CATALOG_PREVIEW_ACTIVITY_DAYS * 86_400_000),
    absoluteExpiresAt: new Date(now.getTime() + CATALOG_PREVIEW_ABSOLUTE_DAYS * 86_400_000),
  };
}

export function refreshSubmissionExpiry(createdAt: Date, now = new Date()): Date {
  const activity = now.getTime() + CATALOG_PREVIEW_ACTIVITY_DAYS * 86_400_000;
  const absolute = createdAt.getTime() + CATALOG_PREVIEW_ABSOLUTE_DAYS * 86_400_000;
  return new Date(Math.min(activity, absolute));
}

export function isCanonicalUuid(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value));
}

export function deterministicBatchRequestOperationId(batchId: string, groupId: string): string {
  return `catalog-batch-${sha256(`${batchId}\u0000${groupId}`).slice(0, 32)}`;
}

export function deterministicSubmissionProposalGroupId(batchId: string, groupNumber: number): string {
  return `cspg_${sha256(`${batchId}\u0000${groupNumber}`).slice(0, 24)}`;
}

export function catalogActorPseudonym(userId: string): { value: string; keyVersion: string } {
  return {
    value: `catalog-actor-v1:${hashSecurityAuditValue(`catalog-actor-v1:${userId}`)}`,
    keyVersion: auditKeyVersion(),
  };
}

export const CATALOG_SUBMISSION_VERSIONS = {
  schemaVersion: CATALOG_SCHEMA_VERSION,
  validatorVersion: CATALOG_VALIDATOR_VERSION,
  normalizationVersion: CATALOG_NORMALIZATION_VERSION,
  taxonomyDigest: catalogTaxonomyDigest(),
  riskVersion: CATALOG_REVIEW_RISK_VERSION,
} as const;
