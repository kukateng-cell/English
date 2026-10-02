import assert from "node:assert/strict";
import test from "node:test";
import { readLimitedBody } from "./body";

test("body cap rejects declared and streamed overflow and cancels the reader", async () => {
  await assert.rejects(readLimitedBody(new Request("http://localhost", { method: "POST", headers: { "content-length": "100" }, body: "{}" }), 10, "CATALOG_INPUT_TOO_LARGE"), /CATALOG_INPUT_TOO_LARGE/);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(8)); },
    cancel() { cancelled = true; },
  });
  const request = { headers: new Headers(), body } as Request;
  await assert.rejects(readLimitedBody(request, 10, "CATALOG_INPUT_TOO_LARGE"), /CATALOG_INPUT_TOO_LARGE/);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test("body cap accepts exact UTF-8 byte boundary", async () => {
  const request = new Request("http://localhost", { method: "POST", body: "中文字" });
  assert.equal(new TextDecoder().decode(await readLimitedBody(request, 9)), "中文字");
});
