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
