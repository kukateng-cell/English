import test from "node:test";
import assert from "node:assert/strict";
import { MAX_ROSTER_FILE_BYTES } from "./roster-file";
import {
  parseRosterUploadMetadata,
  readRosterUploadBody,
  ROSTER_UPLOAD_HEADERS,
} from "./roster-upload";

function validHeaders(overrides: Record<string, string> = {}): Headers {
  return new Headers({
    "Content-Type": "text/csv; charset=utf-8",
    [ROSTER_UPLOAD_HEADERS.fileName]: encodeURIComponent("學生名單.csv"),
    [ROSTER_UPLOAD_HEADERS.entityType]: "STUDENT",
    [ROSTER_UPLOAD_HEADERS.academicYearId]: "year-current",
    [ROSTER_UPLOAD_HEADERS.mode]: "CREATE_ONLY",
    [ROSTER_UPLOAD_HEADERS.acknowledgeImmediateGlobalCapabilityChange]: "false",
    [ROSTER_UPLOAD_HEADERS.operationId]: "operation-01",
    ...overrides,
  });
}

function streamingRequest(
  chunks: Uint8Array[],
  headers = new Headers(),
): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Request("http://localhost/api/admin/roster/import/preview", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

test("roster upload metadata requires an exact extension and media type pair", () => {
  assert.deepEqual(parseRosterUploadMetadata(validHeaders()), {
    fileName: "學生名單.csv",
    format: "CSV",
    entityType: "STUDENT",
    academicYearId: "year-current",
    mode: "CREATE_ONLY",
    acknowledgeImmediateGlobalCapabilityChange: false,
    operationId: "operation-01",
  });
  assert.throws(
    () => parseRosterUploadMetadata(validHeaders({ "Content-Type": "application/json" })),
    (error: unknown) => error instanceof Error && error.message === "ROSTER_CONTENT_TYPE_INVALID",
  );
  assert.throws(
    () => parseRosterUploadMetadata(validHeaders({
      [ROSTER_UPLOAD_HEADERS.fileName]: encodeURIComponent("../名單.csv"),
    })),
    (error: unknown) => error instanceof Error && error.message === "ROSTER_FILE_NAME_INVALID",
  );
});

test("roster upload rejects a declared body above the limit before reading it", async () => {
  const headers = validHeaders({ "Content-Length": String(MAX_ROSTER_FILE_BYTES + 1) });
  await assert.rejects(
    readRosterUploadBody(streamingRequest([new Uint8Array([1])], headers)),
    (error: unknown) => error instanceof Error && error.message === "ROSTER_FILE_TOO_LARGE",
  );
});

test("roster upload enforces the byte limit while streaming", async () => {
  const first = new Uint8Array(MAX_ROSTER_FILE_BYTES);
  const exact = await readRosterUploadBody(streamingRequest([first]));
  assert.equal(exact.byteLength, MAX_ROSTER_FILE_BYTES);

  await assert.rejects(
    readRosterUploadBody(streamingRequest([first, new Uint8Array([1])])),
    (error: unknown) => error instanceof Error && error.message === "ROSTER_FILE_TOO_LARGE",
  );
});
