import assert from "node:assert/strict";
import test from "node:test";
import {
  canReadCatalogFeedback,
  canResolveCatalogFeedback,
  parseCatalogFeedbackInput,
  parseCatalogFeedbackResolution,
} from "@/lib/catalog/feedback";
import {
  actionableCatalogWorkCount,
  batchNeedsRevision,
  catalogBatchNeedsRevisionWhere,
  catalogBatchReviewWhere,
  standaloneRequestNeedsRevision,
} from "@/lib/catalog/work-items";

test("feedback accepts a compact word report and normalizes text", () => {
  assert.deepEqual(parseCatalogFeedbackInput({
    operationId: "  op-1  ",
    senseKey: " sense-run-a1 ",
    term: " run ",
    kind: "DISTRACTOR",
    message: "  干擾項太容易  ",
    suggestedValue: "  改用較相近詞義  ",
  }), {
    operationId: "op-1",
    senseKey: "sense-run-a1",
    term: "run",
    kind: "DISTRACTOR",
    message: "干擾項太容易",
    suggestedValue: "改用較相近詞義",
  });
});

test("missing-word feedback requires a term and resolution uses CAS input", () => {
  assert.throws(() => parseCatalogFeedbackInput({ operationId: "op", kind: "MISSING_WORD", message: "應該加入" }), /CATALOG_FEEDBACK_TERM_REQUIRED/u);
  assert.deepEqual(parseCatalogFeedbackResolution({ status: "RESOLVED", resolutionNote: "已建立修改草稿", expectedRevision: 0 }), {
    status: "RESOLVED",
    resolutionNote: "已建立修改草稿",
    expectedRevision: 0,
  });
  assert.throws(() => parseCatalogFeedbackResolution({ status: "RESOLVED", resolutionNote: "ok", expectedRevision: 0 }), /CATALOG_FEEDBACK_RESOLUTION_INVALID/u);
});

test("feedback visibility is owner-or-reviewer and self-resolution is forbidden", () => {
  assert.equal(canReadCatalogFeedback({ actorId: "reporter", reporterId: "reporter", canReview: false }), true);
  assert.equal(canReadCatalogFeedback({ actorId: "other", reporterId: "reporter", canReview: false }), false);
  assert.equal(canReadCatalogFeedback({ actorId: "reviewer", reporterId: "reporter", canReview: true }), true);
  assert.equal(canResolveCatalogFeedback({ actorId: "reporter", reporterId: "reporter", canReview: true, status: "OPEN" }), false);
  assert.equal(canResolveCatalogFeedback({ actorId: "reviewer", reporterId: "reporter", canReview: true, status: "OPEN" }), true);
  assert.equal(canResolveCatalogFeedback({ actorId: "reviewer", reporterId: "reporter", canReview: true, status: "RESOLVED" }), false);
});

test("only unsuperseded rejected or stale owner items remain actionable", () => {
  assert.equal(standaloneRequestNeedsRevision({ status: "REJECTED", proposerId: "teacher", actorId: "teacher", supersededById: null }), true);
  assert.equal(standaloneRequestNeedsRevision({ status: "REJECTED", proposerId: "teacher", actorId: "teacher", supersededById: "successor" }), false);
  assert.equal(batchNeedsRevision({ status: "STALE", proposerId: "teacher", resolutionOwnerId: null, actorId: "teacher", retriedById: null }), true);
  assert.equal(batchNeedsRevision({ status: "STALE", proposerId: "teacher", resolutionOwnerId: null, actorId: "teacher", retriedById: "retry-1" }), false);
  assert.equal(actionableCatalogWorkCount({ requestsToRevise: 1, batchesToRevise: 2, requestsToReview: 3, batchesToReview: 4, feedbackToReview: 5 }), 15);
});

test("a claimed resolution batch belongs to exactly one actionable bucket", () => {
  const actorId = "reviewer";
  const revisionWhere = catalogBatchNeedsRevisionWhere(actorId);
  const reviewWhere = catalogBatchReviewWhere(actorId);

  assert.deepEqual(revisionWhere.OR?.[2], {
    status: "NEEDS_RESOLUTION",
    OR: [
      { proposerId: actorId, resolutionOwnerId: null },
      { resolutionOwnerId: actorId },
    ],
  });
  assert.deepEqual(reviewWhere.OR?.[0], {
    status: "NEEDS_RESOLUTION",
    resolutionOwnerId: null,
  });
});
