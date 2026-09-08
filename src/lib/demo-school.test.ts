import test from "node:test";
import assert from "node:assert/strict";
import { schoolRoster, activitySlots, simulateStudent } from "./demo-school";
import { CATALOG_CATEGORIES } from "./catalog/taxonomy";

const words = Array.from({ length: 30 }, (_, i) => ({ id: `w${String(i).padStart(2,"0")}`, level: "A1", category: CATALOG_CATEGORIES[0] }));
test("school has natural unique names, stable identities and realistic class sizes", () => {
  const roster = schoolRoster("sample");
  assert.deepEqual(roster, schoolRoster("sample"));
  assert.notDeepEqual(roster, schoolRoster("other"));
  assert.equal(new Set(roster.map(s => s.name)).size, roster.length);
  for (let c = 0; c < 18; c++) {
    const members = roster.filter(s => s.classIndex === c);
    assert.ok(members.length >= 28 && members.length <= 36);
    assert.deepEqual(members.map(s => s.number), members.map((_, i) => i+1));
    assert.ok(members.every(s => !/測試|學生|\d/.test(s.name)));
  }
});
test("daily replay is a stable prefix, no future action, real due dates and bounded evidence", () => {
  const student = { ...schoolRoster("sample")[0], participation: 0.95, minutes: 30, joinDelay: 0 };
  const end = new Date("2026-09-08T12:00:00+08:00");
  const all = simulateStudent("sample", student, words, "2026-09-01", end);
  assert.ok(all.actions.length > 50);
  assert.ok(all.actions.some(a => a.kind === "OBJECTIVE_PROBE"));
  for (let day = 1; day <= 8; day++) {
    const cut = new Date(`2026-09-${String(day).padStart(2,"0")}T12:00:00+08:00`);
    const partial = simulateStudent("sample", student, words, "2026-09-01", cut);
    assert.deepEqual(partial.actions, all.actions.filter(a => a.end <= cut.getTime()));
  }
  for (const a of all.actions) {
    assert.ok(a.end <= end.getTime());
    assert.ok(a.start < a.reveal && a.reveal < a.answer && a.answer < a.end);
    if (a.purpose === "DUE_REVIEW") { assert.ok(a.before); assert.ok(a.before.nextReviewDate.getTime() <= a.start); }
    if (a.purpose === "EVIDENCE_OBLIGATION") { const w = all.work.find(w => w.id === a.workId)!; assert.ok(w); assert.ok(w.eligibleAt <= a.start && w.expiresAt > a.start); }
    if (a.kind === "LEARNING_CARD") assert.equal(a.after, undefined);
    const active = all.work.filter(w => w.admittedAt <= a.start && w.expiresAt > a.start && (!w.answeredAt || w.answeredAt > a.start));
    assert.ok(active.length <= 5);
  }
  assert.equal(new Set(all.actions.map(a => a.id)).size, all.actions.length);
});
test("joining and inactive students do not generate premature activity", () => {
  const student = schoolRoster("sample")[0];
  assert.deepEqual(activitySlots("sample", { ...student, joinDelay: 5 }, "2026-09-02", "2026-09-01"), []);
  assert.deepEqual(simulateStudent("sample", { ...student, participation: 0 }, words, "2026-09-01", new Date("2026-09-08T00:00:00Z")).actions, []);
});

test("late evening sessions never overlap or reorder the student's actions", () => {
  const student = { ...schoolRoster("sample")[0], hour: 21, minutes: 28, participation: 0.96, joinDelay: 0 };
  for (let i = 0; i < 1000; i++) {
    const slots = activitySlots(`evening-${i}`, student, "2026-09-08", "2026-09-01");
    for (let j = 1; j < slots.length; j++) assert.ok(slots[j].start > slots[j-1].end);
  }
});
