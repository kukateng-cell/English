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

test("reveal is a typed presentation action with no writable answer fields", () => {
  const action = validAction() as Record<string, unknown>;
  action.actionKind = "REVEAL";
  action.payload = {};
  assert.equal(parseStudyStreamAction(action).ok, true);
  action.payload = { definition: "client answer" };
  assert.equal(parseStudyStreamAction(action).ok, false);
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

test("local all-user assignment enables V2 without changing production defaults", () => {
  assert.deepEqual(resolveStudyFlowAssignment("student-a", undefined, "all", {
    NODE_ENV: "development",
  }), {
    flowVersion: "v2",
    reason: "local-all",
  });
  assert.deepEqual(resolveStudyFlowAssignment("student-a", undefined, "all", {
    NODE_ENV: "production",
  }), {
    flowVersion: "v1",
    reason: "legacy-default",
  });
  assert.deepEqual(resolveStudyFlowAssignment("student-a", undefined, "all", {
    NODE_ENV: "production",
    ENABLE_TEST_ROUTES: "1",
  }), {
    flowVersion: "v2",
    reason: "local-all",
  });
  assert.deepEqual(resolveStudyFlowAssignment("student-a", undefined, "all", {
    NODE_ENV: "production",
    ENABLE_TEST_ROUTES: "1",
    VERCEL_ENV: "preview",
  }), {
    flowVersion: "v1",
    reason: "legacy-default",
  });
  assert.deepEqual(resolveStudyFlowAssignment("student-a", "student-a", "off", {
    NODE_ENV: "development",
  }), {
    flowVersion: "v1",
    reason: "legacy-default",
  });
});
