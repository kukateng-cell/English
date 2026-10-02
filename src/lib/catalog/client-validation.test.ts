import assert from "node:assert/strict";
import test from "node:test";
import { catalogValidationResponseErrorMessage } from "./client-validation";
import { CATALOG_STRUCTURED_ISSUE_VERSION } from "./validation-issue-contract";

const translate = (value: string) => value;

test("client renders only the declared structured issue contract", async () => {
  const body = {
    code: "CATALOG_PAYLOAD_REJECTED",
    structuredIssueVersion: CATALOG_STRUCTURED_ISSUE_VERSION,
    issues: [
      {
        code: "CATALOG_TERM_REQUIRED",
        field: "term",
        direction: null,
        severity: "ERROR",
      },
    ],
  };
  const message = await catalogValidationResponseErrorMessage(
    new Response(JSON.stringify(body), { status: 422 }),
    translate,
  );
  assert.match(message, /英文詞/u);
  assert.match(message, /尚未填寫英文詞/u);

  const futureMessage = await catalogValidationResponseErrorMessage(
    new Response(
      JSON.stringify({
        ...body,
        structuredIssueVersion: "catalog-structured-issues-v999",
      }),
      { status: 422 },
    ),
    translate,
  );
  assert.doesNotMatch(futureMessage, /尚未填寫英文詞/u);
});
