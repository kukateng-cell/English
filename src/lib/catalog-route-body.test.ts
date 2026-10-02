import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogPost } from "@/app/api/catalog/route";
import { createCatalogReviewPatch } from "@/app/api/catalog/requests/[id]/route";

const dependencies = {
  requireRole: async () => ({ ok: true as const, userId: "body-test-admin", role: "ADMIN" as const }),
  consumeCatalogGovernanceLimit: async () => ({ ok: true as const }),
};
const headers = { origin: "http://localhost", cookie: "roster-csrf=body-test", "x-csrf-token": "body-test" };

test("catalog submission and review routes stop oversized streams and preserve 413/422", async () => {
  const handlers = [
    (request: Request) => createCatalogPost(dependencies)(request),
    (request: Request) => createCatalogReviewPatch(dependencies)(request, { params: Promise.resolve({ id: "request-test" }) }),
  ];
  for (const handler of handlers) {
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(64 * 1024)); },
      cancel() { cancelled = true; },
    });
    const request = new Request("http://localhost/api/catalog", { method: "POST", headers, body: stream, duplex: "half" } as RequestInit);
    const response = await handler(request);
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, "CATALOG_INPUT_TOO_LARGE");
    assert.equal(cancelled, true);
    // 128 KiB route: two legal chunks, one overflowing chunk, one stream prefetch.
    assert.ok(pulls <= 4, `stream was over-read: ${pulls}`);
    const malformed = await handler(new Request("http://localhost/api/catalog", { method: "POST", headers, body: "{" }));
    assert.equal(malformed.status, 422);
    assert.equal((await malformed.json()).code, "CATALOG_INPUT_INVALID");
  }
});
