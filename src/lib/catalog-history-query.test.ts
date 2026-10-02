import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogHistoryFilterFingerprint,
  decodeCatalogBatchChildCursor,
  decodeCatalogHistoryCursor,
  encodeCatalogBatchChildCursor,
  encodeCatalogHistoryCursor,
  normalizeCatalogHistoryFilters,
} from "./catalog/history-query";

test("catalog history cursor is signed and bound to its immutable payload", () => {
  const cursor = encodeCatalogHistoryCursor({
    occurredAt: "2026-08-22T00:00:00.000Z",
    sourceKind: "BATCH",
    id: "feed-1",
    cutoff: "2026-08-22T01:00:00.000Z",
    scope: "TEACHER:user-1",
    fingerprint: "filter-1",
  });
  assert.equal(decodeCatalogHistoryCursor(cursor)?.id, "feed-1");
  const [body, signature] = cursor.split(".");
  const changedBody = `${body!.slice(0, -1)}${body!.endsWith("A") ? "B" : "A"}`;
  assert.equal(decodeCatalogHistoryCursor(`${changedBody}.${signature}`), null);
});

test("batch child cursor cannot be replayed against another batch", () => {
  const cursor = encodeCatalogBatchChildCursor("batch-1", "group-20");
  assert.equal(decodeCatalogBatchChildCursor(cursor, "batch-1"), "group-20");
  assert.equal(decodeCatalogBatchChildCursor(cursor, "batch-2"), null);
});

test("catalog history filters reject unknown, malformed and reversed ranges", () => {
  assert.deepEqual(normalizeCatalogHistoryFilters({ status: "APPROVED", search: "  run  " }), { search: "run", status: "APPROVED" });
  assert.throws(() => normalizeCatalogHistoryFilters({ unexpected: "value" }), /CATALOG_HISTORY_FILTER_INVALID/u);
  assert.throws(() => normalizeCatalogHistoryFilters({ status: "ACTIVE" }), /CATALOG_HISTORY_FILTER_INVALID/u);
  assert.throws(() => normalizeCatalogHistoryFilters({ search: 3 }), /CATALOG_HISTORY_FILTER_INVALID/u);
  assert.throws(() => normalizeCatalogHistoryFilters({ dateFrom: "2026-08-23T00:00:00+08:00", dateTo: "2026-08-22T00:00:00+08:00" }), /CATALOG_HISTORY_FILTER_INVALID/u);
});

test("catalog history filter fingerprint is order independent", () => {
  const first = normalizeCatalogHistoryFilters({ status: "APPROVED", level: "A1" });
  const second = normalizeCatalogHistoryFilters({ level: "A1", status: "APPROVED" });
  assert.equal(catalogHistoryFilterFingerprint(first), catalogHistoryFilterFingerprint(second));
});
