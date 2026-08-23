import test from "node:test";
import assert from "node:assert/strict";
import { catalogWorkspaceSignature } from "./catalog/workspace-version";

test("catalog workspace signature changes for canonical and queue-only mutations", () => {
  const pending = [{ id: "request-a", revision: 0 }];
  const baseline = catalogWorkspaceSignature(4, pending, false);
  assert.equal(catalogWorkspaceSignature(4, pending, false), baseline);
  assert.notEqual(catalogWorkspaceSignature(5, pending, false), baseline);
  assert.notEqual(catalogWorkspaceSignature(4, [{ id: "request-a", revision: 1 }], false), baseline);
  assert.notEqual(catalogWorkspaceSignature(4, [], false), baseline);
  assert.notEqual(catalogWorkspaceSignature(4, pending, true), baseline);
});
