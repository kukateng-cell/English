import { normalizeCatalogText } from "./csv";
import type { CatalogGovernancePayload } from "./governance";

export type CatalogSenseComparable = {
  term?: unknown;
  lemma?: unknown;
  pos?: unknown;
  partOfSpeech?: unknown;
  definitionZh?: unknown;
};

export function catalogSameSense(
  payload: Pick<
    CatalogGovernancePayload,
    "term" | "lemma" | "partOfSpeech" | "definitionZh"
  >,
  candidate: unknown,
): boolean {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return false;
  const value = candidate as CatalogSenseComparable;
  const candidateLemma =
    typeof value.lemma === "string"
      ? value.lemma
      : typeof value.term === "string"
        ? value.term
        : "";
  const candidateDefinition =
    typeof value.definitionZh === "string" ? value.definitionZh : "";
  const candidatePos =
    typeof value.partOfSpeech === "string"
      ? value.partOfSpeech
      : typeof value.pos === "string"
        ? value.pos
        : "";

  return (
    normalizeCatalogText(candidateLemma) ===
      normalizeCatalogText(payload.lemma) &&
    normalizeCatalogText(candidateDefinition) ===
      normalizeCatalogText(payload.definitionZh) &&
    normalizeCatalogText(candidatePos) ===
      normalizeCatalogText(payload.partOfSpeech)
  );
}

export function catalogExactConflict(
  payload: Pick<
    CatalogGovernancePayload,
    "term" | "lemma" | "partOfSpeech" | "definitionZh"
  >,
  existingCandidates: readonly unknown[],
  pendingCandidates: readonly unknown[],
): "EXISTING" | "PENDING" | null {
  if (existingCandidates.some((candidate) => catalogSameSense(payload, candidate)))
    return "EXISTING";
  if (pendingCandidates.some((candidate) => catalogSameSense(payload, candidate)))
    return "PENDING";
  return null;
}
