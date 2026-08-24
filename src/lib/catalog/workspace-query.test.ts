import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogWorkspaceQueryFingerprint,
  decodeCatalogWorkspaceCursor,
  encodeCatalogWorkspaceCursor,
  parseCatalogWorkspaceQuery,
} from "./workspace-query";

test("catalog workspace query normalizes supported filters", () => {
  const query = parseCatalogWorkspaceQuery(new URLSearchParams("q=%EF%BC%A6riend++&status=ACTIVE&level=A1&direction=EN_ZH&limit=50"));
  assert.deepEqual(query, {
    filters: { q: "Friend", status: "ACTIVE", level: "A1", direction: "EN_ZH" },
    limit: 50,
    cursor: null,
  });
});

test("catalog workspace query rejects duplicate, unknown and invalid values", () => {
  assert.throws(() => parseCatalogWorkspaceQuery(new URLSearchParams("status=ACTIVE&status=DRAFT")), /CATALOG_QUERY_INVALID/);
  assert.throws(() => parseCatalogWorkspaceQuery(new URLSearchParams("page=2")), /CATALOG_QUERY_INVALID/);
  assert.throws(() => parseCatalogWorkspaceQuery(new URLSearchParams("level=C1")), /CATALOG_QUERY_INVALID/);
  assert.throws(() => parseCatalogWorkspaceQuery(new URLSearchParams("limit=101")), /CATALOG_QUERY_INVALID/);
  assert.throws(() => parseCatalogWorkspaceQuery(new URLSearchParams(`q=${"a".repeat(101)}`)), /CATALOG_QUERY_INVALID/);
});

test("catalog workspace cursor is signed and bound to query scope", () => {
  const filters = { q: "run", status: "ALL", level: "B1", direction: "ALL" } as const;
  const fingerprint = catalogWorkspaceQueryFingerprint(filters, 100, "reviewer");
  const cursor = encodeCatalogWorkspaceCursor({
    offset: 100,
    fingerprint,
    workspaceSignature: "a".repeat(64),
    batchId: "batch-1",
  });
  assert.deepEqual(decodeCatalogWorkspaceCursor(cursor), {
    v: 1,
    offset: 100,
    fingerprint,
    workspaceSignature: "a".repeat(64),
    batchId: "batch-1",
  });
  const last = cursor.at(-1)!;
  const tampered = `${cursor.slice(0, -1)}${last === "a" ? "b" : "a"}`;
  assert.equal(decodeCatalogWorkspaceCursor(tampered), null);
  assert.notEqual(fingerprint, catalogWorkspaceQueryFingerprint(filters, 100, "teacher:user-2"));
});

test("catalog workspace cursor rejects malformed payloads", () => {
  assert.equal(decodeCatalogWorkspaceCursor("not-a-cursor"), null);
  assert.equal(decodeCatalogWorkspaceCursor(null), null);
});
