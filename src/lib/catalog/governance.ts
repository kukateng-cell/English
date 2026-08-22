import { createHash } from "node:crypto";
import {
  normalizeCatalogRow,
  normalizeCatalogText,
  validateCatalogRow,
  type CatalogSourceRow,
  type CatalogLevel,
  type NormalizedCatalogRow,
} from "./csv";
import { isCatalogCategory } from "./taxonomy";

export interface CatalogGovernancePayload {
  term: string;
  lemma: string;
  partOfSpeech: string;
  level: CatalogLevel;
  category: string;
  definitionZh: string;
  acceptedAnswersZh: string[];
  phoneticIpa: string | null;
  exampleEn: string | null;
  exampleZh: string | null;
  acceptedFormsEn: string[];
  synonymsEn: string[];
  antonymsEn: string[];
  enableEnToZh: boolean;
  distractorZh: string[];
  enableZhToEn: boolean;
  distractorEn: string[];
  retirementReason: string | null;
}

export interface CatalogIdentityInput {
  catalogKey: string;
  senseKey: string;
  sourceFile: string;
  sourceRow: number;
}

export interface CatalogPayloadValidation {
  payload: CatalogGovernancePayload;
  row: NormalizedCatalogRow;
  errors: string[];
  warnings: string[];
}

const MAX_TEXT = 500;
const MAX_LIST_ITEMS = 12;
const MAX_LIST_ITEM_TEXT = 180;

function cleanText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function parseText(value: unknown, field: string, options: { required?: boolean; max?: number } = {}): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const result = cleanText(value);
  if (options.required !== false && !result) throw new Error(`${field} is required`);
  if (result.length > (options.max ?? MAX_TEXT)) throw new Error(`${field} is too long`);
  return result;
}

function parseNullableText(value: unknown, field: string, max = MAX_TEXT): string | null {
  if (value === null || value === undefined || value === "") return null;
  return parseText(value, field, { required: false, max }) || null;
}

function parseList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (value.length > MAX_LIST_ITEMS) throw new Error(`${field} has too many items`);
  const items = value.map((item, index) => parseText(item, `${field}[${index}]`, { max: MAX_LIST_ITEM_TEXT }));
  const normalized = items.map(normalizeCatalogText);
  if (new Set(normalized).size !== normalized.length) throw new Error(`${field} contains duplicates`);
  return items;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}

function parseLevel(value: unknown): CatalogLevel {
  if (value === "A1" || value === "A2" || value === "B1" || value === "B2") return value;
  throw new Error("level must be A1, A2, B1 or B2");
}

export function parseCatalogGovernancePayload(value: unknown): CatalogGovernancePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("payload must be an object");
  const input = value as Record<string, unknown>;
  const payload: CatalogGovernancePayload = {
    term: parseText(input.term, "term", { max: 120 }),
    lemma: parseText(input.lemma, "lemma", { max: 120 }),
    partOfSpeech: parseText(input.partOfSpeech, "partOfSpeech", { max: 80 }),
    level: parseLevel(input.level),
    category: parseText(input.category, "category", { max: 80 }),
    definitionZh: parseText(input.definitionZh, "definitionZh", { max: 500 }),
    acceptedAnswersZh: parseList(input.acceptedAnswersZh, "acceptedAnswersZh"),
    phoneticIpa: parseNullableText(input.phoneticIpa, "phoneticIpa", 180),
    exampleEn: parseNullableText(input.exampleEn, "exampleEn", 500),
    exampleZh: parseNullableText(input.exampleZh, "exampleZh", 500),
    acceptedFormsEn: parseList(input.acceptedFormsEn, "acceptedFormsEn"),
    synonymsEn: parseList(input.synonymsEn, "synonymsEn"),
    antonymsEn: parseList(input.antonymsEn, "antonymsEn"),
    enableEnToZh: parseBoolean(input.enableEnToZh, "enableEnToZh"),
    distractorZh: parseList(input.distractorZh, "distractorZh"),
    enableZhToEn: parseBoolean(input.enableZhToEn, "enableZhToEn"),
    distractorEn: parseList(input.distractorEn, "distractorEn"),
    retirementReason: parseNullableText(input.retirementReason, "retirementReason", 500),
  };
  return payload;
}

export function payloadToSourceRow(payload: CatalogGovernancePayload, identity: CatalogIdentityInput, revision: number): CatalogSourceRow {
  return {
    sourceFile: identity.sourceFile,
    sourceRow: identity.sourceRow,
    schema_version: "word-catalog-v1",
    requested_action: "CREATE_DRAFT",
    catalog_key: identity.catalogKey,
    sense_key: identity.senseKey,
    record_revision: String(revision),
    catalog_status: "DRAFT",
    term: payload.term,
    lemma: payload.lemma,
    part_of_speech: payload.partOfSpeech,
    level: payload.level,
    category: payload.category,
    definition_zh: payload.definitionZh,
    accepted_answers_zh: payload.acceptedAnswersZh.join("|"),
    prompt_en: "",
    prompt_zh: "",
    phonetic_ipa: payload.phoneticIpa ?? "",
    example_en: payload.exampleEn ?? "",
    example_zh: payload.exampleZh ?? "",
    accepted_forms_en: payload.acceptedFormsEn.join("|"),
    synonyms_en: payload.synonymsEn.join("|"),
    antonyms_en: payload.antonymsEn.join("|"),
    enable_en_to_zh: String(payload.enableEnToZh).toUpperCase(),
    distractor_zh_1: payload.distractorZh[0] ?? "",
    distractor_zh_2: payload.distractorZh[1] ?? "",
    distractor_zh_3: payload.distractorZh[2] ?? "",
    distractor_zh_4: payload.distractorZh[3] ?? "",
    distractor_zh_5: payload.distractorZh[4] ?? "",
    distractor_zh_6: payload.distractorZh[5] ?? "",
    enable_zh_to_en: String(payload.enableZhToEn).toUpperCase(),
    distractor_en_1: payload.distractorEn[0] ?? "",
    distractor_en_2: payload.distractorEn[1] ?? "",
    distractor_en_3: payload.distractorEn[2] ?? "",
    distractor_en_4: payload.distractorEn[3] ?? "",
    distractor_en_5: payload.distractorEn[4] ?? "",
    distractor_en_6: payload.distractorEn[5] ?? "",
    source_reference: "",
    contributor_ref: "",
    change_note: "",
    retirement_reason: payload.retirementReason ?? "",
  };
}

export function validateCatalogGovernancePayload(
  payload: CatalogGovernancePayload,
  identity: CatalogIdentityInput,
  revision: number,
  siblings: readonly NormalizedCatalogRow[] = [],
): CatalogPayloadValidation {
  const row = normalizeCatalogRow(payloadToSourceRow(payload, identity, revision), 0);
  const result = validateCatalogRow(row, siblings);
  const errors = [...result.errors];
  if (!isCatalogCategory(row.category)) errors.push(`unknown category: ${row.category}`);
  return { payload, row, errors, warnings: result.warnings };
}

/** CatalogEntry is the stable headword boundary shared by all of its senses. */
export function catalogEntryAcceptsLemma(
  existingNormalizedLemma: string,
  proposedLemma: string,
): boolean {
  return existingNormalizedLemma === normalizeCatalogText(proposedLemma);
}

export interface CatalogEntryIdentityCandidate {
  id: string;
  catalogKey: string;
  normalizedLemma: string;
}

export function resolveExistingCatalogEntryForLemma(
  proposedLemma: string,
  entryByKey: CatalogEntryIdentityCandidate | null,
  entryByLemma: CatalogEntryIdentityCandidate | null,
): CatalogEntryIdentityCandidate | null {
  if (entryByKey && !catalogEntryAcceptsLemma(entryByKey.normalizedLemma, proposedLemma)) {
    throw new Error("CATALOG_ENTRY_IDENTITY_CONFLICT");
  }
  if (entryByKey && entryByLemma && entryByKey.id !== entryByLemma.id) {
    throw new Error("CATALOG_ENTRY_IDENTITY_CONFLICT");
  }
  return entryByKey ?? entryByLemma;
}

export function payloadFromRevision(revision: {
  term: string;
  lemma: string;
  pos: string | null;
  level: CatalogLevel;
  category: string;
  definitionZh: string;
  acceptedAnswersZh: string[];
  phoneticIpa: string | null;
  exampleEn: string | null;
  exampleZh: string | null;
  acceptedFormsEn: string[];
  synonymsEn: string[];
  antonymsEn: string[];
  enableEnToZh: boolean;
  distractorZh: string[];
  enableZhToEn: boolean;
  distractorEn: string[];
  retirementReason: string | null;
}): CatalogGovernancePayload {
  return {
    term: revision.term,
    lemma: revision.lemma,
    partOfSpeech: revision.pos ?? "",
    level: revision.level,
    category: revision.category,
    definitionZh: revision.definitionZh,
    acceptedAnswersZh: revision.acceptedAnswersZh,
    phoneticIpa: revision.phoneticIpa,
    exampleEn: revision.exampleEn,
    exampleZh: revision.exampleZh,
    acceptedFormsEn: revision.acceptedFormsEn,
    synonymsEn: revision.synonymsEn,
    antonymsEn: revision.antonymsEn,
    enableEnToZh: revision.enableEnToZh,
    distractorZh: revision.distractorZh,
    enableZhToEn: revision.enableZhToEn,
    distractorEn: revision.distractorEn,
    retirementReason: revision.retirementReason,
  };
}

export function payloadFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function revisionContentDigest(payload: CatalogGovernancePayload): string {
  return payloadFingerprint(payload);
}

export function splitListForEditor(value: string[] | null | undefined): string {
  return (value ?? []).join(" | ");
}

export function parseEditorList(value: string): string[] {
  return value.split("|").map((item) => cleanText(item)).filter(Boolean);
}
