import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchWithTimeout,
  readResponseJsonWithTimeout,
  RosterRequestTimeoutError,
} from "@/lib/roster-client";

test("response-body timeout cancels a hanging response stream", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start() {
      // Keep the reader waiting for more bytes until the application
      // deadline aborts and cancels the body.
    },
    cancel() {
      cancelled = true;
    },
  }));
  await assert.rejects(
    () => readResponseJsonWithTimeout(response, 15),
    (error: unknown) => error instanceof RosterRequestTimeoutError && error.code === "REQUEST_TIMEOUT",
  );
  assert.equal(cancelled, true);
});

test("fetch timeout aborts the underlying request and exposes a typed error", async () => {
  const originalFetch = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = (async (_input, init) => {
    const signal = init?.signal;
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    await new Promise<never>((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    });
    throw new Error("unreachable");
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => fetchWithTimeout("http://localhost/black-hole", {}, 15),
      (error: unknown) => error instanceof RosterRequestTimeoutError && error.code === "REQUEST_TIMEOUT",
    );
    assert.equal(aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
