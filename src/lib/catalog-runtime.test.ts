import assert from "node:assert/strict";
import test from "node:test";
import {
  currentCatalogReviewEventWhere,
  currentCatalogSenseWhere,
  currentCatalogWordWhere,
} from "@/lib/catalog/runtime";

test("current catalog predicates are ACTIVE-only and environment-independent", () => {
  const senseWhere = currentCatalogSenseWhere();
  assert.deepEqual(senseWhere, {
    status: "ACTIVE",
    approvedRevision: {
      is: {
        catalogRevision: { status: "READY" },
      },
    },
  });
  assert.equal(JSON.stringify(senseWhere).includes("CatalogEligibility"), false);
  assert.equal(JSON.stringify(senseWhere).includes("DRAFT"), false);
  assert.deepEqual(currentCatalogWordWhere(), {
    senseId: { not: null },
    catalogRevision: { status: "READY" },
    sense: senseWhere,
  });
  assert.deepEqual(currentCatalogReviewEventWhere(), {
    eventKind: "REVIEW",
    isHistorical: false,
    senseId: { not: null },
    sense: senseWhere,
  });
});
