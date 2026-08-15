import test from "node:test";
import assert from "node:assert/strict";
import { resolveExportRows, validateExportRequest, selectedEnrollmentStatus, STUDENT_EXPORT_FIELDS } from "./roster-export";

test("export contract requires selected academic year and allowlisted ordered fields", () => {
  assert.equal(validateExportRequest({ entityType: "STUDENT", fields: ["accountName"] }).ok, false);
  const result = validateExportRequest({ entityType: "STUDENT", academicYearId: "year-1", fields: ["legalName", "accountName"] });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.request.fields, ["legalName", "accountName"]);
  assert.equal(validateExportRequest({ entityType: "STUDENT", academicYearId: "year-1", fields: ["passwordHash"] }).ok, false);
  assert.equal(STUDENT_EXPORT_FIELDS.includes("mustChangePassword"), true);
});

test("selected academic year maps to exact enrollment status", () => {
  assert.equal(selectedEnrollmentStatus("CURRENT"), "ACTIVE");
  assert.equal(selectedEnrollmentStatus("PLANNED"), "PLANNED");
  assert.equal(selectedEnrollmentStatus("CLOSED"), "ENDED");
});

test("export filters fail closed instead of silently broadening the result", () => {
  assert.deepEqual(
    validateExportRequest({ entityType: "STUDENT", academicYearId: "year-1", fields: ["accountName"], filters: { status: "UNKNOWN" } }),
    { ok: false, code: "EXPORT_FILTER_INVALID" },
  );
  assert.deepEqual(
    validateExportRequest({ entityType: "STUDENT", academicYearId: "year-1", fields: ["accountName"], filters: { grade: "not-a-grade" } }),
    { ok: false, code: "EXPORT_FILTER_INVALID" },
  );
});

test("export fails closed at 5,001 rows instead of truncating", async () => {
  const tx = {
    academicYear: { findUnique: async () => ({ id: "year-1", status: "CURRENT" }) },
    user: { findMany: async () => Array.from({ length: 5_001 }, () => ({})) },
  } as never;
  await assert.rejects(resolveExportRows(tx, { entityType: "STUDENT", academicYearId: "year-1", fields: ["accountName"] }), /EXPORT_TOO_LARGE/u);
});
