import { createHash } from "node:crypto";

export const CATALOG_SCHEMA_VERSION = "word-catalog-v1" as const;
export const CATALOG_VALIDATOR_VERSION = "catalog-validator-v1" as const;
export const CATALOG_NORMALIZATION_VERSION = "catalog-normalization-v1" as const;

export const CATALOG_HEADERS = [
  "schema_version",
  "requested_action",
  "catalog_key",
  "sense_key",
  "record_revision",
  "catalog_status",
  "term",
  "lemma",
  "part_of_speech",
  "level",
  "category",
  "definition_zh",
  "accepted_answers_zh",
  "prompt_en",
  "prompt_zh",
  "phonetic_ipa",
  "example_en",
  "example_zh",
  "accepted_forms_en",
  "synonyms_en",
  "antonyms_en",
  "enable_en_to_zh",
  "distractor_zh_1",
  "distractor_zh_2",
  "distractor_zh_3",
  "distractor_zh_4",
  "distractor_zh_5",
  "distractor_zh_6",
  "enable_zh_to_en",
  "distractor_en_1",
  "distractor_en_2",
  "distractor_en_3",
  "distractor_en_4",
  "distractor_en_5",
  "distractor_en_6",
  "source_reference",
  "contributor_ref",
  "change_note",
  "retirement_reason",
] as const;

export type CatalogHeader = (typeof CATALOG_HEADERS)[number];
export type CatalogLevel = "A1" | "A2" | "B1" | "B2";
export type CatalogDirection = "en-zh" | "zh-en";
export type CatalogPrimaryDisposition =
  | "CREATED_DRAFT"
  | "MERGED"
  | "NO_CHANGE"
  | "CONFLICT"
  | "VALIDATION_FAILED";
export type CatalogActivationResult =
  | "ACTIVATION_ELIGIBLE"
  | "DRAFT_BLOCKED";

export interface CatalogSourceRow {
  sourceFile: string;
  sourceRow: number;
  schema_version: string;
  requested_action: string;
  catalog_key: string;
  sense_key: string;
  record_revision: string;
  catalog_status: string;
  term: string;
  lemma: string;
  part_of_speech: string;
  level: string;
  category: string;
  definition_zh: string;
  accepted_answers_zh: string;
  prompt_en: string;
  prompt_zh: string;
  phonetic_ipa: string;
  example_en: string;
  example_zh: string;
  accepted_forms_en: string;
  synonyms_en: string;
  antonyms_en: string;
  enable_en_to_zh: string;
  distractor_zh_1: string;
  distractor_zh_2: string;
  distractor_zh_3: string;
  distractor_zh_4: string;
  distractor_zh_5: string;
  distractor_zh_6: string;
  enable_zh_to_en: string;
  distractor_en_1: string;
  distractor_en_2: string;
  distractor_en_3: string;
  distractor_en_4: string;
  distractor_en_5: string;
  distractor_en_6: string;
  source_reference: string;
  contributor_ref: string;
  change_note: string;
  retirement_reason: string;
}

export interface NormalizedCatalogRow {
  sourceFile: string;
  sourceRow: number;
  schemaVersion: string;
  requestedAction: string;
  catalogKey: string;
  senseKey: string;
  recordRevision: number | null;
  catalogStatus: string;
  term: string;
  normalizedTerm: string;
  lemma: string;
  normalizedLemma: string;
  partOfSpeech: string;
  level: CatalogLevel;
  category: string;
  definitionZh: string;
  acceptedAnswersZh: string[];
  promptEn: string;
  promptZh: string;
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
  sourceReference: string | null;
  contributorRef: string | null;
  changeNote: string | null;
  retirementReason: string | null;
  rowDigest: string;
  parseErrors: string[];
}

export interface CatalogRowValidation {
  errors: string[];
  warnings: string[];
  directionEligible: boolean;
  eligibility: CatalogActivationResult;
}

export interface CatalogImportReport {
  sourceFile: string;
  rows: number;
  primaryDisposition: Record<CatalogPrimaryDisposition, number>;
  eligibility: Record<CatalogActivationResult, number>;
  errors: number;
  warnings: number;
}

export const CATALOG_GOVERNANCE_MAX_BYTES = 5 * 1024 * 1024;
export const CATALOG_GOVERNANCE_MAX_ROWS = 200;
export type CatalogValidationMode = "bootstrap" | "governance";

export class CatalogCsvError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CatalogCsvError";
  }
}

function csvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field.replace(/\r$/u, ""));
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field.replace(/\r$/u, ""));
    records.push(record);
  }
  return records;
}

function strictCsvRecords(text: string, sourceFile: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (closedQuote) {
      if (char === ",") {
        record.push(field);
        field = "";
        closedQuote = false;
      } else if (char === "\n") {
        record.push(field.replace(/\r$/u, ""));
        records.push(record);
        record = [];
        field = "";
        closedQuote = false;
      } else if (char !== "\r") {
        throw new CatalogCsvError("CATALOG_CSV_QUOTING_INVALID", `${sourceFile}: unexpected character after closing quote`);
      }
      continue;
    }
    if (char === '"') {
      if (field.length > 0) throw new CatalogCsvError("CATALOG_CSV_QUOTING_INVALID", `${sourceFile}: quote inside an unquoted field`);
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field.replace(/\r$/u, ""));
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new CatalogCsvError("CATALOG_CSV_QUOTING_INVALID", `${sourceFile}: unclosed quoted field`);
  if (field.length > 0 || record.length > 0 || closedQuote) {
    record.push(field.replace(/\r$/u, ""));
    records.push(record);
  }
  return records;
}

function clean(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function normalizeCatalogText(value: string): string {
  return clean(value).toLocaleLowerCase("en-US");
}

function parseList(value: string): string[] {
  return clean(value)
    .split("|")
    .map((item) => clean(item))
    .filter((item) => item.length > 0);
}

function parseBoolean(value: string, field: string, errors: string[]): boolean {
  const normalized = clean(value).toUpperCase();
  if (normalized === "") return false;
  if (normalized === "TRUE") return true;
  if (normalized === "FALSE") return false;
  errors.push(`${field} must be TRUE or FALSE`);
  return false;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function parseCatalogCsv(text: string, sourceFile: string): CatalogSourceRow[] {
  const records = csvRecords(text.replace(/^\uFEFF/u, ""));
  const header = records[0]?.map((value) => clean(value));
  if (!header || header.length !== CATALOG_HEADERS.length || header.some((value, index) => value !== CATALOG_HEADERS[index])) {
    throw new Error(`${sourceFile}: CSV header must match word-catalog-v1 exactly (${CATALOG_HEADERS.length} columns).`);
  }

  return records.slice(1).flatMap((values, index) => {
    if (values.length === 1 && clean(values[0]) === "") return [];
    if (values.length !== CATALOG_HEADERS.length) {
      throw new Error(`${sourceFile}: row ${index + 2} has ${values.length} columns; expected ${CATALOG_HEADERS.length}.`);
    }
    const row = Object.fromEntries(CATALOG_HEADERS.map((key, keyIndex) => [key, values[keyIndex] ?? ""])) as unknown as CatalogSourceRow;
    return [{ ...row, sourceFile, sourceRow: index + 2 }];
  });
}

function governanceText(bytes: Uint8Array, sourceFile: string): string {
  if (bytes.byteLength > CATALOG_GOVERNANCE_MAX_BYTES) {
    throw new CatalogCsvError("CATALOG_CSV_TOO_LARGE", `${sourceFile}: CSV exceeds 5 MiB`);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CatalogCsvError("CATALOG_CSV_UTF8_INVALID", `${sourceFile}: CSV must be valid UTF-8`);
  }
  if (text.includes("\uFFFD")) throw new CatalogCsvError("CATALOG_CSV_UTF8_INVALID", `${sourceFile}: replacement characters are not accepted`);
  if (/\u0000/u.test(text) || /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) {
    throw new CatalogCsvError("CATALOG_CSV_CONTROL_CHARACTER", `${sourceFile}: CSV contains a disallowed control character`);
  }
  const withoutLeadingBom = text.replace(/^\uFEFF/u, "");
  if (withoutLeadingBom.includes("\uFEFF")) {
    throw new CatalogCsvError("CATALOG_CSV_EMBEDDED_BOM", `${sourceFile}: embedded BOM is not accepted`);
  }
  return withoutLeadingBom;
}

function dangerousFormula(value: string): boolean {
  const trimmed = value.trimStart();
  if (/^[=+@]/u.test(trimmed)) return true;
  return /^-\d/u.test(trimmed);
}

/** Strict, header-name based parser for teacher governance uploads. */
export function parseCatalogGovernanceCsv(bytes: Uint8Array, sourceFile: string): CatalogSourceRow[] {
  const records = strictCsvRecords(governanceText(bytes, sourceFile), sourceFile);
  const header = records[0]?.map((value) => clean(value));
  if (!header || header.length !== CATALOG_HEADERS.length) {
    throw new CatalogCsvError("CATALOG_CSV_HEADER_INVALID", `${sourceFile}: expected ${CATALOG_HEADERS.length} headers`);
  }
  if (new Set(header).size !== header.length) {
    throw new CatalogCsvError("CATALOG_CSV_HEADER_DUPLICATE", `${sourceFile}: duplicate header`);
  }
  const required = new Set<string>(CATALOG_HEADERS);
  if (header.some((value) => !required.has(value)) || CATALOG_HEADERS.some((value) => !header.includes(value))) {
    throw new CatalogCsvError("CATALOG_CSV_HEADER_INVALID", `${sourceFile}: header names must match word-catalog-v1`);
  }
  const rows = records.slice(1).flatMap((values, index) => {
    if (values.length === 1 && clean(values[0]) === "") return [];
    if (values.length !== header.length) {
      throw new CatalogCsvError("CATALOG_CSV_COLUMN_COUNT_INVALID", `${sourceFile}: row ${index + 2} has ${values.length} columns; expected ${header.length}`);
    }
    const record = Object.fromEntries(header.map((key, keyIndex) => [key, values[keyIndex] ?? ""])) as unknown as CatalogSourceRow;
    for (const key of CATALOG_HEADERS) {
      if (dangerousFormula(record[key])) {
        throw new CatalogCsvError("CATALOG_CSV_FORMULA_INVALID", `${sourceFile}: row ${index + 2} field ${key} begins with a spreadsheet formula marker`);
      }
    }
    return [{ ...record, sourceFile, sourceRow: index + 2 }];
  });
  if (rows.length === 0) throw new CatalogCsvError("CATALOG_CSV_EMPTY", `${sourceFile}: CSV has no data rows`);
  if (rows.length > CATALOG_GOVERNANCE_MAX_ROWS) {
    throw new CatalogCsvError("CATALOG_CSV_TOO_MANY_ROWS", `${sourceFile}: CSV exceeds ${CATALOG_GOVERNANCE_MAX_ROWS} rows`);
  }
  return rows;
}

function validLevel(value: string): value is CatalogLevel {
  return value === "A1" || value === "A2" || value === "B1" || value === "B2";
}

function directionCandidates(row: NormalizedCatalogRow, direction: CatalogDirection): string[] {
  return direction === "en-zh" ? row.distractorZh : row.distractorEn;
}

function directionAnswer(row: NormalizedCatalogRow, direction: CatalogDirection): string {
  return direction === "en-zh" ? row.definitionZh : row.term;
}

export function normalizeCatalogRow(row: CatalogSourceRow, ordinal: number): NormalizedCatalogRow {
  const parseErrors: string[] = [];
  const term = clean(row.term);
  const lemma = clean(row.lemma) || term;
  const normalizedTerm = normalizeCatalogText(term);
  const normalizedLemma = normalizeCatalogText(lemma);
  const partOfSpeech = clean(row.part_of_speech);
  const level = clean(row.level).toUpperCase();
  const category = clean(row.category);
  const definitionZh = clean(row.definition_zh);
  const catalogKey = clean(row.catalog_key) || `cat_${sha256(normalizedLemma).slice(0, 24)}`;
  const senseIdentity = `${normalizedTerm}\0${partOfSpeech.toLocaleLowerCase("en-US")}\0${level}\0${category.toLocaleLowerCase("en-US")}\0${ordinal}`;
  const senseKey = clean(row.sense_key) || `sense_${sha256(senseIdentity).slice(0, 24)}`;
  const revisionText = clean(row.record_revision);
  const parsedRevision = revisionText === "" ? null : Number(revisionText);
  const validRecordRevision = parsedRevision !== null && Number.isInteger(parsedRevision) && parsedRevision >= 1;
  if (revisionText !== "" && !validRecordRevision) parseErrors.push("record_revision must be a positive integer");
  const rowDigest = sha256(JSON.stringify(row));
  return {
    sourceFile: row.sourceFile,
    sourceRow: row.sourceRow,
    schemaVersion: clean(row.schema_version),
    requestedAction: clean(row.requested_action),
    catalogKey,
    senseKey,
    recordRevision: validRecordRevision ? parsedRevision : null,
    catalogStatus: clean(row.catalog_status),
    term,
    normalizedTerm,
    lemma,
    normalizedLemma,
    partOfSpeech,
    level: level as CatalogLevel,
    category,
    definitionZh,
    acceptedAnswersZh: parseList(row.accepted_answers_zh),
    promptEn: clean(row.prompt_en),
    promptZh: clean(row.prompt_zh),
    phoneticIpa: clean(row.phonetic_ipa) || null,
    exampleEn: clean(row.example_en) || null,
    exampleZh: clean(row.example_zh) || null,
    acceptedFormsEn: parseList(row.accepted_forms_en),
    synonymsEn: parseList(row.synonyms_en),
    antonymsEn: parseList(row.antonyms_en),
    enableEnToZh: parseBoolean(row.enable_en_to_zh, "enable_en_to_zh", parseErrors),
    distractorZh: [row.distractor_zh_1, row.distractor_zh_2, row.distractor_zh_3, row.distractor_zh_4, row.distractor_zh_5, row.distractor_zh_6].map(clean).filter(Boolean),
    enableZhToEn: parseBoolean(row.enable_zh_to_en, "enable_zh_to_en", parseErrors),
    distractorEn: [row.distractor_en_1, row.distractor_en_2, row.distractor_en_3, row.distractor_en_4, row.distractor_en_5, row.distractor_en_6].map(clean).filter(Boolean),
    sourceReference: clean(row.source_reference) || null,
    contributorRef: clean(row.contributor_ref) || null,
    changeNote: clean(row.change_note) || null,
    retirementReason: clean(row.retirement_reason) || null,
    rowDigest,
    parseErrors,
  };
}

export function validateCatalogRow(
  row: NormalizedCatalogRow,
  siblingRows: readonly NormalizedCatalogRow[] = [],
  mode: CatalogValidationMode = "bootstrap",
  sourceRow?: CatalogSourceRow,
): CatalogRowValidation {
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
  if (mode === "bootstrap") {
    if (row.catalogStatus && row.catalogStatus !== "DRAFT") errors.push("catalog_status must be empty or DRAFT for CSV bootstrap");
    if (row.requestedAction !== "CREATE_DRAFT") errors.push("requested_action must be CREATE_DRAFT for CSV bootstrap");
  } else {
    if (row.requestedAction !== "CREATE" && row.requestedAction !== "UPDATE") errors.push("requested_action must be CREATE or UPDATE for governance submission");
    if (row.retirementReason) errors.push("retirement_reason must be empty for CREATE/UPDATE governance submission");
    if (!sourceRow) {
      errors.push("governance validation requires source metadata");
    } else if (row.requestedAction === "CREATE") {
      if ([sourceRow.catalog_key, sourceRow.sense_key, sourceRow.record_revision, sourceRow.catalog_status].some((value) => clean(value) !== "")) {
        errors.push("CREATE system identity fields must be empty");
      }
    } else if (row.requestedAction === "UPDATE") {
      if (!clean(sourceRow.catalog_key) || !clean(sourceRow.sense_key)) errors.push("UPDATE requires catalog_key and sense_key");
      if (row.recordRevision === null) errors.push("UPDATE requires record_revision");
      if (!(["ACTIVE", "DRAFT", "RETIRED"] as string[]).includes(row.catalogStatus)) errors.push("UPDATE catalog_status must be ACTIVE, DRAFT or RETIRED");
    }
  }
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
    directionEligible,
    eligibility: directionEligible
      ? "ACTIVATION_ELIGIBLE"
      : "DRAFT_BLOCKED",
  };
}

export function buildCatalogImportReport(
  rows: readonly NormalizedCatalogRow[],
  validations: readonly CatalogRowValidation[],
  sourceFile: string,
  dispositions: readonly CatalogPrimaryDisposition[] = [],
): CatalogImportReport {
  const primaryDisposition: Record<CatalogPrimaryDisposition, number> = { CREATED_DRAFT: 0, MERGED: 0, NO_CHANGE: 0, CONFLICT: 0, VALIDATION_FAILED: 0 };
  const eligibility: Record<CatalogActivationResult, number> = {
    ACTIVATION_ELIGIBLE: 0,
    DRAFT_BLOCKED: 0,
  };
  for (const [index, validation] of validations.entries()) {
    const disposition = validation.errors.length > 0
      ? "VALIDATION_FAILED"
      : dispositions[index] ?? "CREATED_DRAFT";
    primaryDisposition[disposition] += 1;
    eligibility[validation.eligibility] += 1;
    if (rows[index] === undefined) throw new Error("catalog report row alignment failed");
  }
  return {
    sourceFile,
    rows: rows.length,
    primaryDisposition,
    eligibility,
    errors: validations.reduce((sum, item) => sum + item.errors.length, 0),
    warnings: validations.reduce((sum, item) => sum + item.warnings.length, 0),
  };
}

export function neutralizeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+@]/u.test(text.trimStart()) || /^-\d/u.test(text.trimStart()) ? `'${text}` : text;
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function catalogRowsToCsv(rows: readonly Partial<Record<CatalogHeader, unknown>>[]): string {
  const lines = [CATALOG_HEADERS.map(neutralizeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(CATALOG_HEADERS.map((header) => neutralizeCsvCell(row[header])).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function safeCatalogDownloadName(value: string, fallback = "word-catalog.csv"): string {
  const normalized = value.normalize("NFKC").replace(/[\u0000-\u001F\u007F/\\]/gu, "-").trim();
  const candidate = normalized.slice(0, 120) || fallback;
  return candidate.toLocaleLowerCase("en-US").endsWith(".csv") ? candidate : `${candidate}.csv`;
}
