import assert from "node:assert/strict";
import test from "node:test";
import {
  actionFingerprint,
  createStudyStreamCredential,
  digestStudyStreamCredential,
  parseStudyStreamAction,
} from "@/lib/study-stream/contracts";
import { resolveStudyFlowAssignment } from "@/lib/study-stream/assignment";

function validAction() {
  return {
    flowVersion: "v2",
    studySessionId: "session-123",
    streamItemId: "item-123",
    operationId: "operation-123",
    itemCredential: createStudyStreamCredential(),
    actionKind: "SELF_RATING",
    clientKnownRevision: 0,
    payload: { selfRating: "selfRecalled" },
  };
}

test("V2 parser accepts only the typed intent payload", () => {
  const parsed = parseStudyStreamAction(validAction());
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.value.payload, { selfRating: "selfRecalled" });
});

test("V2 parser rejects word, score and answer-key injection", () => {
  const action = validAction() as Record<string, unknown>;
  action.wordId = "word-should-not-be-submitted";
  assert.equal(parseStudyStreamAction(action).ok, false);

  const objective = validAction() as Record<string, unknown>;
  objective.actionKind = "OBJECTIVE_ANSWER";
  objective.payload = { selectedOptionId: "option-1", quality: 5 };
  assert.equal(parseStudyStreamAction(objective).ok, false);
});

test("credential digest is one-way and action fingerprints are stable", () => {
  const credential = createStudyStreamCredential();
  assert.equal(credential.length >= 32, true);
  assert.equal(digestStudyStreamCredential(credential), digestStudyStreamCredential(credential));
  const action = validAction();
  const parsed = parseStudyStreamAction(action);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(actionFingerprint(parsed.value), actionFingerprint(parsed.value));
});

test("V2 assignment is deny-by-default and internal-user scoped", () => {
  assert.deepEqual(resolveStudyFlowAssignment("student-a", undefined), {
    flowVersion: "v1",
    reason: "legacy-default",
  });
  assert.deepEqual(resolveStudyFlowAssignment("student-a", "student-b,student-a"), {
    flowVersion: "v2",
    reason: "internal-allowlist",
  });
});
