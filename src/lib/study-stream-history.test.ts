import assert from "node:assert/strict";
import test from "node:test";
import { selectNextItem } from "@/lib/learning-policy/scheduler";
import {
  compareNewWordCandidates,
  newWordSelectionReason,
  recentStreamShape,
} from "@/lib/study-stream/server";

const acknowledgedProbe = { itemKind: "OBJECTIVE_PROBE", usedAt: new Date(), feedbackAcknowledgedAt: new Date() };
const acknowledgedCard = { itemKind: "LEARNING_CARD", usedAt: new Date(), feedbackAcknowledgedAt: new Date() };
const pendingProbe = { itemKind: "OBJECTIVE_PROBE", usedAt: new Date(), feedbackAcknowledgedAt: null };

test("recent stream shape counts the full acknowledged probe run", () => {
  assert.deepEqual(recentStreamShape([]), { consecutiveProbes: 0, acknowledgedItemsSinceProbe: 0, hasPreviousProbe: false });
  assert.deepEqual(recentStreamShape([acknowledgedProbe]), { consecutiveProbes: 1, acknowledgedItemsSinceProbe: 0, hasPreviousProbe: true });
  assert.deepEqual(recentStreamShape([acknowledgedProbe, acknowledgedProbe, acknowledgedProbe]), { consecutiveProbes: 3, acknowledgedItemsSinceProbe: 0, hasPreviousProbe: true });
  assert.deepEqual(recentStreamShape([acknowledgedProbe, acknowledgedCard]), { consecutiveProbes: 1, acknowledgedItemsSinceProbe: 0, hasPreviousProbe: true });
  assert.deepEqual(recentStreamShape([acknowledgedCard, acknowledgedProbe]), { consecutiveProbes: 0, acknowledgedItemsSinceProbe: 1, hasPreviousProbe: true });
});

test("unconfirmed feedback does not count as an acknowledged probe", () => {
  assert.deepEqual(recentStreamShape([pendingProbe, acknowledgedProbe, acknowledgedProbe]), { consecutiveProbes: 2, acknowledgedItemsSinceProbe: 0, hasPreviousProbe: true });
});

test("a real card-then-probe history keeps the two-item gap closed", () => {
  const shape = recentStreamShape([acknowledgedCard, acknowledgedProbe]);
  const decision = selectNextItem({
    mode: "global",
    now: Date.now(),
    consecutiveProbes: shape.consecutiveProbes,
    acknowledgedItemsSinceProbe: shape.acknowledgedItemsSinceProbe,
    hasPreviousProbe: shape.hasPreviousProbe,
    activeWork: [],
    candidates: [
      { id: "probe", wordId: "probe-word", kind: "OBJECTIVE_PROBE", purpose: "DUE_REVIEW", selectionReason: "due-review" },
      { id: "card", wordId: "card-word", kind: "LEARNING_CARD", selectionReason: "new-word" },
    ],
  });
  assert.equal(decision.candidate?.id, "card");
});

test("a closed probe gap returns a safe rest when no non-probe item exists", () => {
  const shape = recentStreamShape([acknowledgedCard, acknowledgedProbe]);
  const decision = selectNextItem({
    mode: "global",
    now: Date.now(),
    consecutiveProbes: shape.consecutiveProbes,
    acknowledgedItemsSinceProbe: shape.acknowledgedItemsSinceProbe,
    hasPreviousProbe: shape.hasPreviousProbe,
    activeWork: [],
    candidates: [
      { id: "probe-only", wordId: "probe-word", kind: "OBJECTIVE_PROBE", purpose: "DUE_REVIEW", selectionReason: "due-review" },
    ],
  });
  assert.equal(decision.candidate, null);
  assert.equal(decision.reason, "probe-gap-closed");
  assert.equal(decision.overrideReason, "min-intervening-items");
});

test("due review cards can fill a closed probe gap before another probe", () => {
  const shape = recentStreamShape([acknowledgedCard, acknowledgedProbe]);
  const decision = selectNextItem({
    mode: "unit",
    now: Date.now(),
    consecutiveProbes: shape.consecutiveProbes,
    acknowledgedItemsSinceProbe: shape.acknowledgedItemsSinceProbe,
    hasPreviousProbe: shape.hasPreviousProbe,
    activeWork: [],
    candidates: [
      { id: "due-probe", wordId: "due-word", kind: "OBJECTIVE_PROBE", purpose: "DUE_REVIEW", selectionReason: "due-review" },
      { id: "due-card", wordId: "due-word", kind: "LEARNING_CARD", selectionReason: "due-review-gap-filler" },
    ],
  });
  assert.equal(decision.candidate?.id, "due-card");
  assert.equal(decision.candidate?.kind, "LEARNING_CARD");
});

test("evidence obligations use an independent non-scoring gap filler", () => {
  const shape = recentStreamShape([acknowledgedCard, acknowledgedProbe]);
  const decision = selectNextItem({
    mode: "unit",
    now: Date.now(),
    consecutiveProbes: shape.consecutiveProbes,
    acknowledgedItemsSinceProbe: shape.acknowledgedItemsSinceProbe,
    hasPreviousProbe: shape.hasPreviousProbe,
    activeWork: [{
      id: "obligation-1",
      learnerId: "learner-1",
      wordId: "evidence-word",
      kind: "EVIDENCE_OBLIGATION",
      status: "PENDING",
      admittedAt: Date.now() - 1_000,
      eligibleAt: Date.now() - 1_000,
      expiresAt: Date.now() + 60_000,
    }],
    candidates: [
      {
        id: "work:obligation-1",
        wordId: "evidence-word",
        kind: "OBJECTIVE_PROBE",
        purpose: "EVIDENCE_OBLIGATION",
        workId: "obligation-1",
        selectionReason: "evidence-obligation",
      },
      {
        id: "work-card:obligation-1",
        wordId: "evidence-word",
        kind: "LEARNING_CARD",
        selectionReason: "evidence-obligation-gap-filler",
      },
    ],
  });
  assert.equal(decision.candidate?.id, "work-card:obligation-1");
  assert.equal(decision.candidate?.workId, undefined);
  assert.equal(decision.candidate?.selectionReason, "evidence-obligation-gap-filler");
});

test("contacted words stay out of the new-word partition beyond the history window", () => {
  const contactedWordIds = new Set(
    Array.from({ length: 641 }, (_, index) => `contacted-${index}`),
  );
  // The bounded history query only has timestamps for the first 640 rows;
  // the latest contacted word is intentionally outside that map.
  const contactTimes = new Map(
    Array.from({ length: 640 }, (_, index) => [`contacted-${index}`, index] as const),
  );
  const latestContact = { id: "contacted-640", term: "aardvark" };
  const olderContact = { id: "contacted-0", term: "zebra" };
  const untouched = { id: "untouched-1", term: "middle" };

  assert.equal(newWordSelectionReason(latestContact.id, contactedWordIds), "unverified-contact");
  assert.deepEqual(
    [latestContact, olderContact, untouched].sort((left, right) =>
      compareNewWordCandidates(left, right, contactedWordIds, contactTimes),
    ).map((word) => word.id),
    ["untouched-1", "contacted-0", "contacted-640"],
  );
});
