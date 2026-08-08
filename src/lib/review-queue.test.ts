import test from "node:test";
import assert from "node:assert/strict";
import {
  attachStudySessionCredentials,
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

function credentials(operationId: string) {
  return {
    studySessionId: `session-${operationId}`,
    nonce: `nonce-${operationId}`,
  };
}

test("outbox is user scoped and preserves repeated reviews of one word", () => {
  installStorage();
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, credentials("operation-a1"));
  enqueuePendingReview("user-a", "operation-a2", "word-1", 3, credentials("operation-a2"));

  assert.equal(pendingReviewCount("user-a"), 2);
  assert.equal(pendingReviewCount("user-b"), 0);
  assert.deepEqual(
    loadPendingReviews("user-a").map((item) => item.operationId),
    ["operation-a1", "operation-a2"],
  );
});

test("legacy binding cannot steal a nonce already owned by a current answer", () => {
  installStorage();
  enqueuePendingReview("user-a", "legacy-a1", "word-1", 3);
  enqueuePendingReview(
    "user-a",
    "current-a1",
    "word-1",
    5,
    { studySessionId: "session-current", nonce: "nonce-current" },
  );

  attachStudySessionCredentials("user-a", "session-current", {
    "word-1": "nonce-current",
  });

  const rows = loadPendingReviews("user-a");
  const legacy = rows.find((row) => row.operationId === "legacy-a1");
  const current = rows.find((row) => row.operationId === "current-a1");
  assert.ok(legacy);
  assert.ok(current);
  assert.equal(legacy.nonce, undefined);
  assert.equal(current.nonce, "nonce-current");
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

test("persistent server errors stop the batch and back off without deleting an event", async () => {
  installStorage();
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, credentials("operation-a1"));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("{}", { status: 500 });
  };
  try {
    await flushPendingReviews("user-a");
    assert.equal(pendingReviewCount("user-a"), 1);
    assert.equal(loadPendingReviews("user-a")[0].attempts, 1);
    assert.equal(calls, 1);
    assert.ok(loadPendingReviews("user-a")[0].nextAttemptAt! > Date.now());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("flush preserves an event enqueued while a request is in flight", async () => {
  installStorage();
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, credentials("operation-a1"));
  const originalFetch = globalThis.fetch;
  let release!: (response: Response) => void;
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => {
      release = resolve;
    });
  try {
    const flushing = flushPendingReviews("user-a");
    await new Promise((resolve) => setTimeout(resolve, 0));
    enqueuePendingReview("user-a", "operation-a2", "word-2", 4, credentials("operation-a2"));
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
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, credentials("operation-a1"));
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
    enqueuePendingReview("user-a", "operation-a2", "word-2", 4, credentials("operation-a2"));
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
  enqueuePendingReview("user-a", "operation-a1", "deleted-word", 5, credentials("operation-a1"));
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

test("legacy outbox rows stay pending until a server nonce is attached", async () => {
  installStorage();
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("{}", { status: 200 });
  };
  try {
    await flushPendingReviews("user-a");
    assert.equal(calls, 0);
    assert.equal(pendingReviewCount("user-a"), 1);
    assert.equal(loadPendingReviews("user-a")[0].status, "pending");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("expired session credentials stay pending until a fresh session is loaded", async () => {
  installStorage();
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, {
    studySessionId: "session-expired",
    nonce: "nonce-expired",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "学习 session 无效或已过期" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  try {
    await flushPendingReviews("user-a");
    assert.equal(pendingReviewCount("user-a"), 1);
    assert.equal(blockedReviewCount("user-a"), 0);
    assert.equal(loadPendingReviews("user-a")[0].nonce, undefined);

    attachStudySessionCredentials("user-a", "session-expired", {
      "word-1": "nonce-still-expired",
    });
    assert.equal(loadPendingReviews("user-a")[0].nonce, undefined);

    attachStudySessionCredentials("user-a", "session-fresh", {
      "word-1": "nonce-fresh",
    });
    assert.equal(loadPendingReviews("user-a")[0].nonce, "nonce-fresh");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
