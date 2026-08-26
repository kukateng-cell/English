import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogSenseHistoryScope,
  decodeCatalogSenseHistoryCursor,
  encodeCatalogSenseHistoryCursor,
} from "./history-query";

test("sense history visibility scope is opaque and actor/workspace bound", () => {
  const teacherA = catalogSenseHistoryScope(false, "user-1", "workspace-a");
  const teacherB = catalogSenseHistoryScope(false, "user-2", "workspace-a");
  const changedWorkspace = catalogSenseHistoryScope(
    false,
    "user-1",
    "workspace-b",
  );
  assert.match(teacherA, /^[a-f0-9]{64}$/u);
  assert.notEqual(teacherA, teacherB);
  assert.notEqual(teacherA, changedWorkspace);
  assert.equal(teacherA.includes("user-1"), false);
});

test("sense history cursor is signed and bound to sense, scope and cutoff", () => {
  const encoded = encodeCatalogSenseHistoryCursor({
    senseKey: "sense-run-verb",
    createdAt: "2026-08-26T08:00:00.000Z",
    id: "request-10",
    cutoff: "2026-08-26T09:00:00.000Z",
    scope: "TEACHER:user-1",
  });
  assert.deepEqual(decodeCatalogSenseHistoryCursor(encoded), {
    v: 1,
    senseKey: "sense-run-verb",
    createdAt: "2026-08-26T08:00:00.000Z",
    id: "request-10",
    cutoff: "2026-08-26T09:00:00.000Z",
    scope: "TEACHER:user-1",
  });
  const last = encoded.at(-1)!;
  assert.equal(
    decodeCatalogSenseHistoryCursor(
      `${encoded.slice(0, -1)}${last === "a" ? "b" : "a"}`,
    ),
    null,
  );
});

test("sense history cursor rejects malformed dates and unsigned values", () => {
  assert.equal(decodeCatalogSenseHistoryCursor(null), null);
  assert.equal(decodeCatalogSenseHistoryCursor("not-signed"), null);
});
