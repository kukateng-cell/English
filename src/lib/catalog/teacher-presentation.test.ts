import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogCategoryLabel,
  catalogHistorySourceLabel,
  catalogIssuePresentation,
  catalogLifecycleLabel,
  catalogPartOfSpeechLabel,
  catalogReadinessLabel,
  catalogRequestStatusLabel,
  catalogSourceSummary,
  catalogWorkflowLabel,
} from "./teacher-presentation";

test("catalog teacher presentation keeps lifecycle, workflow and readiness orthogonal", () => {
  assert.equal(catalogLifecycleLabel("ACTIVE"), "已啟用");
  assert.equal(catalogWorkflowLabel("PENDING"), "有修改等待審核");
  assert.equal(catalogReadinessLabel("EN_TO_ZH_ONLY"), "只可英譯中");
});

test("catalog teacher presentation maps taxonomy and safely falls back", () => {
  assert.equal(catalogPartOfSpeechLabel("noun"), "名詞");
  assert.equal(
    catalogPartOfSpeechLabel("unexpected-internal-enum"),
    "其他詞性",
  );
  assert.equal(catalogCategoryLabel("people-family"), "人物與家庭");
  assert.equal(catalogCategoryLabel("unexpected-internal-enum"), "其他主題");
  assert.equal(catalogRequestStatusLabel("UNKNOWN"), "未能識別的記錄狀態");
  assert.equal(catalogHistorySourceLabel("UNKNOWN"), "未能識別的記錄來源");
});

test("catalog issue presentation gives a field, reason and next step without raw validator text", () => {
  const issue = catalogIssuePresentation({
    code: "CATALOG_DISTRACTOR_COUNT",
    field: "distractorEn",
    direction: "ZH_TO_EN",
  });
  assert.equal(issue.fieldLabel, "中譯英干擾項");
  assert.equal(issue.directionLabel, "中譯英");
  assert.match(issue.reason, /5 至 6/u);
  assert.match(issue.fix, /補充|刪減/u);
  const unknown = catalogIssuePresentation({
    code: "RAW_INTERNAL_EXCEPTION",
    field: null,
    direction: null,
  });
  assert.doesNotMatch(unknown.reason, /RAW_INTERNAL_EXCEPTION/u);
});

test("catalog source summary hides raw paths from ordinary presentation", () => {
  const summary = catalogSourceSummary(
    "outputs/a1-word-catalog-reference-v1/a1-word-catalog-reference-v1.csv",
    2,
  );
  assert.equal(summary, "初始詞表 A1，第 2 行");
  assert.equal(catalogSourceSummary("governance", null), "老師詞庫修改");
});
