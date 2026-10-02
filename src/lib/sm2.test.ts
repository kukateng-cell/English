import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, updateSM2, updateSM2At } from "@/lib/sm2";

test("time-aware SM-2 uses event time and preserves production default behaviour", () => {
  const eventTime = new Date("2026-01-10T12:00:00.000Z");
  const state = createInitialState();
  const historical = updateSM2At(state, 4, eventTime);
  assert.equal(historical.lastReviewedAt?.toISOString(), eventTime.toISOString());
  assert.equal(historical.nextReviewDate.toISOString(), "2026-01-11T12:00:00.000Z");

  const before = Date.now();
  const production = updateSM2(state, 4);
  assert.ok(production.lastReviewedAt instanceof Date);
  assert.ok(production.lastReviewedAt.getTime() >= before);
  assert.equal(production.interval, historical.interval);
  assert.equal(production.repetitions, historical.repetitions);
  assert.equal(production.easeFactor, historical.easeFactor);
});
