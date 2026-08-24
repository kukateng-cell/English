import test from "node:test";
import assert from "node:assert/strict";
import { catalogWorkspaceSignature } from "./catalog/workspace-version";

test("catalog workspace signature changes for canonical and queue-only mutations", () => {
  const baseline = catalogWorkspaceSignature(4, "queue-digest-a", 1);
  assert.equal(catalogWorkspaceSignature(4, "queue-digest-a", 1), baseline);
  assert.notEqual(catalogWorkspaceSignature(5, "queue-digest-a", 1), baseline);
  assert.notEqual(catalogWorkspaceSignature(4, "queue-digest-b", 1), baseline);
  assert.notEqual(catalogWorkspaceSignature(4, "queue-digest-a", 0), baseline);
});
