import test from "node:test";
import assert from "node:assert/strict";
import {
  admitWork,
  requiresEvidenceObligation,
  verificationTimes,
} from "./learning-policy/admission";
import {
  OBJECTIVE_QUALITY_POLICY_VERSION,
  RETRIEVAL_V1_POLICY,
  type CandidateRecord,
  type WorkRecord,
} from "./learning-policy/types";
import { mapObjectiveFirstResponse } from "./learning-policy/quality";
import { selectNextItem } from "./learning-policy/scheduler";
import {
  transitionLearningCard,
  transitionObjectiveProbe,
} from "./learning-policy/state-machine";

const now = Date.parse("2026-08-12T00:00:00.000Z");

function work(id: string, wordId: string, overrides: Partial<WorkRecord> = {}): WorkRecord {
  return {
    id,
    learnerId: "learner-1",
    wordId,
    kind: "EVIDENCE_OBLIGATION",
    status: "PENDING",
    admittedAt: now - 20 * 60_000,
    eligibleAt: now - 10 * 60_000,
    expiresAt: now + 60 * 60_000,
    ...overrides,
  };
}

test("retrieval-v1 maps only operational probe first response to quality 4/2", () => {
  assert.deepEqual(mapObjectiveFirstResponse("correct", "DUE_REVIEW"), {
    quality: 4,
    qualityPolicyVersion: OBJECTIVE_QUALITY_POLICY_VERSION,
  });
  assert.deepEqual(mapObjectiveFirstResponse("wrong", "EVIDENCE_OBLIGATION"), {
    quality: 2,
    qualityPolicyVersion: OBJECTIVE_QUALITY_POLICY_VERSION,
  });
  assert.equal(mapObjectiveFirstResponse(null, "DUE_REVIEW"), null);
  assert.equal(mapObjectiveFirstResponse("correct", "RESEARCH_DIAGNOSTIC"), null);
});

test("evidence admission is policy-controlled, delayed, deduplicated and capped", () => {
  assert.equal(
    requiresEvidenceObligation({
      learnerId: "learner-1",
      wordId: "word-1",
      selfRating: "selfForgot",
      repetitions: 0,
      hadObjectiveEvidence: false,
      activeWork: [],
      now,
      sourceOperationId: "op-1",
    }),
    false,
  );
  assert.equal(
    requiresEvidenceObligation({
      learnerId: "learner-1",
      wordId: "word-1",
      selfRating: "selfRecalled",
      repetitions: 0,
      hadObjectiveEvidence: false,
      activeWork: [],
      now,
      sourceOperationId: "op-1",
    }),
    true,
  );
  const times = verificationTimes(now);
  const accepted = admitWork({
    learnerId: "learner-1",
    wordId: "word-1",
    kind: "EVIDENCE_OBLIGATION",
    now,
    eligibleAt: times.eligibleAt,
    sourceOperationId: "op-1",
    activeWork: [],
  });
  assert.equal(accepted.reason, "accepted");
  assert.equal(accepted.record?.eligibleAt, now + 10 * 60_000);
  assert.equal(accepted.record?.expiresAt, now + 24 * 60 * 60_000);
  const duplicate = admitWork({
    learnerId: "learner-1",
    wordId: "word-1",
    kind: "EVIDENCE_OBLIGATION",
    now,
    activeWork: [accepted.record!],
  });
  assert.equal(duplicate.reason, "already-active");
  const capped = admitWork({
    learnerId: "learner-1",
    wordId: "word-6",
    kind: "REMEDIATION",
    now,
    activeWork: Array.from({ length: RETRIEVAL_V1_POLICY.maxCombinedWorkDebt }, (_, index) =>
      work(`work-${index}`, `word-${index}`),
    ),
  });
  assert.equal(capped.reason, "debt-cap");
});

test("learning card state machine requires reveal and server acknowledgement", () => {
  assert.equal(transitionLearningCard("PROMPT", { type: "SELF_RATING", rating: "selfForgot" }).ok, false);
  assert.deepEqual(transitionLearningCard("PROMPT", { type: "REVEAL" }), {
    ok: true,
    state: "REVEALED",
  });
  assert.deepEqual(transitionLearningCard("REVEALED", { type: "SELF_RATING", rating: "selfRecalled" }), {
    ok: true,
    state: "SUBMITTING",
    rating: "selfRecalled",
  });
  assert.deepEqual(transitionLearningCard("SUBMITTING", { type: "SYNC_FAILED" }), {
    ok: true,
    state: "SYNC_BLOCKED",
  });
  assert.equal(transitionLearningCard("SYNC_BLOCKED", { type: "NEXT" }).ok, false);
  assert.deepEqual(transitionLearningCard("SYNC_BLOCKED", { type: "RETRY" }), {
    ok: true,
    state: "SUBMITTING",
  });
});

test("objective probe has one selection, read-only feedback and no swipe transition", () => {
  assert.equal(transitionObjectiveProbe("PROMPT", { type: "SELECT_OPTION", optionId: "" }).ok, false);
  assert.deepEqual(transitionObjectiveProbe("PROMPT", { type: "SELECT_OPTION", optionId: "opaque-a" }), {
    ok: true,
    state: "SUBMITTING",
    optionId: "opaque-a",
  });
  assert.deepEqual(
    transitionObjectiveProbe("SUBMITTING", {
      type: "ACKNOWLEDGED",
      correct: false,
      feedback: "先看懂正確意思。",
    }),
    { ok: true, state: "FEEDBACK", correct: false, feedback: "先看懂正確意思。" },
  );
  assert.equal(transitionObjectiveProbe("FEEDBACK", { type: "SELECT_OPTION", optionId: "opaque-b" }).ok, false);
  assert.deepEqual(transitionObjectiveProbe("FEEDBACK", { type: "ACK_FEEDBACK" }), {
    ok: true,
    state: "NEXT",
  });
});

test("scheduler keeps active work bounded, respects delay and gives a rest after two probes", () => {
  const delayed = work("obligation-delayed", "word-delayed", {
    eligibleAt: now + 1,
  });
  const learning: CandidateRecord = {
    id: "learning-1",
    wordId: "word-learning",
    kind: "LEARNING_CARD",
    selectionReason: "new-word",
  };
  const result = selectNextItem({
    mode: "global",
    now,
    consecutiveProbes: 0,
    acknowledgedItemsSinceProbe: 0,
    hasPreviousProbe: false,
    activeWork: [delayed],
    candidates: [
      { id: "probe-delayed", wordId: delayed.wordId, kind: "OBJECTIVE_PROBE", workId: delayed.id, purpose: "EVIDENCE_OBLIGATION", eligibleAt: delayed.eligibleAt, expiresAt: delayed.expiresAt, selectionReason: "obligation" },
      learning,
    ],
  });
  assert.equal(result.candidate?.id, "learning-1");
  assert.equal(result.reason, "probe-soft-cap-rest");

  const eligible = selectNextItem({
    mode: "global",
    now,
    consecutiveProbes: 0,
    acknowledgedItemsSinceProbe: 0,
    hasPreviousProbe: false,
    activeWork: [work("obligation-1", "word-1")],
    candidates: [
      { id: "probe-1", wordId: "word-1", kind: "OBJECTIVE_PROBE", workId: "obligation-1", purpose: "EVIDENCE_OBLIGATION", selectionReason: "obligation", eligibleAt: now - 1, expiresAt: now + 1_000 },
      learning,
    ],
  });
  assert.equal(eligible.candidate?.id, "probe-1");
  assert.equal(eligible.versionBundle.policyVersion, "retrieval-v1");
});

test("oldest eligible work is served by the simulation-backed six-item gap", () => {
  const candidate = {
    id: "probe-oldest",
    wordId: "word-oldest",
    kind: "OBJECTIVE_PROBE" as const,
    workId: "obligation-oldest",
    purpose: "EVIDENCE_OBLIGATION" as const,
    selectionReason: "obligation",
  };
  const result = selectNextItem({
    mode: "global",
    now,
    consecutiveProbes: RETRIEVAL_V1_POLICY.maxConsecutiveProbes,
    acknowledgedItemsSinceProbe: RETRIEVAL_V1_POLICY.maxEligibleServiceGap,
    hasPreviousProbe: true,
    activeWork: [work("obligation-oldest", "word-oldest")],
    candidates: [
      candidate,
      { id: "learning-rest", wordId: "word-rest", kind: "LEARNING_CARD", selectionReason: "new-word" },
    ],
  });
  assert.equal(result.candidate?.id, "probe-oldest");
  assert.equal(result.overrideReason, "max-eligible-service-gap");
});

test("scheduler inserts the full two-item probe gap before another probe", () => {
  const probe: CandidateRecord = {
    id: "probe-gap",
    wordId: "word-gap",
    kind: "OBJECTIVE_PROBE",
    purpose: "DUE_REVIEW",
    selectionReason: "due-review",
  };
  const learningOne: CandidateRecord = {
    id: "learning-gap-1",
    wordId: "word-gap-1",
    kind: "LEARNING_CARD",
    selectionReason: "new-word",
  };
  const learningTwo: CandidateRecord = {
    id: "learning-gap-2",
    wordId: "word-gap-2",
    kind: "LEARNING_CARD",
    selectionReason: "new-word",
  };
  const oneItemGap = selectNextItem({
    mode: "global",
    now,
    consecutiveProbes: 1,
    acknowledgedItemsSinceProbe: 1,
    hasPreviousProbe: true,
    activeWork: [],
    candidates: [probe, learningOne],
  });
  assert.equal(oneItemGap.candidate?.id, "learning-gap-1");

  const fullGap = selectNextItem({
    mode: "global",
    now,
    consecutiveProbes: 1,
    acknowledgedItemsSinceProbe: 2,
    hasPreviousProbe: true,
    activeWork: [],
    candidates: [probe, learningOne, learningTwo],
  });
  assert.equal(fullGap.candidate?.id, "probe-gap");
});

test("scheduler applies learner-scoped word spacing to every candidate source", () => {
  const result = selectNextItem({
    mode: "global",
    now,
    consecutiveProbes: 0,
    acknowledgedItemsSinceProbe: 0,
    hasPreviousProbe: false,
    lastWordId: "word-recent",
    recentWordIds: ["word-recent", "word-older"],
    activeWork: [],
    candidates: [
      { id: "due-recent", wordId: "word-recent", kind: "OBJECTIVE_PROBE", purpose: "DUE_REVIEW", selectionReason: "due-review" },
      { id: "new-other", wordId: "word-other", kind: "LEARNING_CARD", selectionReason: "new-word" },
    ],
  });
  assert.equal(result.candidate?.id, "new-other");

  const explicitFallback = selectNextItem({
    mode: "unit",
    now,
    consecutiveProbes: 0,
    acknowledgedItemsSinceProbe: 0,
    hasPreviousProbe: false,
    recentWordIds: ["word-only"],
    activeWork: [],
    candidates: [{ id: "only", wordId: "word-only", kind: "LEARNING_CARD", selectionReason: "new-word" }],
  });
  assert.equal(explicitFallback.candidate?.id, "only");
  assert.equal(explicitFallback.reason, "spacing-override");
  assert.equal(explicitFallback.overrideReason, "spacing-only-candidate");
});

test("scheduler preserves untouched-word priority within the same urgency tier", () => {
  const selected = selectNextItem({
    mode: "global",
    now,
    consecutiveProbes: 0,
    acknowledgedItemsSinceProbe: 0,
    hasPreviousProbe: false,
    activeWork: [],
    candidates: [
      { id: "contacted", wordId: "word-contacted", kind: "LEARNING_CARD", selectionPriority: 1_000_001, selectionReason: "unverified-contact" },
      { id: "untouched", wordId: "word-untouched", kind: "LEARNING_CARD", selectionPriority: 1, selectionReason: "new-word" },
    ],
  });
  assert.equal(selected.candidate?.id, "untouched");
});

test("scheduler preserves database order for due reviews within one urgency tier", () => {
  const selected = selectNextItem({
    mode: "global",
    now,
    consecutiveProbes: 0,
    acknowledgedItemsSinceProbe: 0,
    hasPreviousProbe: false,
    activeWork: [],
    candidates: [
      {
        id: "z-old",
        wordId: "word-old",
        kind: "OBJECTIVE_PROBE",
        purpose: "DUE_REVIEW",
        eligibleAt: now,
        expiresAt: now + 86_400_000,
        selectionPriority: 0,
        selectionReason: "due-review",
      },
      {
        id: "a-new",
        wordId: "word-new",
        kind: "OBJECTIVE_PROBE",
        purpose: "DUE_REVIEW",
        eligibleAt: now,
        expiresAt: now + 86_400_000,
        selectionPriority: 1,
        selectionReason: "due-review",
      },
    ],
  });
  assert.equal(selected.candidate?.id, "z-old");
});

test("scheduler fail-closes expired work, respects mode scope and has an explicit no-candidate result", () => {
  const expired = work("expired", "word-expired", {
    expiresAt: now - 1,
  });
  const unitOnly: CandidateRecord = {
    id: "unit-learning",
    wordId: "word-unit",
    kind: "LEARNING_CARD",
    mode: "unit",
    selectionReason: "unit-scope",
  };
  assert.equal(
    selectNextItem({
      mode: "global",
      now,
      consecutiveProbes: 0,
      acknowledgedItemsSinceProbe: 0,
      hasPreviousProbe: false,
      activeWork: [expired],
      candidates: [
        {
          id: "expired-probe",
          wordId: expired.wordId,
          kind: "OBJECTIVE_PROBE",
          workId: expired.id,
          purpose: "EVIDENCE_OBLIGATION",
          eligibleAt: expired.eligibleAt,
          expiresAt: expired.expiresAt,
          selectionReason: "expired",
        },
        unitOnly,
      ],
    }).candidate,
    null,
  );
  assert.equal(
    selectNextItem({
      mode: "unit",
      now,
      consecutiveProbes: 0,
      acknowledgedItemsSinceProbe: 0,
      hasPreviousProbe: false,
      activeWork: [],
      candidates: [unitOnly],
    }).candidate?.id,
    "unit-learning",
  );
});

test("remediation is per-word deduplicated but can reopen after a terminal result", () => {
  const first = admitWork({
    learnerId: "learner-1",
    wordId: "word-remediate",
    kind: "REMEDIATION",
    now,
    activeWork: [],
  });
  assert.equal(first.reason, "accepted");
  const duplicate = admitWork({
    learnerId: "learner-1",
    wordId: "word-remediate",
    kind: "REMEDIATION",
    now: now + 1,
    activeWork: [first.record!],
  });
  assert.equal(duplicate.reason, "already-active");
  const reopened = admitWork({
    learnerId: "learner-1",
    wordId: "word-remediate",
    kind: "REMEDIATION",
    now: now + 2,
    activeWork: [{ ...first.record!, status: "ANSWERED" }],
  });
  assert.equal(reopened.reason, "accepted");
});

test("long deterministic scheduler sequence never exceeds combined cap or duplicates active work", () => {
  let active: WorkRecord[] = [];
  let acknowledgedItemsSinceProbe = 0;
  for (let index = 0; index < 1_000; index += 1) {
    if (index % 3 === 0 && active.length < RETRIEVAL_V1_POLICY.maxCombinedWorkDebt) {
      const admitted = admitWork({
        learnerId: "learner-1",
        wordId: `word-${index % 17}`,
        kind: index % 2 === 0 ? "EVIDENCE_OBLIGATION" : "REMEDIATION",
        now: now + index,
        activeWork: active,
      });
      if (admitted.record) active = [...active, admitted.record];
    }
    const candidates: CandidateRecord[] = active
      .filter((record) => record.eligibleAt <= now + index)
      .map((record) => ({
        id: `probe:${record.id}`,
        wordId: record.wordId,
        kind: record.kind === "REMEDIATION" ? "LEARNING_CARD" : "OBJECTIVE_PROBE",
        ...(record.kind === "EVIDENCE_OBLIGATION"
          ? { workId: record.id, purpose: "EVIDENCE_OBLIGATION" as const }
          : { workId: record.id }),
        selectionReason: record.kind.toLowerCase(),
      }));
    candidates.push({
      id: `learning:${index}`,
      wordId: `ordinary-${index}`,
      kind: "LEARNING_CARD",
      selectionReason: "new-word",
    });
    const selected = selectNextItem({
      mode: "global",
      now: now + index,
      consecutiveProbes: index % 5,
      acknowledgedItemsSinceProbe,
      hasPreviousProbe: index % 5 > 0 || acknowledgedItemsSinceProbe > 0,
      activeWork: active,
      candidates,
    }).candidate;
    assert.ok(active.length <= RETRIEVAL_V1_POLICY.maxCombinedWorkDebt);
    if (selected?.workId) {
      const matching = active.filter((record) => record.id === selected.workId);
      assert.equal(matching.length, 1);
      active = active.map((record) =>
        record.id === selected.workId ? { ...record, status: "ANSWERED" } : record,
      );
      acknowledgedItemsSinceProbe = 0;
    } else {
      acknowledgedItemsSinceProbe += 1;
    }
    active = active.filter((record) => record.status !== "ANSWERED");
  }
});
