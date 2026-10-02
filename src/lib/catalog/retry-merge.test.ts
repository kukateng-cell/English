import assert from "node:assert/strict";
import test from "node:test";
import type { CatalogGovernancePayload } from "./governance";
import {
  applyCatalogRetryPayloadPatch,
  catalogRetryPayloadPatch,
  threeWayMergeCatalogPayload,
} from "./retry-merge";

function payload(overrides: Partial<CatalogGovernancePayload> = {}): CatalogGovernancePayload {
  return {
    term: "run",
    lemma: "run",
    partOfSpeech: "verb",
    level: "A1",
    category: "actions",
    definitionZh: "跑步",
    acceptedAnswersZh: ["跑步"],
    phoneticIpa: "/rʌn/",
    exampleEn: "I run every day.",
    exampleZh: "我每日跑步。",
    acceptedFormsEn: ["run"],
    synonymsEn: [],
    antonymsEn: [],
    enableEnToZh: true,
    distractorZh: ["步行", "跳躍", "游泳", "駕駛", "攀爬", "飛行"],
    enableZhToEn: true,
    distractorEn: ["walk", "jump", "swim", "drive", "climb", "fly"],
    sourceReference: null,
    contributorRef: null,
    changeNote: null,
    retirementReason: null,
    ...overrides,
  };
}

test("retry merge preserves current values for fields untouched by the rejected proposal", () => {
  const base = payload();
  const proposal = payload({ definitionZh: "奔跑" });
  const current = payload({ exampleEn: "We run after school.", distractorEn: ["walk", "jump", "swim", "drive", "climb", "crawl"] });
  const merged = threeWayMergeCatalogPayload({ base, proposal, current });
  assert.deepEqual(merged.unresolvedFields, []);
  assert.equal(merged.payload.definitionZh, "奔跑");
  assert.equal(merged.payload.exampleEn, "We run after school.");
  assert.deepEqual(merged.payload.distractorEn, current.distractorEn);
});

test("retry merge reports same-field divergence and requires an explicit choice", () => {
  const base = payload();
  const proposal = payload({ definitionZh: "奔跑" });
  const current = payload({ definitionZh: "跑動" });
  const unresolved = threeWayMergeCatalogPayload({ base, proposal, current });
  assert.deepEqual(unresolved.unresolvedFields, ["definitionZh"]);
  assert.equal(unresolved.payload.definitionZh, "跑動");
  const resolved = threeWayMergeCatalogPayload({ base, proposal, current, choices: { definitionZh: "PROPOSAL" } });
  assert.deepEqual(resolved.unresolvedFields, []);
  assert.equal(resolved.payload.definitionZh, "奔跑");
});

test("retry patch contains only deliberate edits after the server merge baseline", () => {
  const baseline = payload({ exampleEn: "We run after school." });
  const edited = payload({ exampleEn: "We run after school.", definitionZh: "奔跑" });
  const patch = catalogRetryPayloadPatch(baseline, edited);
  assert.deepEqual(patch, { definitionZh: "奔跑" });
  assert.deepEqual(applyCatalogRetryPayloadPatch(baseline, patch), edited);
});
