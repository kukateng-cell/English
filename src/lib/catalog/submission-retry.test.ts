import assert from "node:assert/strict";
import test from "node:test";
import { payloadToSourceRow, type CatalogGovernancePayload } from "./governance";
import { threeWayMergeCatalogPayload } from "./retry-merge";
import {
  evaluateCatalogRetryPreviewActionability,
  type CatalogSubmissionPreview,
} from "./submission";
import {
  applyCatalogRetryMergeConflicts,
  catalogRetryEffectiveKind,
  catalogRetryGroupsAreContentOnly,
  mergeCatalogRetryConflictFields,
  parseCatalogRetryMergeConflictFields,
  retryableCatalogContentGroups,
} from "./submission-retry";

function payload(overrides: Partial<CatalogGovernancePayload> = {}): CatalogGovernancePayload {
  return {
    term: "run", lemma: "run", partOfSpeech: "verb", level: "A1", category: "actions",
    definitionZh: "跑步", acceptedAnswersZh: ["跑步"], phoneticIpa: "/rʌn/",
    exampleEn: "I run every day.", exampleZh: "我每日跑步。", acceptedFormsEn: ["run"],
    synonymsEn: [], antonymsEn: [], enableEnToZh: true,
    distractorZh: ["步行", "跳躍", "游泳", "駕駛", "攀爬", "飛行"],
    enableZhToEn: true, distractorEn: ["walk", "jump", "swim", "drive", "climb", "fly"],
    sourceReference: null, contributorRef: null, changeNote: null, retirementReason: null,
    ...overrides,
  };
}

test("batch retry preserves the effective child operation and excludes rejected proposals", () => {
  const groups = [
    {
      requestedAction: "CREATE" as const,
      resolution: "REPLACE_EXISTING",
      changeRequest: { kind: "UPDATE" as const },
      id: "replacement",
    },
    {
      requestedAction: "CREATE" as const,
      resolution: "REJECT",
      changeRequest: null,
      id: "excluded",
    },
  ];
  const retryable = retryableCatalogContentGroups(groups);
  assert.deepEqual(retryable.map((group) => group.id), ["replacement"]);
  assert.equal(catalogRetryEffectiveKind(retryable[0]!), "UPDATE");
  assert.equal(catalogRetryGroupsAreContentOnly(retryable), true);
});

test("status-only corrective groups are not eligible for ordinary CSV retry", () => {
  assert.equal(catalogRetryGroupsAreContentOnly([{
    requestedAction: "RETIRE",
    resolution: "KEEP_SEPARATE",
    changeRequest: { kind: "RETIRE" },
  }]), false);
});

test("CREATE plus REPLACE_EXISTING retry uses UPDATE merge and preserves intervening approved fields", () => {
  const group = {
    requestedAction: "CREATE" as const,
    resolution: "REPLACE_EXISTING",
    changeRequest: { kind: "UPDATE" as const },
  };
  assert.equal(catalogRetryEffectiveKind(group), "UPDATE");

  const base = payload();
  const proposal = payload({ definitionZh: "奔跑" });
  const current = payload({
    exampleEn: "We run after school.",
    distractorEn: ["walk", "jump", "swim", "drive", "climb", "crawl"],
  });
  const merged = threeWayMergeCatalogPayload({ base, proposal, current });
  assert.deepEqual(merged.unresolvedFields, []);
  assert.equal(merged.payload.definitionZh, "奔跑");
  assert.equal(merged.payload.exampleEn, "We run after school.");
  assert.deepEqual(merged.payload.distractorEn, current.distractorEn);
});

test("effective UPDATE retry still reports conflicting same-field edits", () => {
  const base = payload();
  const proposal = payload({ definitionZh: "奔跑" });
  const current = payload({ definitionZh: "跑動" });
  const merged = threeWayMergeCatalogPayload({ base, proposal, current });
  assert.deepEqual(merged.unresolvedFields, ["definitionZh"]);
});

test("batch retry conflict metadata is validated, de-duplicated, and kept in canonical order", () => {
  assert.deepEqual(
    parseCatalogRetryMergeConflictFields(["exampleEn", "definitionZh", "exampleEn"]),
    ["definitionZh", "exampleEn"],
  );
  assert.deepEqual(
    mergeCatalogRetryConflictFields(["exampleEn"], ["definitionZh", "exampleEn"]),
    ["definitionZh", "exampleEn"],
  );
  assert.throws(
    () => parseCatalogRetryMergeConflictFields(["notAField"]),
    /CATALOG_BATCH_RETRY_STALE/u,
  );
});

test("batch retry preview fails closed for validation errors and empty rebases", () => {
  const summary = {
    totalRows: 1,
    validRows: 0,
    invalidRows: 1,
    proposalGroups: 0,
    unresolvedGroups: 0,
    createGroups: 0,
    updateGroups: 0,
  };
  const blocked: CatalogSubmissionPreview = {
    status: "NEEDS_RESOLUTION",
    groups: [],
    summary,
    rows: [{
      rowNumber: 2,
      rowDigest: "blocked-row",
      requestedAction: "UPDATE",
      primaryDisposition: "VALIDATION_FAILED",
      warnings: [],
      errors: ["UPDATE target already has a pending request"],
      normalizedTerm: "run",
      normalizedLemma: "run",
      normalizedSourcePayload: payload(),
      proposalGroupNumber: null,
      rowRole: "EXCLUDED",
    }],
  };
  assert.deepEqual(
    evaluateCatalogRetryPreviewActionability(blocked, [payloadToSourceRow(payload(), {
      sourceFile: "retry.csv",
      sourceRow: 2,
      catalogKey: "cat_run",
      senseKey: "sense_run_verb_a1",
    }, 1)]),
    {
      kind: "BLOCKED",
      rows: [{
        rowNumber: 2,
        senseKey: "sense_run_verb_a1",
        term: "run",
        errors: ["目標詞條已有另一項待審核修改。 等待現有修改完成審核後，再重新建立修正版預覽。"],
      }],
    },
  );

  const empty: CatalogSubmissionPreview = {
    status: "PREVIEW",
    groups: [],
    rows: [{ ...blocked.rows[0]!, primaryDisposition: "NO_CHANGE", errors: [] }],
    summary: { ...summary, validRows: 1, invalidRows: 0 },
  };
  assert.deepEqual(evaluateCatalogRetryPreviewActionability(empty), { kind: "NO_CHANGES" });
});

test("an inherited retry conflict that rebases to NO_CHANGE does not block another actionable group", () => {
  const summary = {
    totalRows: 2,
    validRows: 2,
    invalidRows: 0,
    proposalGroups: 1,
    unresolvedGroups: 0,
    createGroups: 0,
    updateGroups: 1,
  };
  const preview: CatalogSubmissionPreview = {
    status: "PREVIEW",
    summary,
    rows: [
      {
        rowNumber: 2,
        rowDigest: "resolved-conflict",
        requestedAction: "UPDATE",
        primaryDisposition: "NO_CHANGE",
        warnings: [],
        errors: [],
        normalizedTerm: "run",
        normalizedLemma: "run",
        normalizedSourcePayload: payload({ definitionZh: "奔跑" }),
        proposalGroupNumber: null,
        rowRole: "EXCLUDED",
      },
      {
        rowNumber: 3,
        rowDigest: "actionable-update",
        requestedAction: "UPDATE",
        primaryDisposition: "UPDATE",
        warnings: [],
        errors: [],
        normalizedTerm: "walk",
        normalizedLemma: "walk",
        normalizedSourcePayload: payload({ term: "walk", lemma: "walk", definitionZh: "步行" }),
        proposalGroupNumber: 1,
        rowRole: "CANONICAL_SOURCE",
      },
    ],
    groups: [{
      groupNumber: 1,
      requestedAction: "UPDATE",
      sourceRowNumbers: [3],
      resolution: "KEEP_SEPARATE",
      resolutionReason: null,
      targetCatalogKey: "cat_walk",
      targetSenseKey: "sense_walk_verb_a1",
      targetSenseId: "sense-walk-id",
      baseRevision: 2,
      baseStatus: "ACTIVE",
      dependencyDigest: "dependency",
      finalProposalPayload: payload({ term: "walk", lemma: "walk", definitionZh: "步行" }),
      payloadDigest: "payload",
      reviewRisk: "MATERIAL",
      reviewRiskReason: ["definitionZh"],
      needsResolution: false,
    }],
  };

  const conflictsByGroup = applyCatalogRetryMergeConflicts(
    preview,
    new Map([[2, ["definitionZh"]]]),
  );

  assert.deepEqual(evaluateCatalogRetryPreviewActionability(preview), { kind: "ACTIONABLE" });
  assert.equal(conflictsByGroup.size, 0);
  assert.equal(preview.status, "PREVIEW");
  assert.equal(preview.summary.unresolvedGroups, 0);
  assert.equal(preview.rows[0]!.primaryDisposition, "NO_CHANGE");
  assert.equal(preview.rows[1]!.primaryDisposition, "UPDATE");
  assert.equal(preview.groups[0]!.needsResolution, false);
});
