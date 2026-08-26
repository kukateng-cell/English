import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogWorkspaceQueryFingerprint,
  decodeCatalogWorkspaceCursor,
  encodeCatalogWorkspaceCursor,
  parseCatalogWorkspaceQuery,
} from "./workspace-query";

test("catalog workspace query normalizes supported filters", () => {
  const query = parseCatalogWorkspaceQuery(
    new URLSearchParams(
      "q=%EF%BC%A6riend++&status=ACTIVE&level=A1&direction=EN_ZH&limit=50",
    ),
  );
  assert.deepEqual(query, {
    filters: {
      q: "Friend",
      status: "ACTIVE",
      lifecycle: "ALL",
      workflow: "ALL",
      level: "A1",
      direction: "EN_ZH",
      partOfSpeech: "ALL",
      initial: "ALL",
      category: "ALL",
      readiness: "ALL",
      issues: "ALL",
      sort: "SOURCE_ORDER",
      mode: "LEGACY_V1",
    },
    limit: 50,
    cursor: null,
  });
});

test("catalog workspace query supports orthogonal filters and teacher sorting", () => {
  const query = parseCatalogWorkspaceQuery(
    new URLSearchParams(
      "lifecycle=ACTIVE&workflow=PENDING&level=B1&partOfSpeech=verb&initial=R&category=actions-events&readiness=BOTH&issues=PENDING_DRAFT&sort=ACTION_REQUIRED_FIRST",
    ),
  );
  assert.deepEqual(query.filters, {
    q: "",
    status: "ALL",
    lifecycle: "ACTIVE",
    workflow: "PENDING",
    level: "B1",
    direction: "ALL",
    partOfSpeech: "verb",
    initial: "R",
    category: "actions-events",
    readiness: "BOTH",
    issues: "PENDING_DRAFT",
    sort: "ACTION_REQUIRED_FIRST",
    mode: "WORKSPACE_V2",
  });
  assert.throws(
    () =>
      parseCatalogWorkspaceQuery(
        new URLSearchParams("status=ACTIVE&workflow=PENDING"),
      ),
    /CATALOG_QUERY_INVALID/,
  );
  assert.throws(
    () =>
      parseCatalogWorkspaceQuery(
        new URLSearchParams("category=raw-database-value"),
      ),
    /CATALOG_QUERY_INVALID/,
  );
});

test("legacy status cannot be mixed with v2 filters or sorting", () => {
  for (const query of [
    "status=ACTIVE&partOfSpeech=noun",
    "status=ALL&initial=A",
    "status=DRAFT&category=other",
    "status=PENDING&sort=TERM_ASC",
  ]) {
    assert.throws(
      () => parseCatalogWorkspaceQuery(new URLSearchParams(query)),
      /CATALOG_QUERY_INVALID/u,
    );
  }
});

test("catalog workspace query rejects duplicate, unknown and invalid values", () => {
  assert.throws(
    () =>
      parseCatalogWorkspaceQuery(
        new URLSearchParams("status=ACTIVE&status=DRAFT"),
      ),
    /CATALOG_QUERY_INVALID/,
  );
  assert.throws(
    () => parseCatalogWorkspaceQuery(new URLSearchParams("page=2")),
    /CATALOG_QUERY_INVALID/,
  );
  assert.throws(
    () => parseCatalogWorkspaceQuery(new URLSearchParams("level=C1")),
    /CATALOG_QUERY_INVALID/,
  );
  assert.throws(
    () => parseCatalogWorkspaceQuery(new URLSearchParams("limit=101")),
    /CATALOG_QUERY_INVALID/,
  );
  assert.throws(
    () =>
      parseCatalogWorkspaceQuery(new URLSearchParams(`q=${"a".repeat(101)}`)),
    /CATALOG_QUERY_INVALID/,
  );
});

test("catalog workspace cursor is signed and bound to query scope", () => {
  const filters = parseCatalogWorkspaceQuery(
    new URLSearchParams("status=ALL&q=run&level=B1"),
  ).filters;
  const fingerprint = catalogWorkspaceQueryFingerprint(
    filters,
    100,
    "reviewer",
  );
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
  assert.notEqual(
    fingerprint,
    catalogWorkspaceQueryFingerprint(filters, 100, "teacher:user-2"),
  );
});

test("catalog workspace v2 cursor carries sort and a signed snapshot cutoff", () => {
  const filters = parseCatalogWorkspaceQuery(
    new URLSearchParams("sort=TERM_DESC&initial=R"),
  ).filters;
  const fingerprint = catalogWorkspaceQueryFingerprint(
    filters,
    100,
    "reviewer",
  );
  const cursor = encodeCatalogWorkspaceCursor({
    offset: 100,
    fingerprint,
    workspaceSignature: "b".repeat(64),
    batchId: "batch-2",
    sort: "TERM_DESC",
    snapshotCutoff: "2026-08-26T08:00:00.000Z",
  });
  assert.deepEqual(decodeCatalogWorkspaceCursor(cursor), {
    v: 2,
    offset: 100,
    fingerprint,
    workspaceSignature: "b".repeat(64),
    batchId: "batch-2",
    sort: "TERM_DESC",
    snapshotCutoff: "2026-08-26T08:00:00.000Z",
  });
});

test("catalog workspace cursor rejects malformed payloads", () => {
  assert.equal(decodeCatalogWorkspaceCursor("not-a-cursor"), null);
  assert.equal(decodeCatalogWorkspaceCursor(null), null);
});
