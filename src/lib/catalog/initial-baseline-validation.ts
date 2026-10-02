/** Frozen bootstrap approval rule from 062fe4a. NOT the editor validator.
 * Selection must still match the checked-in approved source/count/set digests.
 * Relaxing daily rules does not grant approval to historical rejected rows.
 */
import { CATALOG_SCHEMA_VERSION, normalizeCatalogText, type NormalizedCatalogRow, type CatalogDirection, type CatalogRowValidation } from "./csv";
import { catalogLegacyValidationIssue } from "./csv";
const validLevel = (value: string) => ["A1", "A2", "B1", "B2"].includes(value);
const directionCandidates = (row: NormalizedCatalogRow, direction: CatalogDirection) => direction === "en-zh" ? row.distractorZh : row.distractorEn;
const directionAnswer = (row: NormalizedCatalogRow, direction: CatalogDirection) => direction === "en-zh" ? row.definitionZh : row.term;
export function validateInitialBaselineRow(row: NormalizedCatalogRow, siblingRows: readonly NormalizedCatalogRow[] = []): CatalogRowValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  errors.push(...row.parseErrors);
  if (row.schemaVersion !== CATALOG_SCHEMA_VERSION) errors.push("unsupported schema_version");
  if (!row.term) errors.push("term is required");
  if (!row.lemma) errors.push("lemma is required");
  if (!row.partOfSpeech) errors.push("part_of_speech is required");
  if (!validLevel(row.level)) errors.push("level must be A1, A2, B1 or B2");
  if (!row.category) errors.push("category is required");
  if (!row.definitionZh) errors.push("definition_zh is required");
  if (row.promptEn || row.promptZh) errors.push("prompt_en/prompt_zh must be empty; prompts are server-owned");
  if (row.catalogStatus && row.catalogStatus !== "DRAFT") errors.push("catalog_status must be empty or DRAFT for CSV bootstrap");
  if (row.requestedAction !== "CREATE_DRAFT") errors.push("requested_action must be CREATE_DRAFT for CSV bootstrap");
  if (row.exampleEn && !row.exampleZh) errors.push("example_zh is required when example_en is present");
  if (row.exampleZh && !row.exampleEn) errors.push("example_en is required when example_zh is present");

  const directionChecks: Array<[CatalogDirection, boolean]> = [["en-zh", row.enableEnToZh], ["zh-en", row.enableZhToEn]];
  for (const [direction, enabled] of directionChecks) {
    if (!enabled) continue;
    const candidates = directionCandidates(row, direction);
    const normalizedCandidates = candidates.map(normalizeCatalogText);
    const answer = normalizeCatalogText(directionAnswer(row, direction));
    if (candidates.length < 5 || candidates.length > 6) errors.push(`${direction} requires 5 or 6 distractors`);
    if (new Set(normalizedCandidates).size !== normalizedCandidates.length) errors.push(`${direction} has duplicate distractors`);
    if (normalizedCandidates.includes(answer)) errors.push(`${direction} distractor collides with canonical answer`);
    const sameRowAnswers = direction === "en-zh"
      ? row.acceptedAnswersZh
      : [row.acceptedFormsEn, row.synonymsEn, row.antonymsEn].flat();
    if (normalizedCandidates.some((candidate) => sameRowAnswers.map(normalizeCatalogText).includes(candidate))) errors.push(`${direction} distractor collides with an accepted answer or answer-safety synonym/antonym`);
    const siblingAnswers = siblingRows.flatMap((sibling) => [directionAnswer(sibling, direction), ...(direction === "en-zh" ? sibling.acceptedAnswersZh : [sibling.acceptedFormsEn, sibling.synonymsEn, sibling.antonymsEn].flat())]).map(normalizeCatalogText);
    if (normalizedCandidates.some((candidate) => siblingAnswers.includes(candidate))) errors.push(`${direction} distractor collides with a sibling-sense answer`);
  }
  if (!row.enableEnToZh && !row.enableZhToEn) warnings.push("both directions are disabled");
  const directionEligible = (row.enableEnToZh || row.enableZhToEn) && errors.length === 0;
  return {
    errors,
    warnings,
    issues: [...errors.map(message => catalogLegacyValidationIssue(message, "ERROR")), ...warnings.map(message => catalogLegacyValidationIssue(message, "WARNING"))],
    directionEligible,
    eligibility: directionEligible
      ? "ACTIVATION_ELIGIBLE"
      : "DRAFT_BLOCKED",
  };
}
