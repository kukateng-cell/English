import assert from "node:assert/strict";
import test from "node:test";
import { catalogPendingRequestForActor } from "./pending-visibility";

const request = {
  id: "request-1",
  kind: "UPDATE",
  status: "PENDING",
  proposerId: "teacher-a",
  reason: "internal draft reason",
  payload: { definitionZh: "未批准內容" },
};

test("pending catalog drafts are complete only for their owner or a reviewer", () => {
  assert.deepEqual(
    catalogPendingRequestForActor(request, "teacher-a", false),
    request,
  );
  assert.deepEqual(
    catalogPendingRequestForActor(request, "reviewer-b", true),
    request,
  );
});

test("another ordinary teacher receives only a redacted pending summary", () => {
  assert.deepEqual(
    catalogPendingRequestForActor(request, "teacher-b", false),
    { restricted: true, kind: "UPDATE", status: "PENDING" },
  );
});
