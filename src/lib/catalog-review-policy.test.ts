import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCatalogReviewSeparation,
  catalogRequestTerminalStatus,
  parseCatalogExpectedRevision,
} from "./catalog/review-policy";

test("one independent catalog reviewer can make the final decision", () => {
  assert.doesNotThrow(() => assertCatalogReviewSeparation({
    kind: "UPDATE",
    decision: "APPROVE",
    batchMode: false,
    proposerId: "teacher-a",
    reviewerId: "teacher-b",
  }));
});

test("ordinary catalog proposals cannot be self-reviewed", () => {
  assert.throws(
    () => assertCatalogReviewSeparation({
      kind: "RETIRE",
      decision: "APPROVE",
      batchMode: false,
      proposerId: "teacher-a",
      reviewerId: "teacher-a",
    }),
    /CATALOG_SELF_REVIEW_FORBIDDEN/,
  );
});

test("authorized immediate retirement is the only standalone self-completing change", () => {
  assert.doesNotThrow(() => assertCatalogReviewSeparation({
    mode: "AUTHORIZED_IMMEDIATE_RETIRE",
    kind: "RETIRE",
    decision: "APPROVE",
    batchMode: false,
    proposerId: "reviewer-a",
    reviewerId: "reviewer-a",
  }));

  for (const invalid of [
    { kind: "UPDATE", decision: "APPROVE" as const, batchMode: false, proposerId: "reviewer-a", reviewerId: "reviewer-a" },
    { kind: "RETIRE", decision: "REJECT" as const, batchMode: false, proposerId: "reviewer-a", reviewerId: "reviewer-a" },
    { kind: "RETIRE", decision: "APPROVE" as const, batchMode: true, proposerId: "reviewer-a", reviewerId: "reviewer-a" },
    { kind: "RETIRE", decision: "APPROVE" as const, batchMode: false, proposerId: "teacher-a", reviewerId: "reviewer-a" },
  ]) {
    assert.throws(
      () => assertCatalogReviewSeparation({ mode: "AUTHORIZED_IMMEDIATE_RETIRE", ...invalid }),
      /CATALOG_IMMEDIATE_RETIRE_POLICY_INVALID/,
    );
  }
});

test("terminal catalog request status exposes the first resolved outcome", () => {
  assert.equal(catalogRequestTerminalStatus("PENDING"), null);
  assert.equal(catalogRequestTerminalStatus("APPROVED"), "APPROVED");
  assert.equal(catalogRequestTerminalStatus("REJECTED"), "REJECTED");
  assert.equal(catalogRequestTerminalStatus("CANCELLED"), "CANCELLED");
});

test("existing-sense changes require a positive revision and CREATE forbids one", () => {
  for (const operation of ["UPDATE", "RETIRE", "REACTIVATE"] as const) {
    assert.equal(parseCatalogExpectedRevision(3, operation), 3);
    assert.equal(parseCatalogExpectedRevision("4", operation), 4);
    assert.throws(() => parseCatalogExpectedRevision(undefined, operation), /CATALOG_REVISION_REQUIRED/);
    assert.throws(() => parseCatalogExpectedRevision(0, operation), /CATALOG_REVISION_INVALID/);
    assert.throws(() => parseCatalogExpectedRevision("revision-one", operation), /CATALOG_REVISION_INVALID/);
  }
  assert.equal(parseCatalogExpectedRevision(undefined, "CREATE"), null);
  assert.equal(parseCatalogExpectedRevision(null, "CREATE"), null);
  assert.throws(() => parseCatalogExpectedRevision(1, "CREATE"), /CATALOG_REVISION_NOT_ALLOWED/);
});
