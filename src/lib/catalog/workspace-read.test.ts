import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogStoredStructuredIssues,
  catalogStructuredIssuesFromImportRow,
} from "./workspace-read";
import {
  CATALOG_STRUCTURED_ISSUE_VERSION,
  CATALOG_UNSUPPORTED_STRUCTURED_ISSUE_CODE,
} from "./validation-issue-contract";

test("workspace consumes only the declared issue version and bounds legacy adaptation", () => {
  const current = catalogStoredStructuredIssues(
    {
      version: CATALOG_STRUCTURED_ISSUE_VERSION,
      issues: [],
    },
    ["term is required"],
    [],
  );
  assert.deepEqual(current, [], "current empty contract must not parse legacy text");

  const unsupported = catalogStoredStructuredIssues(
    { version: "catalog-structured-issues-v999", issues: [] },
    [],
    [],
  );
  assert.equal(unsupported[0]?.code, CATALOG_UNSUPPORTED_STRUCTURED_ISSUE_CODE);
  assert.equal(unsupported[0]?.severity, "ERROR");

  const legacy = catalogStoredStructuredIssues(
    { version: null, issues: [] },
    ["term is required"],
    [],
  );
  assert.equal(legacy[0]?.code, "CATALOG_TERM_REQUIRED");
});

test("detail import rows use the same bounded legacy issue adapter as the list", () => {
  const issues = catalogStructuredIssuesFromImportRow({
    errors: [
      "zh-en distractor collides with an accepted answer or answer-safety synonym/antonym",
    ],
    warnings: [],
  });
  assert.deepEqual(issues, [
    {
      code: "CATALOG_DISTRACTOR_ACCEPTED_COLLISION",
      field: "distractorEn",
      direction: "ZH_TO_EN",
      severity: "ERROR",
    },
  ]);
});

test("stored legacy collisions caused only by an antonym are obsolete under the current policy", () => {
  const issues = catalogStructuredIssuesFromImportRow(
    {
      errors: [
        "zh-en distractor collides with an accepted answer or answer-safety synonym/antonym",
      ],
      warnings: [],
    },
    {
      term: "accept",
      definitionZh: "接受",
      acceptedAnswersZh: [],
      acceptedFormsEn: [],
      synonymsEn: [],
      antonymsEn: ["reject"],
      distractorZh: ["拒絕", "考慮", "離開", "發送", "刪除"],
      distractorEn: ["refuse", "reject", "consider", "leave", "remove"],
    },
  );
  assert.deepEqual(issues, []);
});

test("stored sibling-sense collisions are obsolete under row-local validation", () => {
  const issues = catalogStructuredIssuesFromImportRow({
    errors: ["en-zh distractor collides with a sibling-sense answer"],
    warnings: [],
  });
  assert.deepEqual(issues, []);
});
