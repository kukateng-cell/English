import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeAdminDirectoryCursor,
  encodeAdminDirectoryCursor,
  parseAdminDirectoryQuery,
  readAdminDirectoryQuery,
} from "@/lib/admin-user-directory";

test("admin directory parser normalizes search and preserves the selected year filters", () => {
  const query = parseAdminDirectoryQuery({
    role: "STUDENT",
    academicYearId: "year-2026",
    grade: "JUNIOR_2",
    classCode: "H",
    search: "  學生　 001  ",
    limit: 50,
  });
  assert.deepEqual(query, {
    role: "STUDENT",
    status: undefined,
    academicYearId: "year-2026",
    grade: "JUNIOR_2",
    classCode: "H",
    search: "學生 001",
    sort: "STUDENT_NUMBER_ASC",
    cursor: undefined,
    limit: 50,
  });
});

test("admin directory parser rejects role-incompatible filters and unsafe bounds", () => {
  assert.throws(() => parseAdminDirectoryQuery({ role: "TEACHER", grade: "JUNIOR_1" }), /QUERY_INVALID/);
  assert.throws(() => parseAdminDirectoryQuery({ search: "x".repeat(81) }), /QUERY_INVALID/);
  assert.throws(() => parseAdminDirectoryQuery({ limit: 0 }), /QUERY_INVALID/);
  assert.throws(() => parseAdminDirectoryQuery({ limit: 101 }), /QUERY_INVALID/);
  assert.throws(() => parseAdminDirectoryQuery({ limit: "50" }), /QUERY_INVALID/);
  assert.throws(() => parseAdminDirectoryQuery({ limit: true }), /QUERY_INVALID/);
  assert.throws(() => parseAdminDirectoryQuery({ limit: null }), /QUERY_INVALID/);
  assert.throws(() => parseAdminDirectoryQuery({ classCode: "Z" }), /QUERY_INVALID/);
  assert.throws(() => parseAdminDirectoryQuery({ cursor: "x".repeat(2049) }), /QUERY_INVALID/);
  assert.throws(() => parseAdminDirectoryQuery({ role: "STUDENT", junk: true }), /QUERY_INVALID/);
  assert.throws(() => parseAdminDirectoryQuery([]), /QUERY_INVALID/);
  assert.throws(() => parseAdminDirectoryQuery(null), /QUERY_INVALID/);
  assert.throws(() => parseAdminDirectoryQuery({ search: null }), /QUERY_INVALID/);
  assert.throws(() => parseAdminDirectoryQuery({ grade: null }), /QUERY_INVALID/);
  assert.throws(() => parseAdminDirectoryQuery({ classCode: null }), /QUERY_INVALID/);
});

test("admin directory query enforces the request body cap", async () => {
  const request = new Request("http://localhost/api/admin/users/query", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(16 * 1024 + 1) },
    body: JSON.stringify({}),
  });
  await assert.rejects(() => readAdminDirectoryQuery(request), /PAYLOAD_TOO_LARGE/);
});

test("admin directory cursor is signed and tamper resistant", () => {
  const cursor = encodeAdminDirectoryCursor({ accountName: "student-001", studentNumber: 1, sort: "STUDENT_NUMBER_ASC", id: "user-001", fingerprint: "fingerprint", rosterRevision: 7 });
  assert.deepEqual(decodeAdminDirectoryCursor(cursor), {
    v: 2,
    accountName: "student-001",
    studentNumber: 1,
    sort: "STUDENT_NUMBER_ASC",
    id: "user-001",
    fingerprint: "fingerprint",
    rosterRevision: 7,
  });
  const [body, signature] = cursor.split(".");
  const tamperedSignature = `${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`;
  assert.equal(decodeAdminDirectoryCursor(`${body}.${tamperedSignature}`), null);
  assert.equal(decodeAdminDirectoryCursor(`${cursor}.extra`), null);
});
