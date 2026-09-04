import { createHash } from "node:crypto";
import { isCatalogPartOfSpeech } from "./taxonomy";
export { CATALOG_STRUCTURED_ISSUE_VERSION } from "./validation-issue-contract";

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
export const CATALOG_GOVERNANCE_OMITTED_HEADERS = [
  "prompt_en",
  "prompt_zh",
  "source_reference",
  "contributor_ref",
  "change_note",
] as const satisfies readonly CatalogHeader[];
const CATALOG_GOVERNANCE_OMITTED_HEADER_SET = new Set<CatalogHeader>(CATALOG_GOVERNANCE_OMITTED_HEADERS);
export const CATALOG_GOVERNANCE_HEADERS: readonly CatalogHeader[] = CATALOG_HEADERS.filter(
  (header) => !CATALOG_GOVERNANCE_OMITTED_HEADER_SET.has(header),
);
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
  /** Stable, presentation-safe issue contract. Raw strings remain for CSV compatibility only. */
  issues: CatalogValidationIssue[];
  directionEligible: boolean;
  eligibility: CatalogActivationResult;
}

export interface CatalogValidationIssue {
  code: string;
  field: string | null;
  direction: "EN_TO_ZH" | "ZH_TO_EN" | null;
  severity: "ERROR" | "WARNING";
}

export const CATALOG_VALIDATION_ISSUE_CODES = [
  "CATALOG_PARSE_INVALID",
  "CATALOG_SCHEMA_UNSUPPORTED",
  "CATALOG_TERM_REQUIRED",
  "CATALOG_LEMMA_REQUIRED",
  "CATALOG_POS_REQUIRED",
  "CATALOG_POS_UNKNOWN",
  "CATALOG_LEVEL_INVALID",
  "CATALOG_CATEGORY_REQUIRED",
  "CATALOG_CATEGORY_UNKNOWN",
  "CATALOG_DEFINITION_REQUIRED",
  "CATALOG_PROMPT_NOT_EMPTY",
  "CATALOG_BOOTSTRAP_STATUS_INVALID",
  "CATALOG_BOOTSTRAP_ACTION_INVALID",
  "CATALOG_GOVERNANCE_ACTION_INVALID",
  "CATALOG_RETIREMENT_REASON_INVALID",
  "CATALOG_SOURCE_METADATA_REQUIRED",
  "CATALOG_CREATE_IDENTITY_INVALID",
  "CATALOG_UPDATE_IDENTITY_REQUIRED",
  "CATALOG_UPDATE_REVISION_REQUIRED",
  "CATALOG_UPDATE_STATUS_INVALID",
  "CATALOG_EXAMPLE_ZH_REQUIRED",
  "CATALOG_EXAMPLE_EN_REQUIRED",
  "CATALOG_DISTRACTOR_COUNT",
  "CATALOG_DISTRACTOR_DUPLICATE",
  "CATALOG_DISTRACTOR_CANONICAL_COLLISION",
  "CATALOG_DISTRACTOR_ACCEPTED_COLLISION",
  "CATALOG_DISTRACTOR_SIBLING_COLLISION",
  "CATALOG_DIRECTIONS_DISABLED",
] as const;

export function catalogLegacyValidationIssue(
  message: string,
  severity: CatalogValidationIssue["severity"] = "ERROR",
): CatalogValidationIssue {
  const normalized = message.trim();
  const direction = normalized.startsWith("en-zh")
    ? "EN_TO_ZH"
    : normalized.startsWith("zh-en")
      ? "ZH_TO_EN"
      : null;
  const distractorField =
    direction === "EN_TO_ZH"
      ? "distractorZh"
      : direction === "ZH_TO_EN"
        ? "distractorEn"
        : null;
  if (normalized === "unsupported schema_version")
    return { code: "CATALOG_SCHEMA_UNSUPPORTED", field: null, direction: null, severity };
  if (normalized === "term is required")
    return { code: "CATALOG_TERM_REQUIRED", field: "term", direction: null, severity };
  if (normalized === "lemma is required")
    return { code: "CATALOG_LEMMA_REQUIRED", field: "lemma", direction: null, severity };
  if (normalized === "part_of_speech is required")
    return { code: "CATALOG_POS_REQUIRED", field: "partOfSpeech", direction: null, severity };
  if (normalized.startsWith("part_of_speech must be one of"))
    return { code: "CATALOG_POS_UNKNOWN", field: "partOfSpeech", direction: null, severity };
  if (normalized.startsWith("level must be"))
    return { code: "CATALOG_LEVEL_INVALID", field: "level", direction: null, severity };
  if (normalized === "category is required")
    return { code: "CATALOG_CATEGORY_REQUIRED", field: "category", direction: null, severity };
  if (normalized === "definition_zh is required")
    return { code: "CATALOG_DEFINITION_REQUIRED", field: "definitionZh", direction: null, severity };
  if (normalized.startsWith("prompt_en/prompt_zh"))
    return { code: "CATALOG_PROMPT_NOT_EMPTY", field: null, direction: null, severity };
  if (normalized === "catalog_status must be empty or DRAFT for CSV bootstrap")
    return { code: "CATALOG_BOOTSTRAP_STATUS_INVALID", field: null, direction: null, severity };
  if (normalized === "requested_action must be CREATE_DRAFT for CSV bootstrap")
    return { code: "CATALOG_BOOTSTRAP_ACTION_INVALID", field: null, direction: null, severity };
  if (normalized === "requested_action must be CREATE or UPDATE for governance submission")
    return { code: "CATALOG_GOVERNANCE_ACTION_INVALID", field: null, direction: null, severity };
  if (normalized.startsWith("retirement_reason must be empty"))
    return { code: "CATALOG_RETIREMENT_REASON_INVALID", field: "retirementReason", direction: null, severity };
  if (normalized === "governance validation requires source metadata")
    return { code: "CATALOG_SOURCE_METADATA_REQUIRED", field: null, direction: null, severity };
  if (normalized === "CREATE system identity fields must be empty")
    return { code: "CATALOG_CREATE_IDENTITY_INVALID", field: null, direction: null, severity };
  if (normalized === "UPDATE requires catalog_key and sense_key")
    return { code: "CATALOG_UPDATE_IDENTITY_REQUIRED", field: null, direction: null, severity };
  if (normalized === "UPDATE requires record_revision")
    return { code: "CATALOG_UPDATE_REVISION_REQUIRED", field: null, direction: null, severity };
  if (normalized.startsWith("UPDATE catalog_status must be"))
    return { code: "CATALOG_UPDATE_STATUS_INVALID", field: null, direction: null, severity };
  if (normalized === "example_zh is required when example_en is present")
    return { code: "CATALOG_EXAMPLE_ZH_REQUIRED", field: "exampleZh", direction: null, severity };
  if (normalized === "example_en is required when example_zh is present")
    return { code: "CATALOG_EXAMPLE_EN_REQUIRED", field: "exampleEn", direction: null, severity };
  if (normalized.includes("requires 5 or 6 distractors"))
    return { code: "CATALOG_DISTRACTOR_COUNT", field: distractorField, direction, severity };
  if (normalized.includes("has duplicate distractors"))
    return { code: "CATALOG_DISTRACTOR_DUPLICATE", field: distractorField, direction, severity };
  if (normalized.includes("collides with canonical answer"))
    return { code: "CATALOG_DISTRACTOR_CANONICAL_COLLISION", field: distractorField, direction, severity };
  if (normalized.includes("collides with an accepted answer"))
    return { code: "CATALOG_DISTRACTOR_ACCEPTED_COLLISION", field: distractorField, direction, severity };
  if (normalized.includes("collides with a sibling-sense answer"))
    return { code: "CATALOG_DISTRACTOR_SIBLING_COLLISION", field: distractorField, direction, severity };
  if (normalized === "both directions are disabled")
    return { code: "CATALOG_DIRECTIONS_DISABLED", field: null, direction: null, severity };
  return { code: "CATALOG_PARSE_INVALID", field: null, direction: null, severity };
}

export interface CatalogImportReport {
  sourceFile: string;
  rows: number;
  primaryDisposition: Record<CatalogPrimaryDisposition, number>;
  eligibility: Record<CatalogActivationResult, number>;
  errors: number;
  warnings: number;
}

// Stay below Vercel Functions' 4.5 MB request-body ceiling.
export const CATALOG_GOVERNANCE_MAX_BYTES = 4 * 1024 * 1024;
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

type StrictCsvRecord = {
  values: string[];
  sourceLine: number;
};

function strictCsvRecords(text: string, sourceFile: string): StrictCsvRecord[] {
  const records: StrictCsvRecord[] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let physicalLine = 1;
  let recordSourceLine = 1;
  let quoteSourceLine = 1;

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
        if (char === "\n") physicalLine += 1;
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
        records.push({ values: record, sourceLine: recordSourceLine });
        record = [];
        field = "";
        closedQuote = false;
        physicalLine += 1;
        recordSourceLine = physicalLine;
      } else if (char !== "\r") {
        throw new CatalogCsvError("CATALOG_CSV_QUOTING_INVALID", `${sourceFile}: unexpected character after closing quote on row ${physicalLine}`);
      }
      continue;
    }
    if (char === '"') {
      if (field.length > 0) throw new CatalogCsvError("CATALOG_CSV_QUOTING_INVALID", `${sourceFile}: quote inside an unquoted field on row ${physicalLine}`);
      quoted = true;
      quoteSourceLine = physicalLine;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field.replace(/\r$/u, ""));
      records.push({ values: record, sourceLine: recordSourceLine });
      record = [];
      field = "";
      physicalLine += 1;
      recordSourceLine = physicalLine;
    } else {
      field += char;
    }
  }
  if (quoted) throw new CatalogCsvError("CATALOG_CSV_QUOTING_INVALID", `${sourceFile}: unclosed quoted field opened on row ${quoteSourceLine}`);
  if (field.length > 0 || record.length > 0 || closedQuote) {
    record.push(field.replace(/\r$/u, ""));
    records.push({ values: record, sourceLine: recordSourceLine });
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
    throw new CatalogCsvError("CATALOG_CSV_TOO_LARGE", `${sourceFile}: CSV exceeds 4 MiB`);
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

/** Strict, fixed-template parser for teacher governance uploads. */
export function parseCatalogGovernanceCsv(bytes: Uint8Array, sourceFile: string): CatalogSourceRow[] {
  return parseCatalogGovernanceRecords(
    strictCsvRecords(governanceText(bytes, sourceFile), sourceFile),
    sourceFile,
    "CSV",
  );
}

export function parseCatalogGovernanceRecords(
  records: readonly { values: readonly string[]; sourceLine: number }[],
  sourceFile: string,
  formatLabel: "CSV" | "XLSX",
): CatalogSourceRow[] {
  const header = records[0]?.values.map((value) => clean(value));
  if (!header?.length) throw new CatalogCsvError("CATALOG_CSV_HEADER_INVALID", `${sourceFile}: ${formatLabel} header is required`);
  if (new Set(header).size !== header.length) {
    throw new CatalogCsvError("CATALOG_CSV_HEADER_DUPLICATE", `${sourceFile}: ${formatLabel} has a duplicate header`);
  }
  if (
    header.length !== CATALOG_GOVERNANCE_HEADERS.length
    || header.some((value, index) => value !== CATALOG_GOVERNANCE_HEADERS[index])
  ) {
    throw new CatalogCsvError("CATALOG_CSV_HEADER_INVALID", `${sourceFile}: ${formatLabel} header names and order must match the 34-field teacher template`);
  }
  const rows = records.slice(1).flatMap(({ values, sourceLine }) => {
    if (values.every((value) => clean(value) === "")) return [];
    if (values.length !== header.length) {
      throw new CatalogCsvError("CATALOG_CSV_COLUMN_COUNT_INVALID", `${sourceFile}: ${formatLabel} row ${sourceLine} has ${values.length} columns; expected ${header.length}`);
    }
    const record = Object.assign(
      Object.fromEntries(CATALOG_HEADERS.map((key) => [key, ""])),
      Object.fromEntries(header.map((key, keyIndex) => [key, values[keyIndex] ?? ""])),
    ) as unknown as CatalogSourceRow;
    for (const key of CATALOG_HEADERS) {
      if (dangerousFormula(record[key])) {
        throw new CatalogCsvError("CATALOG_CSV_FORMULA_INVALID", `${sourceFile}: row ${sourceLine} field ${key} begins with a spreadsheet formula marker`);
      }
    }
    return [{ ...record, sourceFile, sourceRow: sourceLine }];
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
  mode: CatalogValidationMode = "bootstrap",
  sourceRow?: CatalogSourceRow,
): CatalogRowValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const issues: CatalogValidationIssue[] = [];
  const addError = (
    message: string,
    code: string,
    field: string | null = null,
    direction: CatalogValidationIssue["direction"] = null,
  ) => {
    errors.push(message);
    issues.push({ code, field, direction, severity: "ERROR" });
  };
  const addWarning = (
    message: string,
    code: string,
    field: string | null = null,
    direction: CatalogValidationIssue["direction"] = null,
  ) => {
    warnings.push(message);
    issues.push({ code, field, direction, severity: "WARNING" });
  };

  for (const parseError of row.parseErrors) addError(parseError, "CATALOG_PARSE_INVALID");
  if (row.schemaVersion !== CATALOG_SCHEMA_VERSION) addError("unsupported schema_version", "CATALOG_SCHEMA_UNSUPPORTED");
  if (!row.term) addError("term is required", "CATALOG_TERM_REQUIRED", "term");
  if (!row.lemma) addError("lemma is required", "CATALOG_LEMMA_REQUIRED", "lemma");
  if (!row.partOfSpeech) addError("part_of_speech is required", "CATALOG_POS_REQUIRED", "partOfSpeech");
  else if (!isCatalogPartOfSpeech(row.partOfSpeech)) addError(
    "part_of_speech must be one of the canonical values",
    "CATALOG_POS_UNKNOWN",
    "partOfSpeech",
  );
  if (!validLevel(row.level)) addError("level must be A1, A2, B1 or B2", "CATALOG_LEVEL_INVALID", "level");
  if (!row.category) addError("category is required", "CATALOG_CATEGORY_REQUIRED", "category");
  if (!row.definitionZh) addError("definition_zh is required", "CATALOG_DEFINITION_REQUIRED", "definitionZh");
  if (row.promptEn || row.promptZh) addError("prompt_en/prompt_zh must be empty; prompts are server-owned", "CATALOG_PROMPT_NOT_EMPTY");
  if (mode === "bootstrap") {
    if (row.catalogStatus && row.catalogStatus !== "DRAFT") addError("catalog_status must be empty or DRAFT for CSV bootstrap", "CATALOG_BOOTSTRAP_STATUS_INVALID");
    if (row.requestedAction !== "CREATE_DRAFT") addError("requested_action must be CREATE_DRAFT for CSV bootstrap", "CATALOG_BOOTSTRAP_ACTION_INVALID");
  } else {
    if (row.requestedAction !== "CREATE" && row.requestedAction !== "UPDATE") addError("requested_action must be CREATE or UPDATE for governance submission", "CATALOG_GOVERNANCE_ACTION_INVALID");
    if (row.retirementReason) addError("retirement_reason must be empty for CREATE/UPDATE governance submission", "CATALOG_RETIREMENT_REASON_INVALID");
    if (!sourceRow) {
      addError("governance validation requires source metadata", "CATALOG_SOURCE_METADATA_REQUIRED");
    } else if (row.requestedAction === "CREATE") {
      if ([sourceRow.catalog_key, sourceRow.sense_key, sourceRow.record_revision, sourceRow.catalog_status].some((value) => clean(value) !== "")) {
        addError("CREATE system identity fields must be empty", "CATALOG_CREATE_IDENTITY_INVALID");
      }
    } else if (row.requestedAction === "UPDATE") {
      if (!clean(sourceRow.catalog_key) || !clean(sourceRow.sense_key)) addError("UPDATE requires catalog_key and sense_key", "CATALOG_UPDATE_IDENTITY_REQUIRED");
      if (row.recordRevision === null) addError("UPDATE requires record_revision", "CATALOG_UPDATE_REVISION_REQUIRED");
      if (!(["ACTIVE", "DRAFT", "RETIRED"] as string[]).includes(row.catalogStatus)) addError("UPDATE catalog_status must be ACTIVE, DRAFT or RETIRED", "CATALOG_UPDATE_STATUS_INVALID");
    }
  }
  if (row.exampleEn && !row.exampleZh) addError("example_zh is required when example_en is present", "CATALOG_EXAMPLE_ZH_REQUIRED", "exampleZh");
  if (row.exampleZh && !row.exampleEn) addError("example_en is required when example_zh is present", "CATALOG_EXAMPLE_EN_REQUIRED", "exampleEn");

  const directionChecks: Array<[CatalogDirection, boolean]> = [["en-zh", row.enableEnToZh], ["zh-en", row.enableZhToEn]];
  for (const [direction, enabled] of directionChecks) {
    if (!enabled) continue;
    const issueDirection = direction === "en-zh" ? "EN_TO_ZH" : "ZH_TO_EN";
    const distractorField = direction === "en-zh" ? "distractorZh" : "distractorEn";
    const candidates = directionCandidates(row, direction);
    const normalizedCandidates = candidates.map(normalizeCatalogText);
    const answer = normalizeCatalogText(directionAnswer(row, direction));
    if (candidates.length < 5 || candidates.length > 6) addError(`${direction} requires 5 or 6 distractors`, "CATALOG_DISTRACTOR_COUNT", distractorField, issueDirection);
    if (new Set(normalizedCandidates).size !== normalizedCandidates.length) addError(`${direction} has duplicate distractors`, "CATALOG_DISTRACTOR_DUPLICATE", distractorField, issueDirection);
    if (normalizedCandidates.includes(answer)) addError(`${direction} distractor collides with canonical answer`, "CATALOG_DISTRACTOR_CANONICAL_COLLISION", distractorField, issueDirection);
    const sameRowAnswers = direction === "en-zh"
      ? row.acceptedAnswersZh
      : [row.acceptedFormsEn, row.synonymsEn].flat();
    if (normalizedCandidates.some((candidate) => sameRowAnswers.map(normalizeCatalogText).includes(candidate))) addError(`${direction} distractor collides with an accepted answer or answer-safety synonym`, "CATALOG_DISTRACTOR_ACCEPTED_COLLISION", distractorField, issueDirection);
  }
  if (!row.enableEnToZh && !row.enableZhToEn) addWarning("both directions are disabled", "CATALOG_DIRECTIONS_DISABLED");
  const directionEligible = (row.enableEnToZh || row.enableZhToEn) && errors.length === 0;
  return {
    errors,
    warnings,
    issues,
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

export function catalogRowsToCsv(
  rows: readonly Partial<Record<CatalogHeader, unknown>>[],
  headers: readonly CatalogHeader[] = CATALOG_HEADERS,
): string {
  const lines = [headers.map(neutralizeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => neutralizeCsvCell(row[header])).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function safeCatalogDownloadName(value: string, fallback = "word-catalog.csv"): string {
  const normalized = value.normalize("NFKC").replace(/[\u0000-\u001F\u007F/\\]/gu, "-").trim();
  const candidate = normalized.slice(0, 120) || fallback;
  const lower = candidate.toLocaleLowerCase("en-US");
  if (lower.endsWith(".csv") || lower.endsWith(".xlsx")) return candidate;
  const extension = fallback.toLocaleLowerCase("en-US").endsWith(".xlsx") ? ".xlsx" : ".csv";
  return `${candidate}${extension}`;
}
