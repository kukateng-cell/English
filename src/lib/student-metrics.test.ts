import test from "node:test";
import assert from "node:assert/strict";
import { capNextSession, classifyStudentWord } from "./student-metrics";

const now = new Date("2026-08-11T04:00:00.000Z");

test("next-session caps preserve the dynamic aggregate contract", () => {
  assert.deepEqual(capNextSession(31, 12), { dueCount: 20, newCount: 5, total: 25 });
  assert.deepEqual(capNextSession(0, 3), { dueCount: 0, newCount: 3, total: 3 });
});

test("word status uses the shared learned/mastered/due precedence", () => {
  assert.deepEqual(classifyStudentWord(null, now), { learned: false, mastered: false, status: "unseen" });
  assert.deepEqual(classifyStudentWord({ repetitions: 1, interval: 2, nextReviewDate: new Date("2026-08-12T00:00:00.000Z"), lastReviewedAt: now }, now), { learned: true, mastered: false, status: "learning" });
  assert.deepEqual(classifyStudentWord({ repetitions: 0, interval: 0, nextReviewDate: new Date("2026-08-10T00:00:00.000Z"), lastReviewedAt: now }, now), { learned: false, mastered: false, status: "due" });
  assert.deepEqual(classifyStudentWord({ repetitions: 4, interval: 22, nextReviewDate: new Date("2026-08-10T00:00:00.000Z"), lastReviewedAt: now }, now), { learned: true, mastered: true, status: "mastered" });
});
