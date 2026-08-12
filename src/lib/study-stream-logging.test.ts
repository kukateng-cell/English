import assert from "node:assert/strict";
import test from "node:test";
import { describeStudyStreamFailure } from "@/lib/study-stream/logging";

test("V2 failure logging is an allowlisted shape without request details", () => {
  const secret = "opaque-credential-and-correct-answer";
  const error = Object.assign(new Error(`${secret} selectedOptionId`), { code: "P2025" });
  const description = describeStudyStreamFailure(error);
  assert.deepEqual(description, { errorType: "Error", errorCode: "P2025" });
  assert.equal(JSON.stringify(description).includes(secret), false);
});
