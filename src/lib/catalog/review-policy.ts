export type CatalogReviewMode = "INDEPENDENT" | "AUTHORIZED_IMMEDIATE_RETIRE";

export interface CatalogReviewSeparationInput {
  mode?: CatalogReviewMode;
  kind: string;
  decision: "APPROVE" | "REJECT";
  batchMode: boolean;
  proposerId: string;
  reviewerId: string;
  lastContentAuthorId?: string | null;
}

/**
 * Ordinary catalog changes need one reviewer who did not author the proposal.
 * The only self-completing path is an authorized, standalone, immediate RETIRE;
 * authorization itself is rechecked by the caller inside the same transaction.
 */
export function assertCatalogReviewSeparation(input: CatalogReviewSeparationInput): void {
  const mode = input.mode ?? "INDEPENDENT";
  if (mode === "AUTHORIZED_IMMEDIATE_RETIRE") {
    if (
      input.kind !== "RETIRE"
      || input.decision !== "APPROVE"
      || input.batchMode
      || input.proposerId !== input.reviewerId
      || input.lastContentAuthorId
    ) {
      throw new Error("CATALOG_IMMEDIATE_RETIRE_POLICY_INVALID");
    }
    return;
  }

  if (input.proposerId === input.reviewerId || input.lastContentAuthorId === input.reviewerId) {
    throw new Error("CATALOG_SELF_REVIEW_FORBIDDEN");
  }
}

export function catalogRequestTerminalStatus(status: string): "APPROVED" | "REJECTED" | "CANCELLED" | null {
  return status === "APPROVED" || status === "REJECTED" || status === "CANCELLED" ? status : null;
}

export function parseCatalogExpectedRevision(value: unknown, required: boolean): number | null {
  if (value === undefined || value === null) {
    if (required) throw new Error("CATALOG_REVISION_REQUIRED");
    return null;
  }
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) throw new Error("CATALOG_REVISION_INVALID");
  return revision;
}
