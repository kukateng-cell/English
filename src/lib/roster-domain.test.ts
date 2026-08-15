import test from "node:test";
import assert from "node:assert/strict";
import {
  assertRosterSelectionCap,
  assertYearActivationSelectionCap,
  CLASS_CODES,
  deriveRolloverDisposition,
  MAX_ROSTER_SELECTION,
  MAX_YEAR_ACTIVATION_SELECTION,
  nextGrade,
  parseClassCode,
  parseClassReference,
  parseStudentGrade,
} from "./roster-domain";

test("six grades accept canonical and Chinese labels", () => {
  assert.equal(parseStudentGrade("初一"), "JUNIOR_1");
  assert.equal(parseStudentGrade("高三"), "SENIOR_3");
  assert.equal(parseStudentGrade("s2"), "SENIOR_2");
  assert.equal(parseStudentGrade("大学"), null);
});

test("class codes are bounded to 甲至辛", () => {
  assert.equal(CLASS_CODES.length, 8);
  assert.equal(parseClassCode("甲"), "A");
  assert.equal(parseClassCode("辛"), "H");
  assert.equal(parseClassCode("I"), null);
  assert.deepEqual(parseClassReference("初二乙"), {
    grade: "JUNIOR_2",
    classCode: "B",
  });
});

test("promotion crosses junior to senior and stops after senior three", () => {
  assert.equal(nextGrade("JUNIOR_1"), "JUNIOR_2");
  assert.equal(nextGrade("JUNIOR_3"), "SENIOR_1");
  assert.equal(nextGrade("SENIOR_3"), null);
});

test("rollover dispositions are mutually exclusive for assigned and unassigned targets", () => {
  assert.equal(deriveRolloverDisposition("JUNIOR_1", "JUNIOR_2", null), "PROMOTE");
  assert.equal(deriveRolloverDisposition("JUNIOR_1", "JUNIOR_1", "class-a"), "REPEAT");
  assert.equal(deriveRolloverDisposition("JUNIOR_1", "JUNIOR_1", null), "HOLD_UNASSIGNED");
  assert.equal(deriveRolloverDisposition("JUNIOR_1", "JUNIOR_3", null), null);
});

test("bulk and promotion selection cap is exactly 500", () => {
  assert.equal(MAX_ROSTER_SELECTION, 500);
  assert.doesNotThrow(() => assertRosterSelectionCap(500));
  assert.throws(() => assertRosterSelectionCap(501), /SELECTION_CAP/u);
  assert.throws(() => assertRosterSelectionCap(0), /SELECTION_CAP/u);
});

test("academic-year activation cap is exactly 5,000 and remains all-or-nothing", () => {
  assert.equal(MAX_YEAR_ACTIVATION_SELECTION, 5_000);
  assert.doesNotThrow(() => assertYearActivationSelectionCap(5_000));
  assert.throws(() => assertYearActivationSelectionCap(5_001), /ACTIVATION_SELECTION_CAP/u);
  assert.throws(() => assertYearActivationSelectionCap(0), /ACTIVATION_SELECTION_CAP/u);
});
