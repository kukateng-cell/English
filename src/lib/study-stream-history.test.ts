import assert from "node:assert/strict";
import test from "node:test";
import { recentStreamShape } from "@/lib/study-stream/server";

const acknowledgedProbe = { itemKind: "OBJECTIVE_PROBE", usedAt: new Date(), feedbackAcknowledgedAt: new Date() };
const acknowledgedCard = { itemKind: "LEARNING_CARD", usedAt: new Date(), feedbackAcknowledgedAt: new Date() };
const pendingProbe = { itemKind: "OBJECTIVE_PROBE", usedAt: new Date(), feedbackAcknowledgedAt: null };

test("recent stream shape counts the full acknowledged probe run", () => {
  assert.deepEqual(recentStreamShape([]), { consecutiveProbes: 0, acknowledgedItemsSinceProbe: 0 });
  assert.deepEqual(recentStreamShape([acknowledgedProbe]), { consecutiveProbes: 1, acknowledgedItemsSinceProbe: 0 });
  assert.deepEqual(recentStreamShape([acknowledgedProbe, acknowledgedProbe, acknowledgedProbe]), { consecutiveProbes: 3, acknowledgedItemsSinceProbe: 0 });
  assert.deepEqual(recentStreamShape([acknowledgedProbe, acknowledgedCard]), { consecutiveProbes: 1, acknowledgedItemsSinceProbe: 0 });
  assert.deepEqual(recentStreamShape([acknowledgedCard, acknowledgedProbe]), { consecutiveProbes: 0, acknowledgedItemsSinceProbe: 1 });
});

test("unconfirmed feedback does not count as an acknowledged probe", () => {
  assert.deepEqual(recentStreamShape([pendingProbe, acknowledgedProbe, acknowledgedProbe]), { consecutiveProbes: 2, acknowledgedItemsSinceProbe: 0 });
});
