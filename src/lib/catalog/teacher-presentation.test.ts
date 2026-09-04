import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_VALIDATION_ISSUE_CODES,
  catalogLegacyValidationIssue,
} from "./csv";
import {
  catalogCategoryLabel,
  catalogExportAvailabilityPresentation,
  catalogFieldLabel,
  catalogHistorySourceLabel,
  catalogIssueEvidence,
  catalogIssueEvidenceLocationLabel,
  catalogIssuePresentation,
  catalogLifecycleLabel,
  catalogPartOfSpeechLabel,
  catalogReadinessLabel,
  catalogRequestStatusLabel,
  catalogSourceSummary,
  catalogWorkflowLabel,
} from "./teacher-presentation";
import { CATALOG_UNSUPPORTED_STRUCTURED_ISSUE_CODE } from "./validation-issue-contract";

test("catalog teacher presentation keeps lifecycle, workflow and readiness orthogonal", () => {
  assert.equal(catalogLifecycleLabel("ACTIVE"), "已啟用");
  assert.equal(catalogWorkflowLabel("PENDING"), "有修改等待審核");
  assert.equal(catalogReadinessLabel("EN_TO_ZH_ONLY"), "只可英譯中");
});

test("catalog teacher presentation maps taxonomy and safely falls back", () => {
  const canonicalPartOfSpeechLabels = {
    noun: "名詞",
    verb: "動詞",
    adjective: "形容詞",
    adverb: "副詞",
    pronoun: "代詞",
    determiner: "限定詞",
    preposition: "介詞",
    conjunction: "連詞",
    interjection: "感嘆詞",
    auxiliary: "助動詞",
    modal: "情態動詞",
    numeral: "數詞",
    particle: "助詞",
    phrasal_verb: "短語動詞",
    phrase: "短語",
    proper_noun: "專有名詞",
    abbreviation: "縮寫",
    other: "其他詞性",
  } as const;
  for (const [value, label] of Object.entries(canonicalPartOfSpeechLabels)) {
    assert.equal(catalogPartOfSpeechLabel(value), label);
  }
  assert.equal(
    catalogPartOfSpeechLabel("unexpected-internal-enum"),
    "其他詞性",
  );
  assert.equal(catalogCategoryLabel("people-family"), "人物與家庭");
  assert.equal(catalogCategoryLabel("unexpected-internal-enum"), "其他主題");
  assert.equal(
    catalogFieldLabel("acceptedAnswersZh"),
    "其他可接受中文譯法",
  );
  assert.equal(
    catalogFieldLabel("acceptedFormsEn"),
    "其他可接受英文形式",
  );
  assert.equal(catalogRequestStatusLabel("UNKNOWN"), "未能識別的記錄狀態");
  assert.equal(catalogHistorySourceLabel("UNKNOWN"), "未能識別的記錄來源");
});

test("catalog issue presentation gives a field, reason and next step without raw validator text", () => {
  const issue = catalogIssuePresentation({
    code: "CATALOG_DISTRACTOR_COUNT",
    field: "distractorEn",
    direction: "ZH_TO_EN",
    severity: "ERROR",
  });
  assert.equal(issue.fieldLabel, "中譯英干擾項");
  assert.equal(issue.directionLabel, "中譯英");
  assert.match(issue.reason, /5 至 6/u);
  assert.match(issue.fix, /補充|刪減/u);
  const unknown = catalogIssuePresentation({
    code: "RAW_INTERNAL_EXCEPTION",
    field: null,
    direction: null,
    severity: "ERROR",
  });
  assert.doesNotMatch(unknown.reason, /RAW_INTERNAL_EXCEPTION/u);
});

test("catalog issue evidence identifies the exact distractor collision from the source payload", () => {
  const evidence = catalogIssueEvidence(
    {
      code: "CATALOG_DISTRACTOR_ACCEPTED_COLLISION",
      field: "distractorEn",
      direction: "ZH_TO_EN",
      severity: "ERROR",
    },
    {
      term: "accept",
      definitionZh: "接受",
      acceptedAnswersZh: [],
      acceptedFormsEn: [],
      synonymsEn: ["receive"],
      antonymsEn: ["reject"],
      distractorZh: ["拒絕", "考慮", "離開", "發送", "刪除"],
      distractorEn: ["refuse", "reject", "receive", "leave", "remove"],
    },
  );
  assert.deepEqual(evidence, {
    summary: "重疊項目：receive",
    locations: [
      { field: "synonymsEn", index: 0, value: "receive" },
      { field: "distractorEn", index: 2, value: "receive" },
    ],
  });
  assert.equal(
    catalogIssueEvidenceLocationLabel(evidence!.locations[1]!),
    "中譯英干擾項第 3 項：「receive」",
  );
});

test("catalog export availability copy explains every non-selectable state", () => {
  assert.equal(
    catalogExportAvailabilityPresentation(
      "REQUIRES_GOVERNED_REVISION",
    )?.shortLabel,
    "尚未提交",
  );
  assert.equal(
    catalogExportAvailabilityPresentation("REVISION_UNAVAILABLE")?.shortLabel,
    "暫不可選取",
  );
  assert.equal(
    catalogExportAvailabilityPresentation("MISSING_SENSE_KEY")?.shortLabel,
    "暫不可選取",
  );
  assert.equal(
    catalogExportAvailabilityPresentation("EXPORTABLE", true)?.shortLabel,
    "正在審核",
  );
  assert.equal(catalogExportAvailabilityPresentation("EXPORTABLE"), null);
  assert.match(
    catalogExportAvailabilityPresentation("REQUIRES_GOVERNED_REVISION")!
      .reason,
    /匯出/u,
  );
});

test("every structured validator code has actionable teacher copy and legacy rows are upgraded", () => {
  for (const code of CATALOG_VALIDATION_ISSUE_CODES) {
    const copy = catalogIssuePresentation({
      code,
      field: null,
      direction: null,
      severity: code === "CATALOG_DIRECTIONS_DISABLED" ? "WARNING" : "ERROR",
    });
    assert.notEqual(copy.reason, "內容出現未能識別的檢查結果。", code);
    assert.ok(copy.fix.length > 0, code);
  }
  assert.equal(
    catalogLegacyValidationIssue("en-zh requires 5 or 6 distractors").code,
    "CATALOG_DISTRACTOR_COUNT",
  );
  assert.equal(
    catalogLegacyValidationIssue("both directions are disabled", "WARNING")
      .severity,
    "WARNING",
  );
  assert.notEqual(
    catalogIssuePresentation({
      code: CATALOG_UNSUPPORTED_STRUCTURED_ISSUE_CODE,
      field: null,
      direction: null,
      severity: "ERROR",
    }).reason,
    "內容出現未能識別的檢查結果。",
  );
});

test("catalog source summary hides raw paths from ordinary presentation", () => {
  const summary = catalogSourceSummary(
    "outputs/a1-word-catalog-reference-v1/a1-word-catalog-reference-v1.csv",
    2,
  );
  assert.equal(summary, "初始詞表 A1，第 2 行");
  assert.equal(catalogSourceSummary("governance", null), "老師詞庫修改");
});
