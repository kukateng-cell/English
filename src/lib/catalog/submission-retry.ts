import {
  CATALOG_RETRY_MERGE_FIELDS,
  type CatalogRetryMergeField,
} from "./retry-merge";

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
