export const CATALOG_SUBMISSION_PATCH_VERSION = "catalog-submission-patch-v1" as const;

export type CatalogSubmissionBatchPatchState = {
  status: string;
  resolutionOwnerId: string | null;
  reviewerId: string | null;
  resolutionClaimed: boolean;
  reviewClaimed: boolean;
  expiresAt: string;
  absoluteExpiresAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  committedAt: string | null;
};

export type CatalogSubmissionBatchPatch<Group extends { id: string; revision: number }> = {
  version: typeof CATALOG_SUBMISSION_PATCH_VERSION;
  batchId: string;
  baseRevision: number;
  revision: number;
  batch: CatalogSubmissionBatchPatchState;
  group: {
    baseRevision: number;
    value: Group;
  } | null;
};

export type CatalogSubmissionPatchResult<Batch> =
  | { ok: true; batch: Batch; outcome: "APPLIED" | "REPLAY" }
  | { ok: false; reason: "VERSION_MISMATCH" | "BATCH_MISMATCH" | "REVISION_MISMATCH" | "GROUP_MISSING" | "GROUP_REVISION_MISMATCH" };

export function applyCatalogSubmissionBatchPatch<
  Group extends { id: string; revision: number },
  Batch extends CatalogSubmissionBatchPatchState & { id: string; revision: number; groups: Group[] },
>(current: Batch, patch: CatalogSubmissionBatchPatch<Group>): CatalogSubmissionPatchResult<Batch> {
  if (patch.version !== CATALOG_SUBMISSION_PATCH_VERSION) return { ok: false, reason: "VERSION_MISMATCH" };
  if (patch.batchId !== current.id) return { ok: false, reason: "BATCH_MISMATCH" };
  if (patch.revision < patch.baseRevision) return { ok: false, reason: "REVISION_MISMATCH" };

  if (current.revision === patch.revision) {
    if (patch.group) {
      const currentGroup = current.groups.find((group) => group.id === patch.group!.value.id);
      if (!currentGroup) return { ok: false, reason: "GROUP_MISSING" };
      if (currentGroup.revision !== patch.group.value.revision) return { ok: false, reason: "GROUP_REVISION_MISMATCH" };
    }
    return { ok: true, batch: current, outcome: "REPLAY" };
  }

  if (current.revision !== patch.baseRevision || patch.revision <= current.revision) {
    return { ok: false, reason: "REVISION_MISMATCH" };
  }

  let groups = current.groups;
  if (patch.group) {
    const index = groups.findIndex((group) => group.id === patch.group!.value.id);
    if (index < 0) return { ok: false, reason: "GROUP_MISSING" };
    if (groups[index]!.revision !== patch.group.baseRevision || patch.group.value.revision < patch.group.baseRevision) {
      return { ok: false, reason: "GROUP_REVISION_MISMATCH" };
    }
    groups = groups.map((group, groupIndex) => groupIndex === index ? { ...group, ...patch.group!.value } : group);
  }

  return {
    ok: true,
    outcome: "APPLIED",
    batch: {
      ...current,
      ...patch.batch,
      revision: patch.revision,
      groups,
    },
  };
}
