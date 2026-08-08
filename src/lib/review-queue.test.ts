import test from "node:test";
import assert from "node:assert/strict";
import {
  enqueuePendingReview,
  flushPendingReviews,
  loadPendingReviews,
  pendingReviewCount,
  blockedReviewCount,
} from "./review-queue";

function installStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        get length() {
          return data.size;
        },
        key: (index: number) => [...data.keys()][index] ?? null,
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
        removeItem: (key: string) => data.delete(key),
      },
    },
  });
  return data;
}

test("outbox is user scoped and preserves repeated reviews of one word", () => {
  installStorage();
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5);
  enqueuePendingReview("user-a", "operation-a2", "word-1", 3);

  assert.equal(pendingReviewCount("user-a"), 2);
  assert.equal(pendingReviewCount("user-b"), 0);
  assert.deepEqual(
    loadPendingReviews("user-a").map((item) => item.operationId),
    ["operation-a1", "operation-a2"],
  );
});

test("enqueue fails visibly when durable browser storage is unavailable", () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota exceeded");
        },
      },
    },
  });
  assert.throws(
    () => enqueuePendingReview("user-a", "operation-a1", "word-1", 5),
    /REVIEW_QUEUE_STORAGE_UNAVAILABLE/,
  );
});

test("persistent server errors never silently delete an outbox event", async () => {
  installStorage();
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 500 });
  try {
    for (let i = 0; i < 8; i++) {
      await flushPendingReviews("user-a");
    }
    assert.equal(pendingReviewCount("user-a"), 1);
    assert.equal(loadPendingReviews("user-a")[0].attempts, 8);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("flush preserves an event enqueued while a request is in flight", async () => {
  installStorage();
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5);
  const originalFetch = globalThis.fetch;
  let release!: (response: Response) => void;
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => {
      release = resolve;
    });
  try {
    const flushing = flushPendingReviews("user-a");
    await new Promise((resolve) => setTimeout(resolve, 0));
    enqueuePendingReview("user-a", "operation-a2", "word-2", 4);
    release(new Response("{}", { status: 200 }));
    await flushing;
    assert.deepEqual(
      loadPendingReviews("user-a").map((item) => item.operationId),
      ["operation-a2"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fallback mutex runs a trailing scan for an explicit concurrent flush", async () => {
  installStorage();
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5);
  const originalFetch = globalThis.fetch;
  const submitted: string[] = [];
  let releaseFirst!: (response: Response) => void;
  globalThis.fetch = async (_input, init) => {
    const operationId = JSON.parse(String(init?.body)).operationId as string;
    submitted.push(operationId);
    if (operationId === "operation-a1") {
      return new Promise<Response>((resolve) => {
        releaseFirst = resolve;
      });
    }
    return new Response("{}", { status: 200 });
  };
  try {
    const first = flushPendingReviews("user-a");
    await new Promise((resolve) => setTimeout(resolve, 0));
    enqueuePendingReview("user-a", "operation-a2", "word-2", 4);
    const trailing = flushPendingReviews("user-a");
    releaseFirst(new Response("{}", { status: 200 }));
    await Promise.all([first, trailing]);
    assert.deepEqual(submitted, ["operation-a1", "operation-a2"]);
    assert.equal(pendingReviewCount("user-a"), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("permanent client errors become visible blocked entries", async () => {
  installStorage();
  enqueuePendingReview("user-a", "operation-a1", "deleted-word", 5);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "单词不存在" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  try {
    await flushPendingReviews("user-a");
    assert.equal(pendingReviewCount("user-a"), 0);
    assert.equal(blockedReviewCount("user-a"), 1);
    assert.equal(loadPendingReviews("user-a")[0].status, "blocked");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("one corrupt storage row does not hide valid outbox operations", () => {
  const data = installStorage();
  data.set("study:review-queue:user-a", "{broken legacy json");
  data.set("study:review-item:user-a:corrupt", "{broken item json");
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5);

  assert.deepEqual(
    loadPendingReviews("user-a").map((item) => item.operationId),
    ["operation-a1"],
  );
});
