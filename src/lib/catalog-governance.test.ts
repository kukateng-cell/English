import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCatalogGovernancePayload,
  payloadFingerprint,
  payloadToSourceRow,
  splitListForEditor,
  parseEditorList,
  validateCatalogGovernancePayload,
  type CatalogGovernancePayload,
} from "./catalog/governance";

const payload: CatalogGovernancePayload = {
  term: "run",
  lemma: "run",
  partOfSpeech: "verb",
  level: "A1",
  category: "actions",
  definitionZh: "跑步",
  acceptedAnswersZh: ["跑步"],
  phoneticIpa: "/rʌn/",
  exampleEn: "I run every morning.",
  exampleZh: "我每天早上跑步。",
  acceptedFormsEn: ["run"],
  synonymsEn: [],
  antonymsEn: [],
  enableEnToZh: true,
  distractorZh: ["跳躍", "行走", "游泳", "站立", "坐下"],
  enableZhToEn: true,
  distractorEn: ["walk", "jump", "swim", "stand", "sit"],
  retirementReason: null,
};

test("governance payload never serializes student-facing prompts", () => {
  const row = payloadToSourceRow(payload, { catalogKey: "people-actions", senseKey: "run-a1", sourceFile: "governance", sourceRow: 0 }, 1);
  assert.equal(row.prompt_en, "");
  assert.equal(row.prompt_zh, "");
});

test("governance validation keeps each sense identity and rejects sibling answers", () => {
  const sibling = validateCatalogGovernancePayload({ ...payload, definitionZh: "經營", acceptedAnswersZh: ["經營"] }, { catalogKey: "business", senseKey: "run-b1", sourceFile: "fixture", sourceRow: 1 }, 1).row;
  const result = validateCatalogGovernancePayload({ ...payload, distractorZh: ["經營", "跳躍", "行走", "游泳", "站立"] }, { catalogKey: "actions", senseKey: "run-a1", sourceFile: "fixture", sourceRow: 2 }, 1, [sibling]);
  assert.ok(result.errors.includes("en-zh distractor collides with a sibling-sense answer"));
  assert.equal(result.row.senseKey, "run-a1");
});

test("editor list round-trip and request fingerprint are deterministic", () => {
  const editorValue = splitListForEditor(["跳躍", "行走", "游泳"]);
  assert.deepEqual(parseEditorList(editorValue), ["跳躍", "行走", "游泳"]);
  assert.equal(payloadFingerprint({ kind: "UPDATE", payload }), payloadFingerprint({ kind: "UPDATE", payload }));
  assert.notEqual(payloadFingerprint({ kind: "UPDATE", payload }), payloadFingerprint({ kind: "UPDATE", payload: { ...payload, level: "A2" } }));
});

test("governance parser rejects malformed booleans and preserves null optional fields", () => {
  assert.throws(() => parseCatalogGovernancePayload({ ...payload, enableEnToZh: "TRUE" }), /enableEnToZh must be boolean/);
  const parsed = parseCatalogGovernancePayload({ ...payload, phoneticIpa: "", exampleEn: "", exampleZh: "" });
  assert.equal(parsed.phoneticIpa, null);
  assert.equal(parsed.exampleEn, null);
  assert.equal(parsed.exampleZh, null);
});
