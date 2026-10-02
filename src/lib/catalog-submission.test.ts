import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_GOVERNANCE_HEADERS,
  CATALOG_GOVERNANCE_OMITTED_HEADERS,
  CATALOG_HEADERS,
  CatalogCsvError,
  catalogRowsToCsv,
  parseCatalogGovernanceCsv,
  type CatalogSourceRow,
} from "./catalog/csv";
import {
  buildCatalogSubmissionPreview,
  buildCatalogPreviewDependencyDigests,
  catalogActorPseudonym,
  catalogDependencyDigest,
  classifyCatalogReviewRisk,
  describeCatalogBatchError,
  deterministicSubmissionProposalGroupId,
  isCanonicalUuid,
  type CatalogDatabaseSenseSnapshot,
} from "./catalog/submission";
import { payloadFingerprint, type CatalogGovernancePayload } from "./catalog/governance";
import {
  applyCatalogSubmissionBatchPatch,
  CATALOG_SUBMISSION_PATCH_VERSION,
  type CatalogSubmissionBatchPatch,
} from "./catalog/submission-patch";

function payload(overrides: Partial<CatalogGovernancePayload> = {}): CatalogGovernancePayload {
  return {
    term: "run",
    lemma: "run",
    partOfSpeech: "verb",
    level: "A1",
    category: "actions-events",
    definitionZh: "跑步",
    acceptedAnswersZh: ["跑步"],
    phoneticIpa: "/rʌn/",
    exampleEn: "I run every day.",
    exampleZh: "我每天跑步。",
    acceptedFormsEn: ["run"],
    synonymsEn: [],
    antonymsEn: [],
    enableEnToZh: true,
    distractorZh: ["跳躍", "步行", "游泳", "站立", "坐下"],
    enableZhToEn: true,
    distractorEn: ["jump", "walk", "swim", "stand", "sit"],
    sourceReference: null,
    contributorRef: null,
    changeNote: null,
    retirementReason: null,
    ...overrides,
  };
}

function source(action: "CREATE" | "UPDATE", overrides: Partial<CatalogSourceRow> = {}): CatalogSourceRow {
  const value = payload();
  return {
    sourceFile: "fixture.csv",
    sourceRow: 2,
    schema_version: "word-catalog-v1",
    requested_action: action,
    catalog_key: action === "UPDATE" ? "cat_run" : "",
    sense_key: action === "UPDATE" ? "sense_run" : "",
    record_revision: action === "UPDATE" ? "1" : "",
    catalog_status: action === "UPDATE" ? "ACTIVE" : "",
    term: value.term,
    lemma: value.lemma,
    part_of_speech: value.partOfSpeech,
    level: value.level,
    category: value.category,
    definition_zh: value.definitionZh,
    accepted_answers_zh: value.acceptedAnswersZh.join("|"),
    prompt_en: "",
    prompt_zh: "",
    phonetic_ipa: value.phoneticIpa ?? "",
    example_en: value.exampleEn ?? "",
    example_zh: value.exampleZh ?? "",
    accepted_forms_en: value.acceptedFormsEn.join("|"),
    synonyms_en: "",
    antonyms_en: "",
    enable_en_to_zh: "TRUE",
    distractor_zh_1: value.distractorZh[0]!,
    distractor_zh_2: value.distractorZh[1]!,
    distractor_zh_3: value.distractorZh[2]!,
    distractor_zh_4: value.distractorZh[3]!,
    distractor_zh_5: value.distractorZh[4]!,
    distractor_zh_6: "",
    enable_zh_to_en: "TRUE",
    distractor_en_1: value.distractorEn[0]!,
    distractor_en_2: value.distractorEn[1]!,
    distractor_en_3: value.distractorEn[2]!,
    distractor_en_4: value.distractorEn[3]!,
    distractor_en_5: value.distractorEn[4]!,
    distractor_en_6: "",
    source_reference: "",
    contributor_ref: "",
    change_note: "",
    retirement_reason: "",
    ...overrides,
  };
}

function bytes(rows: CatalogSourceRow[]): Uint8Array {
  return new TextEncoder().encode(catalogRowsToCsv(rows, CATALOG_GOVERNANCE_HEADERS));
}

test("teacher governance CSV rejects the legacy 39-field format", () => {
  const row = source("CREATE");
  const reversed = [...CATALOG_HEADERS].reverse();
  const csv = `${reversed.join(",")}\r\n${reversed.map((header) => row[header]).join(",")}\r\n`;
  assert.throws(
    () => parseCatalogGovernanceCsv(new TextEncoder().encode(csv), "fixture.csv"),
    (error: unknown) => error instanceof CatalogCsvError && error.code === "CATALOG_CSV_HEADER_INVALID",
  );
});

test("governance CSV accepts the clean 34-field teacher format and defaults omitted metadata", () => {
  const row = source("CREATE", {
    prompt_en: "must not be imported",
    prompt_zh: "不得匯入",
    source_reference: "internal-only",
    contributor_ref: "internal-only",
    change_note: "internal-only",
  });
  const csv = catalogRowsToCsv([row], CATALOG_GOVERNANCE_HEADERS);
  const parsed = parseCatalogGovernanceCsv(new TextEncoder().encode(csv), "clean.csv");
  assert.equal(CATALOG_GOVERNANCE_HEADERS.length, 34);
  assert.deepEqual(
    CATALOG_GOVERNANCE_OMITTED_HEADERS,
    ["prompt_en", "prompt_zh", "source_reference", "contributor_ref", "change_note"],
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.term, "run");
  for (const header of CATALOG_GOVERNANCE_OMITTED_HEADERS) {
    assert.equal(parsed[0]![header], "");
  }
});

test("governance CSV rejects the same 34 headers when two template columns are moved", () => {
  const row = source("CREATE");
  const reordered = [...CATALOG_GOVERNANCE_HEADERS];
  [reordered[6], reordered[7]] = [reordered[7]!, reordered[6]!];
  assert.throws(
    () => parseCatalogGovernanceCsv(
      new TextEncoder().encode(catalogRowsToCsv([row], reordered)),
      "reordered.csv",
    ),
    (error: unknown) => error instanceof CatalogCsvError
      && error.code === "CATALOG_CSV_HEADER_INVALID"
      && error.message.includes("names and order"),
  );
});

test("governance CSV rejects unknown, missing or extra clean-format headers", () => {
  const row = source("CREATE");
  const missing = CATALOG_GOVERNANCE_HEADERS.filter((header) => header !== "definition_zh");
  assert.throws(
    () => parseCatalogGovernanceCsv(new TextEncoder().encode(catalogRowsToCsv([row], missing)), "missing.csv"),
    (error: unknown) => error instanceof CatalogCsvError && error.code === "CATALOG_CSV_HEADER_INVALID",
  );
  const csvWithUnknown = catalogRowsToCsv([row], CATALOG_GOVERNANCE_HEADERS)
    .replace("schema_version", "teacher_note");
  assert.throws(
    () => parseCatalogGovernanceCsv(new TextEncoder().encode(csvWithUnknown), "unknown.csv"),
    (error: unknown) => error instanceof CatalogCsvError && error.code === "CATALOG_CSV_HEADER_INVALID",
  );
  const extra = [...CATALOG_GOVERNANCE_HEADERS, CATALOG_HEADERS[13]!];
  assert.throws(
    () => parseCatalogGovernanceCsv(new TextEncoder().encode(catalogRowsToCsv([row], extra)), "extra.csv"),
    (error: unknown) => error instanceof CatalogCsvError && error.code === "CATALOG_CSV_HEADER_INVALID",
  );
});

test("governance CSV rejects duplicate headers, unsafe formulas and unclosed quotes", () => {
  const row = source("CREATE");
  const duplicate = [...CATALOG_GOVERNANCE_HEADERS];
  duplicate[1] = duplicate[0]!;
  assert.throws(() => parseCatalogGovernanceCsv(new TextEncoder().encode(`${duplicate.join(",")}\n`), "duplicate.csv"), (error: unknown) => error instanceof CatalogCsvError && error.code === "CATALOG_CSV_HEADER_DUPLICATE");
  const normal = new TextDecoder().decode(bytes([row]));
  assert.throws(() => parseCatalogGovernanceCsv(new TextEncoder().encode(normal.replace(",run,run,", ",=HYPERLINK(x),run,")), "formula.csv"), (error: unknown) => error instanceof CatalogCsvError && error.code === "CATALOG_CSV_FORMULA_INVALID");
  assert.throws(() => parseCatalogGovernanceCsv(new TextEncoder().encode(`${CATALOG_GOVERNANCE_HEADERS.join(",")}\n"broken`), "quote.csv"), (error: unknown) => error instanceof CatalogCsvError && error.code === "CATALOG_CSV_QUOTING_INVALID");
});

test("governance CSV reports the physical source line after a multiline quoted field", () => {
  const first = source("CREATE", { definition_zh: "第一行\n第二行" });
  const valid = catalogRowsToCsv([first], CATALOG_GOVERNANCE_HEADERS);
  const malformed = `${valid}too,few\r\n`;
  assert.throws(
    () => parseCatalogGovernanceCsv(new TextEncoder().encode(malformed), "multiline.csv"),
    (error: unknown) => error instanceof CatalogCsvError
      && error.code === "CATALOG_CSV_COLUMN_COUNT_INVALID"
      && error.message.includes("row 5"),
  );
});

test("governance CSV quoting errors retain physical source lines", () => {
  const header = CATALOG_GOVERNANCE_HEADERS.join(",");
  assert.throws(
    () => parseCatalogGovernanceCsv(new TextEncoder().encode(`${header}\nword,"first\nsecond"x`), "closing.csv"),
    (error: unknown) => error instanceof CatalogCsvError
      && error.code === "CATALOG_CSV_QUOTING_INVALID"
      && error.message.includes("row 3"),
  );
  assert.throws(
    () => parseCatalogGovernanceCsv(new TextEncoder().encode(`${header}\nword,"first\nsecond`), "unclosed.csv"),
    (error: unknown) => error instanceof CatalogCsvError
      && error.code === "CATALOG_CSV_QUOTING_INVALID"
      && error.message.includes("row 2"),
  );
  assert.throws(
    () => parseCatalogGovernanceCsv(new TextEncoder().encode(`${header}\n"first\nfield",second,"third\nfourth`), "later-unclosed.csv"),
    (error: unknown) => error instanceof CatalogCsvError
      && error.code === "CATALOG_CSV_QUOTING_INVALID"
      && error.message.includes("row 3"),
  );
});

test("preview groups exact duplicate rows but keeps invalid action metadata visible", () => {
  const rows = [source("CREATE"), { ...source("CREATE"), sourceRow: 3 }];
  const preview = buildCatalogSubmissionPreview(rows, []);
  assert.equal(preview.groups.length, 1);
  assert.deepEqual(preview.groups[0]!.sourceRowNumbers, [2, 3]);
  assert.equal(preview.rows[0]!.rowRole, "CANONICAL_SOURCE");
  assert.equal(preview.rows[1]!.rowRole, "MERGED_SOURCE");
  assert.equal(preview.status, "PREVIEW");
});

test("UPDATE preview binds stable identity and detects stale revisions", () => {
  const snapshot: CatalogDatabaseSenseSnapshot = { id: "sense-id", catalogKey: "cat_run", senseKey: "sense_run", status: "ACTIVE", revision: 1, payload: payload() };
  const valid = buildCatalogSubmissionPreview([source("UPDATE", { definition_zh: "奔跑" })], [snapshot]);
  assert.equal(valid.summary.invalidRows, 0);
  assert.equal(valid.groups[0]!.targetSenseId, "sense-id");
  const stale = buildCatalogSubmissionPreview([source("UPDATE", { record_revision: "2" })], [snapshot]);
  assert.ok(stale.rows[0]!.errors.includes("UPDATE record_revision is stale"));
});

test("UPDATE preview excludes no-op rows and blocks a target with a pending request", () => {
  const snapshot: CatalogDatabaseSenseSnapshot = { id: "sense-id", catalogKey: "cat_run", senseKey: "sense_run", status: "ACTIVE", revision: 1, payload: payload() };
  const noChange = buildCatalogSubmissionPreview([source("UPDATE")], [snapshot]);
  assert.equal(noChange.rows[0]!.primaryDisposition, "NO_CHANGE");
  assert.equal(noChange.rows[0]!.rowRole, "EXCLUDED");
  assert.equal(noChange.groups.length, 0);

  const pending = buildCatalogSubmissionPreview(
    [source("UPDATE", { definition_zh: "奔跑" })],
    [snapshot],
    [{ senseId: snapshot.id, senseKey: snapshot.senseKey, normalizedTerm: "run" }],
  );
  assert.equal(pending.rows[0]!.primaryDisposition, "VALIDATION_FAILED");
  assert.ok(pending.rows[0]!.errors.includes("UPDATE target already has a pending request"));
});

test("34-field UPDATE round-trip preserves server-managed provenance", () => {
  const currentPayload = payload({
    sourceReference: "school-dictionary-v1",
    contributorRef: "teacher-123",
    changeNote: "initial approval note",
    retirementReason: "historical lifecycle note",
  });
  const snapshot: CatalogDatabaseSenseSnapshot = {
    id: "sense-id",
    catalogKey: "cat_run",
    senseKey: "sense_run",
    status: "ACTIVE",
    revision: 1,
    payload: currentPayload,
  };
  const untouched = buildCatalogSubmissionPreview([source("UPDATE")], [snapshot]);
  assert.equal(untouched.rows[0]!.primaryDisposition, "NO_CHANGE");
  assert.equal(untouched.groups.length, 0);

  const changed = buildCatalogSubmissionPreview(
    [source("UPDATE", { definition_zh: "奔跑" })],
    [snapshot],
  );
  assert.equal(changed.groups[0]!.finalProposalPayload.definitionZh, "奔跑");
  assert.equal(changed.groups[0]!.finalProposalPayload.sourceReference, currentPayload.sourceReference);
  assert.equal(changed.groups[0]!.finalProposalPayload.contributorRef, currentPayload.contributorRef);
  assert.equal(changed.groups[0]!.finalProposalPayload.changeNote, currentPayload.changeNote);
  assert.equal(changed.groups[0]!.finalProposalPayload.retirementReason, currentPayload.retirementReason);
});

test("risk policy treats learning content as material and provenance-only edits as low risk", () => {
  const before = payload();
  assert.equal(classifyCatalogReviewRisk(before, { ...before, sourceReference: "dictionary" }).risk, "LOW_RISK_METADATA");
  assert.equal(classifyCatalogReviewRisk(before, { ...before, definitionZh: "奔跑" }).risk, "MATERIAL");
});

test("idempotency keys require canonical UUID spelling", () => {
  assert.equal(isCanonicalUuid("018f1f5a-7b2f-7cc1-8b35-5bb85b29ad31"), true);
  assert.equal(isCanonicalUuid("018F1F5A-7B2F-7CC1-8B35-5BB85B29AD31"), false);
  assert.equal(isCanonicalUuid("not-a-uuid"), false);
});

test("catalog audit pseudonyms use the stable security audit keyring", () => {
  const previous = {
    auditSecret: process.env.SECURITY_AUDIT_HMAC_SECRET,
    auditKeyId: process.env.SECURITY_AUDIT_HMAC_KEY_ID,
    nextAuth: process.env.NEXTAUTH_SECRET,
  };
  try {
    process.env.SECURITY_AUDIT_HMAC_SECRET = "stable-catalog-audit-secret-12345678901234567890";
    process.env.SECURITY_AUDIT_HMAC_KEY_ID = "audit-2026-v2";
    process.env.NEXTAUTH_SECRET = "jwt-secret-one";
    const first = catalogActorPseudonym("teacher-123");
    process.env.NEXTAUTH_SECRET = "jwt-secret-two";
    const second = catalogActorPseudonym("teacher-123");
    assert.deepEqual(second, first);
    assert.equal(first.keyVersion, "audit-2026-v2");
    assert.match(first.value, /^catalog-actor-v1:[0-9a-f]{64}$/u);
  } finally {
    if (previous.auditSecret === undefined) delete process.env.SECURITY_AUDIT_HMAC_SECRET;
    else process.env.SECURITY_AUDIT_HMAC_SECRET = previous.auditSecret;
    if (previous.auditKeyId === undefined) delete process.env.SECURITY_AUDIT_HMAC_KEY_ID;
    else process.env.SECURITY_AUDIT_HMAC_KEY_ID = previous.auditKeyId;
    if (previous.nextAuth === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = previous.nextAuth;
  }
});

test("bulk preview proposal group identities are deterministic and group-specific", () => {
  const first = deterministicSubmissionProposalGroupId("batch-1", 1);
  assert.equal(first, deterministicSubmissionProposalGroupId("batch-1", 1));
  assert.notEqual(first, deterministicSubmissionProposalGroupId("batch-1", 2));
  assert.notEqual(first, deterministicSubmissionProposalGroupId("batch-2", 1));
  assert.match(first, /^cspg_[0-9a-f]{24}$/u);
});

test("bulk preview dependency digests include deduplicated sibling and pending conflicts", () => {
  const snapshot: CatalogDatabaseSenseSnapshot = {
    id: "sense-id",
    catalogKey: "cat_run",
    senseKey: "sense_run",
    status: "ACTIVE",
    revision: 1,
    payload: payload(),
  };
  const preview = buildCatalogSubmissionPreview([source("CREATE", { definition_zh: "快速跑動" })], [snapshot]);
  const group = preview.groups[0]!;
  const pending = {
    senseId: snapshot.id,
    senseKey: snapshot.senseKey,
    normalizedTerm: "run",
    requestFingerprint: "pending-fingerprint",
  };
  const digest = buildCatalogPreviewDependencyDigests([group], [snapshot], [pending, pending]).get(group.groupNumber);
  assert.equal(digest, catalogDependencyDigest({
    action: "CREATE",
    target: null,
    siblingDigests: [payloadFingerprint(snapshot.payload)],
    pendingConflictDigests: [pending.requestFingerprint],
  }));

  const update = buildCatalogSubmissionPreview([source("UPDATE", { definition_zh: "奔跑" })], [snapshot]).groups[0]!;
  const renamedPending = { ...pending, senseKey: null, normalizedTerm: "renamed", requestFingerprint: "pending-by-sense-id" };
  const updateDigest = buildCatalogPreviewDependencyDigests([update], [snapshot], [renamedPending]).get(update.groupNumber);
  assert.equal(updateDigest, catalogDependencyDigest({
    action: "UPDATE",
    target: snapshot,
    siblingDigests: [payloadFingerprint(snapshot.payload)],
    pendingConflictDigests: [renamedPending.requestFingerprint],
  }));
});

test("error report maps both distractor directions to exact CSV column ranges", () => {
  assert.equal(CATALOG_GOVERNANCE_HEADERS.indexOf("distractor_zh_1") + 1, 21);
  assert.equal(CATALOG_GOVERNANCE_HEADERS.indexOf("distractor_zh_6") + 1, 26);
  assert.equal(CATALOG_GOVERNANCE_HEADERS.indexOf("distractor_en_1") + 1, 28);
  assert.equal(CATALOG_GOVERNANCE_HEADERS.indexOf("distractor_en_6") + 1, 33);
  assert.deepEqual(describeCatalogBatchError("en-zh requires 5 or 6 distractors"), {
    field: "distractor_zh_1…distractor_zh_6",
    excelColumn: "U:Z",
    code: "CATALOG_ROW_EN_ZH_REQUIRES_5_OR_6_DISTRACTORS",
    message: "干擾項不符合題目安全或數量規則。",
    fix: "檢查 distractor_zh_1…distractor_zh_6（Excel U:Z），確保有 5–6 個不重複、非正確答案的干擾項。",
  });
  const reverse = describeCatalogBatchError("zh-en distractor collides with canonical answer");
  assert.equal(reverse.field, "distractor_en_1…distractor_en_6");
  assert.equal(reverse.excelColumn, "AB:AG");
});

type PatchTestGroup = { id: string; revision: number; decision: string; payload: string };

function patchState() {
  return {
    status: "REVIEWING",
    resolutionOwnerId: null,
    reviewerId: "reviewer-1",
    resolutionClaimed: false,
    reviewClaimed: true,
    expiresAt: "2026-08-24T00:00:00.000Z",
    absoluteExpiresAt: "2026-08-25T00:00:00.000Z",
    submittedAt: "2026-08-23T00:00:00.000Z",
    reviewedAt: null,
    committedAt: null,
  };
}

test("compact submission patch updates one group without replacing full batch data", () => {
  const rows = [{ id: "row-1" }, { id: "row-2" }];
  const current = {
    id: "batch-1",
    revision: 4,
    ...patchState(),
    rows,
    groups: [
      { id: "group-1", revision: 2, decision: "PENDING", payload: "one" },
      { id: "group-2", revision: 3, decision: "PENDING", payload: "two" },
    ],
  };
  const patch: CatalogSubmissionBatchPatch<PatchTestGroup> = {
    version: CATALOG_SUBMISSION_PATCH_VERSION,
    batchId: current.id,
    baseRevision: 4,
    revision: 5,
    batch: { ...patchState(), status: "REVIEWED", reviewedAt: "2026-08-23T01:00:00.000Z" },
    group: {
      baseRevision: 3,
      value: { id: "group-2", revision: 4, decision: "APPROVE", payload: "two" },
    },
  };
  const result = applyCatalogSubmissionBatchPatch(current, patch);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.outcome, "APPLIED");
  assert.equal(result.batch.revision, 5);
  assert.equal(result.batch.status, "REVIEWED");
  assert.equal(result.batch.groups[0], current.groups[0]);
  assert.equal(result.batch.groups[1]!.decision, "APPROVE");
  assert.equal(result.batch.rows, rows);
});

test("compact submission patch replays safely and rejects stale or unrelated state", () => {
  const current = {
    id: "batch-1",
    revision: 5,
    ...patchState(),
    groups: [{ id: "group-1", revision: 3, decision: "APPROVE", payload: "one" }],
  };
  const replay: CatalogSubmissionBatchPatch<PatchTestGroup> = {
    version: CATALOG_SUBMISSION_PATCH_VERSION,
    batchId: current.id,
    baseRevision: 4,
    revision: 5,
    batch: patchState(),
    group: { baseRevision: 2, value: current.groups[0]! },
  };
  assert.deepEqual(applyCatalogSubmissionBatchPatch(current, replay), { ok: true, batch: current, outcome: "REPLAY" });
  assert.deepEqual(applyCatalogSubmissionBatchPatch(current, { ...replay, batchId: "batch-2" }), { ok: false, reason: "BATCH_MISMATCH" });
  assert.deepEqual(applyCatalogSubmissionBatchPatch({ ...current, revision: 6 }, replay), { ok: false, reason: "REVISION_MISMATCH" });
  assert.deepEqual(applyCatalogSubmissionBatchPatch({ ...current, revision: 4, groups: [] }, replay), { ok: false, reason: "GROUP_MISSING" });
  assert.deepEqual(applyCatalogSubmissionBatchPatch({ ...current, revision: 4, groups: [{ ...current.groups[0]!, revision: 1 }] }, replay), { ok: false, reason: "GROUP_REVISION_MISMATCH" });
});
