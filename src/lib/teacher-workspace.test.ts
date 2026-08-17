import assert from "node:assert/strict";
import test from "node:test";
import { decodeTeacherCursor, encodeTeacherCursor, normalizeTeacherWorkspaceQuery } from "@/lib/teacher-workspace";

test("teacher workspace query normalizes search without changing filter meaning", () => {
  assert.deepEqual(normalizeTeacherWorkspaceQuery({ search: "  ＡＢＣ　學生  ", limit: 20 }), {
    search: "ABC 學生",
    limit: 20,
    grade: undefined,
    classId: undefined,
    sort: "STUDENT_NUMBER_ASC",
    cursor: undefined,
  });
  assert.equal(normalizeTeacherWorkspaceQuery({}).limit, 50);
});

test("teacher workspace query rejects oversized or invalid filters", () => {
  assert.throws(() => normalizeTeacherWorkspaceQuery(null), /QUERY_INVALID/u);
  assert.throws(() => normalizeTeacherWorkspaceQuery([]), /QUERY_INVALID/u);
  assert.throws(() => normalizeTeacherWorkspaceQuery({ unexpected: true }), /QUERY_INVALID/u);
  assert.throws(() => normalizeTeacherWorkspaceQuery({ limit: 0 }), /QUERY_INVALID/u);
  assert.throws(() => normalizeTeacherWorkspaceQuery({ limit: "50" }), /QUERY_INVALID/u);
  assert.throws(() => normalizeTeacherWorkspaceQuery({ limit: true }), /QUERY_INVALID/u);
  assert.throws(() => normalizeTeacherWorkspaceQuery({ limit: null }), /QUERY_INVALID/u);
  assert.throws(() => normalizeTeacherWorkspaceQuery({ search: "x".repeat(81) }), /QUERY_INVALID/u);
  assert.throws(() => normalizeTeacherWorkspaceQuery({ grade: "NOT_A_GRADE" }), /QUERY_INVALID/u);
  assert.throws(() => normalizeTeacherWorkspaceQuery({ search: null }), /QUERY_INVALID/u);
  assert.throws(() => normalizeTeacherWorkspaceQuery({ search: 123 }), /QUERY_INVALID/u);
  assert.throws(() => normalizeTeacherWorkspaceQuery({ grade: null }), /QUERY_INVALID/u);
  assert.throws(() => normalizeTeacherWorkspaceQuery({ classId: null }), /QUERY_INVALID/u);
  assert.throws(() => normalizeTeacherWorkspaceQuery({ cursor: null }), /QUERY_INVALID/u);
  assert.throws(() => normalizeTeacherWorkspaceQuery({ cursor: 123 }), /QUERY_INVALID/u);
});

test("teacher cursor is opaque, signed and rejects tampering", () => {
  const cursor = encodeTeacherCursor({ v: 2, accountName: "student-001", studentNumber: 1, sort: "STUDENT_NUMBER_ASC", id: "user-1", fingerprint: "fp", accessRevision: 3, rosterRevision: 8, yearRevision: 2 });
  assert.deepEqual(decodeTeacherCursor(cursor), { v: 2, accountName: "student-001", studentNumber: 1, sort: "STUDENT_NUMBER_ASC", id: "user-1", fingerprint: "fp", accessRevision: 3, rosterRevision: 8, yearRevision: 2 });
  const [body, signature] = cursor.split(".");
  assert.equal(decodeTeacherCursor(`${body.slice(0, -1)}${body.endsWith("A") ? "B" : "A"}.${signature}`), null);
  assert.equal(decodeTeacherCursor(`${body}.${signature.slice(0, -1)}x`), null);
});
