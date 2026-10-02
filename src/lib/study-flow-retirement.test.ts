import assert from "node:assert/strict";
import test from "node:test";
import { studyFlowRetiredResponse, STUDY_FLOW_RETIRED } from "./study-flow-retirement";

test("retired study endpoints expose one cache-safe no-write contract", async () => {
  const response = studyFlowRetiredResponse();
  assert.equal(response.status, 410);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), STUDY_FLOW_RETIRED);
});
