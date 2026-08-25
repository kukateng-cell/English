import {
  CATALOG_RETRY_MERGE_FIELDS,
  type CatalogRetryMergeField,
} from "./retry-merge";
import type { CatalogSubmissionPreview } from "./submission";

export type CatalogRetryEffectiveKind = "CREATE" | "UPDATE" | "RETIRE" | "REACTIVATE";

export type CatalogRetrySourceGroup = {
  requestedAction: CatalogRetryEffectiveKind;
  resolution: string | null;
  changeRequest: { kind: CatalogRetryEffectiveKind } | null;
};

export function catalogRetryEffectiveKind(group: CatalogRetrySourceGroup): CatalogRetryEffectiveKind {
  return group.changeRequest?.kind
    ?? (group.requestedAction === "CREATE" && group.resolution === "REPLACE_EXISTING"
      ? "UPDATE"
      : group.requestedAction);
}

export function retryableCatalogContentGroups<T extends CatalogRetrySourceGroup>(groups: readonly T[]): T[] {
  return groups.filter((group) => group.resolution !== "REJECT");
}

export function catalogRetryGroupsAreContentOnly(groups: readonly CatalogRetrySourceGroup[]): boolean {
  return groups.every((group) => {
    const kind = catalogRetryEffectiveKind(group);
    return kind === "CREATE" || kind === "UPDATE";
  });
}

export function parseCatalogRetryMergeConflictFields(value: unknown): CatalogRetryMergeField[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.some((field) => typeof field !== "string")) {
    throw new Error("CATALOG_BATCH_RETRY_STALE");
  }
  const requested = new Set(value);
  if ([...requested].some((field) => !CATALOG_RETRY_MERGE_FIELDS.includes(field as CatalogRetryMergeField))) {
    throw new Error("CATALOG_BATCH_RETRY_STALE");
  }
  return CATALOG_RETRY_MERGE_FIELDS.filter((field) => requested.has(field));
}

export function mergeCatalogRetryConflictFields(
  ...groups: readonly (readonly CatalogRetryMergeField[])[]
): CatalogRetryMergeField[] {
  const merged = new Set(groups.flat());
  return CATALOG_RETRY_MERGE_FIELDS.filter((field) => merged.has(field));
}

export function applyCatalogRetryMergeConflicts(
  preview: CatalogSubmissionPreview,
  retryMergeConflicts: ReadonlyMap<number, readonly string[]> | undefined,
): Map<number, CatalogRetryMergeField[]> {
  const retryMergeConflictFieldsByGroup = new Map<number, CatalogRetryMergeField[]>();
  if (!retryMergeConflicts?.size) return retryMergeConflictFieldsByGroup;

  for (const [sourceRowNumber, fields] of retryMergeConflicts) {
    const conflictRow = preview.rows.find((candidate) => candidate.rowNumber === sourceRowNumber);
    if (!conflictRow) throw new Error("CATALOG_BATCH_RETRY_STALE");

    // If the current approved value has caught up with the old proposal, this
    // row no longer needs a human merge decision. Other actionable groups in
    // the same retry preview must still be allowed to proceed.
    if (conflictRow.primaryDisposition === "NO_CHANGE") continue;

    const groupNumber = conflictRow.proposalGroupNumber;
    if (groupNumber === null) throw new Error("CATALOG_BATCH_RETRY_STALE");
    const group = preview.groups.find((candidate) => candidate.groupNumber === groupNumber);
    if (!group) throw new Error("CATALOG_BATCH_RETRY_STALE");

    const normalizedFields = parseCatalogRetryMergeConflictFields(fields);
    if (!normalizedFields.length) throw new Error("CATALOG_BATCH_RETRY_STALE");
    const mergedFields = mergeCatalogRetryConflictFields(
      retryMergeConflictFieldsByGroup.get(groupNumber) ?? [],
      normalizedFields,
    );
    retryMergeConflictFieldsByGroup.set(groupNumber, mergedFields);
    group.needsResolution = true;
    group.resolution = null;
    group.resolutionReason = `retry merge conflict: ${mergedFields.join(", ")}`;
    for (const row of preview.rows) {
      if (row.proposalGroupNumber === groupNumber) row.primaryDisposition = "CONFLICT";
    }
  }

  preview.summary.unresolvedGroups = preview.groups.filter((group) => group.needsResolution).length;
  preview.status = preview.summary.unresolvedGroups ? "NEEDS_RESOLUTION" : preview.status;
  return retryMergeConflictFieldsByGroup;
}
