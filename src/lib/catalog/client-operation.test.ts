import assert from "node:assert/strict";
import test from "node:test";
import { clientOperationFingerprint, pendingClientOperation } from "./client-operation";

test("client operation fingerprint is stable across object key order", () => {
  assert.equal(
    clientOperationFingerprint({ payload: { term: "run", level: "A1" }, reason: "fix" }),
    clientOperationFingerprint({ reason: "fix", payload: { level: "A1", term: "run" } }),
  );
});

test("same body reuses an operation id while changed input gets a new id", () => {
  let next = 0;
  const createId = () => `op-${++next}`;
  const first = pendingClientOperation(null, "body-a", createId);
  const retry = pendingClientOperation(first, "body-a", createId);
  const edited = pendingClientOperation(retry, "body-b", createId);
  assert.equal(retry.operationId, first.operationId);
  assert.notEqual(edited.operationId, first.operationId);
});
