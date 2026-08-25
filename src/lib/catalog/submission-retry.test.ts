import assert from "node:assert/strict";
import test from "node:test";
import type { CatalogGovernancePayload } from "./governance";
import { threeWayMergeCatalogPayload } from "./retry-merge";
import {
  catalogRetryEffectiveKind,
  catalogRetryGroupsAreContentOnly,
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
