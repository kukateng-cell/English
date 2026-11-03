import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_HEADERS,
  catalogLegacyValidationIssue,
  catalogPhoneticCharacterIssues,
  normalizeCatalogRow,
  parseCatalogCsv,
  validateCatalogRow,
} from "@/lib/catalog/csv";
import { readCatalogSourceFiles } from "@/lib/catalog/seed";

function csvRow(values: Partial<Record<(typeof CATALOG_HEADERS)[number], string>> = {}): string {
  const row = CATALOG_HEADERS.map((header) => values[header] ?? "");
  return row.map((value) => {
    const escaped = value.replaceAll('"', '""');
    return /[",\n]/u.test(escaped) ? `"${escaped}"` : escaped;
  }).join(",");
}

function normalized(values: Partial<Record<(typeof CATALOG_HEADERS)[number], string>> = {}) {
  const source = parseCatalogCsv(
    `${CATALOG_HEADERS.join(",")}\n${csvRow({
      schema_version: "word-catalog-v1",
      requested_action: "CREATE_DRAFT",
      term: "run",
      lemma: "run",
      part_of_speech: "verb",
      level: "A1",
      category: "actions",
      definition_zh: "跑步",
      enable_en_to_zh: "TRUE",
      enable_zh_to_en: "TRUE",
      distractor_zh_1: "跳躍",
      distractor_zh_2: "行走",
      distractor_zh_3: "游泳",
      distractor_zh_4: "站立",
      distractor_zh_5: "坐下",
      distractor_en_1: "walk",
      distractor_en_2: "jump",
      distractor_en_3: "swim",
      distractor_en_4: "stand",
      distractor_en_5: "sit",
      ...values,
    })}`,
    "fixture.csv",
  );
  return normalizeCatalogRow(source[0]!, 0);
}

test("catalog parser accepts BOM and preserves quoted commas without prompts", () => {
  const rows = parseCatalogCsv(
    `\uFEFF${CATALOG_HEADERS.join(",")}\n${csvRow({
      schema_version: "word-catalog-v1",
      requested_action: "CREATE_DRAFT",
      term: "well",
      lemma: "well",
      part_of_speech: "adverb",
      level: "A1",
      category: "other",
      definition_zh: "好；健康",
      accepted_answers_zh: "好|健康",
      example_en: "She is well, thank you.",
      example_zh: "她很好，謝謝。",
    })}`,
    "fixture.csv",
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.definition_zh, "好；健康");
  assert.equal(rows[0]?.prompt_en, "");
});

test("enabled directions require five or six curated distractors", () => {
  const row = normalized({ distractor_zh_5: "", distractor_en_5: "" });
  const result = validateCatalogRow(row);
  assert.ok(result.errors.includes("en-zh requires 5 or 6 distractors"));
  assert.ok(result.errors.includes("zh-en requires 5 or 6 distractors"));
  assert.equal(result.eligibility, "DRAFT_BLOCKED");
});

test("a valid direction-enabled row is eligible for formal initial activation", () => {
  const result = validateCatalogRow(normalized());
  assert.equal(result.errors.length, 0);
  assert.equal(result.eligibility, "ACTIVATION_ELIGIBLE");
});

test("prompt fields are blocking because prompts are server-owned", () => {
  const row = normalized({ prompt_en: "run", prompt_zh: "跑步" });
  const result = validateCatalogRow(row);
  assert.ok(result.errors.some((error) => error.includes("prompt_en/prompt_zh")));
});

test("schema, boolean and revision fields are strict", () => {
  const row = normalized({ schema_version: "word-catalog-v0", enable_en_to_zh: "yes", record_revision: "0" });
  const result = validateCatalogRow(row);
  assert.ok(result.errors.includes("unsupported schema_version"));
  assert.ok(result.errors.includes("enable_en_to_zh must be TRUE or FALSE"));
  assert.ok(result.errors.includes("record_revision must be a positive integer"));
});

test("a distractor cannot be an accepted answer or synonym", () => {
  const row = normalized({
    accepted_forms_en: "jog",
    synonyms_en: "jog",
    distractor_en_1: "jog",
  });
  const result = validateCatalogRow(row);
  assert.ok(result.errors.some((error) => error.includes("accepted answer or answer-safety synonym")));
});

test("an antonym can be used as a clearly incorrect distractor", () => {
  const row = normalized({
    term: "accept",
    lemma: "accept",
    definition_zh: "接受",
    antonyms_en: "reject",
    distractor_en_1: "reject",
  });
  const result = validateCatalogRow(row);
  assert.equal(
    result.issues.some((issue) => issue.code === "CATALOG_DISTRACTOR_ACCEPTED_COLLISION"),
    false,
  );
});

test("another sense's answer does not block row-local validation", () => {
  const run = normalized({ sense_key: "run-a1-run", distractor_zh_1: "經營" });
  const result = validateCatalogRow(run);
  assert.equal(
    result.issues.some((issue) => issue.code === "CATALOG_DISTRACTOR_SIBLING_COLLISION"),
    false,
  );
});

test("a row with both directions disabled remains draft-blocked", () => {
  const result = validateCatalogRow(normalized({ enable_en_to_zh: "FALSE", enable_zh_to_en: "FALSE" }));
  assert.equal(result.errors.length, 0);
  assert.equal(result.directionEligible, false);
  assert.equal(result.eligibility, "DRAFT_BLOCKED");
  assert.ok(result.warnings.includes("both directions are disabled"));
});

test("phonetic_ipa blocks legacy non-IPA placeholder characters", () => {
  // 舊詞表把 IPA ɡ 及主重音 ˈ 誤轉成 ASCII ^ 及 ˊ；兩種字元都必須擋在匯入之前。
  for (const phonetic of ["'^rændtʃaild", "\u02CAgudlukiŋ"]) {
    const result = validateCatalogRow(normalized({ phonetic_ipa: phonetic }));
    assert.equal(result.eligibility, "DRAFT_BLOCKED");
    assert.ok(result.errors.some((error) => error.includes("non-IPA character")), phonetic);
    assert.equal(
      result.issues.filter((issue) => issue.code === "CATALOG_PHONETIC_CHARACTER_INVALID").length,
      1,
      phonetic,
    );
    assert.equal(
      result.issues.find((issue) => issue.code === "CATALOG_PHONETIC_CHARACTER_INVALID")?.field,
      "phoneticIpa",
      phonetic,
    );
  }
  const clean = validateCatalogRow(normalized({ phonetic_ipa: "ˈɡʊdlʊkɪŋ" }));
  assert.equal(clean.errors.length, 0);
  assert.equal(clean.eligibility, "ACTIVATION_ELIGIBLE");
});

test("phonetic helper only reports the known non-IPA placeholder characters", () => {
  assert.deepEqual(catalogPhoneticCharacterIssues(null), []);
  assert.deepEqual(catalogPhoneticCharacterIssues(""), []);
  assert.deepEqual(catalogPhoneticCharacterIssues("ˈɡʊdlʊkɪŋ"), []);
  assert.equal(catalogPhoneticCharacterIssues("i^'zæktli").length, 1);
  assert.equal(catalogPhoneticCharacterIssues("\u02CAgudlukiŋ").length, 1);
  assert.equal(
    catalogLegacyValidationIssue("phonetic_ipa contains non-IPA character U+005E ^; use ɡ（U+0261）").code,
    "CATALOG_PHONETIC_CHARACTER_INVALID",
  );
});

test("checked-in catalog CSV phonetics contain no forbidden non-IPA characters", async () => {
  const files = await readCatalogSourceFiles();
  const offenders = files.flatMap((file) =>
    file.rows.flatMap((row) =>
      catalogPhoneticCharacterIssues(row.phonetic_ipa).map(
        (message) => `${row.sourceFile}:${row.sourceRow} ${row.term}: ${message}`,
      ),
    ),
  );
  assert.deepEqual(offenders, []);
});
