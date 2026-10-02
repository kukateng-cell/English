import type { CatalogGovernancePayload } from "./governance";

export const CATALOG_RETRY_MERGE_FIELDS = [
  "term",
  "lemma",
  "partOfSpeech",
  "level",
  "category",
  "definitionZh",
  "acceptedAnswersZh",
  "phoneticIpa",
  "exampleEn",
  "exampleZh",
  "acceptedFormsEn",
  "synonymsEn",
  "antonymsEn",
  "enableEnToZh",
  "distractorZh",
  "enableZhToEn",
  "distractorEn",
  "sourceReference",
  "contributorRef",
  "changeNote",
  "retirementReason",
] as const satisfies readonly (keyof CatalogGovernancePayload)[];

export type CatalogRetryMergeField = (typeof CATALOG_RETRY_MERGE_FIELDS)[number];
export type CatalogRetryConflictChoice = "CURRENT" | "PROPOSAL";
export type CatalogRetryConflictChoices = Partial<Record<CatalogRetryMergeField, CatalogRetryConflictChoice>>;
export type CatalogRetryPayloadPatch = Partial<Pick<CatalogGovernancePayload, CatalogRetryMergeField>>;

export type CatalogRetryMergeConflict = {
  field: CatalogRetryMergeField;
  base: CatalogGovernancePayload[CatalogRetryMergeField];
  proposal: CatalogGovernancePayload[CatalogRetryMergeField];
  current: CatalogGovernancePayload[CatalogRetryMergeField];
};

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function threeWayMergeCatalogPayload(input: {
  base: CatalogGovernancePayload;
  proposal: CatalogGovernancePayload;
  current: CatalogGovernancePayload;
  choices?: CatalogRetryConflictChoices;
}): {
  payload: CatalogGovernancePayload;
  conflicts: CatalogRetryMergeConflict[];
  unresolvedFields: CatalogRetryMergeField[];
} {
  const payload = { ...input.current } as CatalogGovernancePayload;
  const conflicts: CatalogRetryMergeConflict[] = [];
  const unresolvedFields: CatalogRetryMergeField[] = [];

  for (const field of CATALOG_RETRY_MERGE_FIELDS) {
    const baseValue = input.base[field];
    const proposalValue = input.proposal[field];
    const currentValue = input.current[field];
    if (sameValue(proposalValue, baseValue)) {
      Object.assign(payload, { [field]: currentValue });
      continue;
    }
    if (sameValue(currentValue, baseValue) || sameValue(currentValue, proposalValue)) {
      Object.assign(payload, { [field]: proposalValue });
      continue;
    }

    conflicts.push({ field, base: baseValue, proposal: proposalValue, current: currentValue });
    const choice = input.choices?.[field];
    if (!choice) unresolvedFields.push(field);
    Object.assign(payload, { [field]: choice === "PROPOSAL" ? proposalValue : currentValue });
  }

  return { payload, conflicts, unresolvedFields };
}

export function catalogRetryPayloadPatch(
  baseline: CatalogGovernancePayload,
  edited: CatalogGovernancePayload,
): CatalogRetryPayloadPatch {
  return Object.fromEntries(
    CATALOG_RETRY_MERGE_FIELDS
      .filter((field) => !sameValue(baseline[field], edited[field]))
      .map((field) => [field, edited[field]]),
  ) as CatalogRetryPayloadPatch;
}

export function applyCatalogRetryPayloadPatch(
  payload: CatalogGovernancePayload,
  patch: CatalogRetryPayloadPatch,
): CatalogGovernancePayload {
  return { ...payload, ...patch };
}

export function parseCatalogRetryConflictChoices(value: unknown): CatalogRetryConflictChoices {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("CATALOG_REQUEST_RETRY_RESOLUTION_INVALID");
  const source = value as Record<string, unknown>;
  const allowed = new Set<string>(CATALOG_RETRY_MERGE_FIELDS);
  if (Object.keys(source).some((field) => !allowed.has(field))) throw new Error("CATALOG_REQUEST_RETRY_RESOLUTION_INVALID");
  const result: CatalogRetryConflictChoices = {};
  for (const [field, choice] of Object.entries(source)) {
    if (choice !== "CURRENT" && choice !== "PROPOSAL") throw new Error("CATALOG_REQUEST_RETRY_RESOLUTION_INVALID");
    result[field as CatalogRetryMergeField] = choice;
  }
  return result;
}

export function parseCatalogRetryPayloadPatch(value: unknown): CatalogRetryPayloadPatch {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("CATALOG_REQUEST_RETRY_PATCH_INVALID");
  const source = value as Record<string, unknown>;
  const allowed = new Set<string>(CATALOG_RETRY_MERGE_FIELDS);
  if (Object.keys(source).some((field) => !allowed.has(field))) throw new Error("CATALOG_REQUEST_RETRY_PATCH_INVALID");
  return { ...source } as CatalogRetryPayloadPatch;
}
