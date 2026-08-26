import assert from "node:assert/strict";
import test from "node:test";
import { catalogStoredStructuredIssues } from "./workspace-read";
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
