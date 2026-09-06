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
