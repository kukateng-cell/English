import test from "node:test";
import assert from "node:assert/strict";
import {
  attachStudySessionCredentials,
  rebindStudySessionCredentials,
  finalizeLegacyCredentialClaims,
  enqueuePendingReview,
  flushPendingReviews,
  loadPendingReviews,
  pendingReviewCount,
  blockedReviewCount,
  parseReviewQueueMutationEvent,
  planReviewQueueMutation,
  reviewQueueMutationStorageKey,
  ReviewQueueStorageError,
  type ReviewQueueMutationEvent,
} from "./review-queue";

function installStorage(
  shouldFailWrite?: (key: string, value: string) => boolean,
  shouldFailRemove?: (key: string) => boolean,
) {
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
        setItem: (key: string, value: string) => {
          if (shouldFailWrite?.(key, value)) throw new Error("quota exceeded");
          data.set(key, value);
        },
        removeItem: (key: string) => {
          if (shouldFailRemove?.(key)) throw new Error("storage unavailable");
          data.delete(key);
        },
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
  finalizeLegacyCredentialClaims("user-a");

  const rows = loadPendingReviews("user-a");
  const legacy = rows.find((row) => row.operationId === "legacy-a1");
  const current = rows.find((row) => row.operationId === "current-a1");
  assert.ok(legacy);
  assert.ok(current);
  assert.equal(legacy.nonce, undefined);
  assert.equal(legacy.status, "blocked");
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

test("successful submission publishes and then releases its cross-tab mutation lease", async () => {
  const mutationEvents: ReviewQueueMutationEvent[] = [];
  installStorage((key, value) => {
    if (key !== reviewQueueMutationStorageKey("user-a")) return false;
    const event = parseReviewQueueMutationEvent("user-a", value);
    if (event) mutationEvents.push(event);
    return false;
  });
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, {
    studySessionId: "session-valid",
    nonce: "nonce-valid",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  try {
    await flushPendingReviews("user-a");
    const serverEvent = mutationEvents.find(
      (event) => event.kind === "server-mutated",
    );
    const releaseEvent = mutationEvents.at(-1);
    assert.ok(serverEvent);
    assert.deepEqual(serverEvent.wordIds, ["word-1"]);
    assert.deepEqual(serverEvent.sessionIds, ["session-valid"]);
    assert.equal(releaseEvent?.kind, "mutation-released");
    assert.equal(releaseEvent?.leaseId, serverEvent.leaseId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("already-processed nonce conflict reconciles instead of blocking", async () => {
  installStorage();
  enqueuePendingReview("user-a", "operation-b", "word-1", 4, {
    studySessionId: "shared-session",
    nonce: "shared-nonce",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: "该学习题目已经提交",
        code: "REVIEW_ALREADY_PROCESSED",
        requiresQueueReload: true,
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  const completed: Array<{ wordId: string; reconciled?: boolean }> = [];
  try {
    const remaining = await flushPendingReviews("user-a", (wordId, result) => {
      completed.push({ wordId, reconciled: result.reconciled });
    });
    assert.equal(remaining, 0);
    assert.equal(blockedReviewCount("user-a"), 0);
    assert.equal(loadPendingReviews("user-a").length, 0);
    assert.deepEqual(completed, [{ wordId: "word-1", reconciled: true }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("superseded credential renewal reconciles instead of blocking", async () => {
  installStorage();
  enqueuePendingReview("user-a", "operation-stale", "word-1", 4, {
    studySessionId: "session-retired",
    nonce: "nonce-retired",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input) === "/api/study") {
      return new Response(JSON.stringify({ error: "学习 session 无效或已过期" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        error: "学习 session 已由较新的凭证取代",
        code: "SESSION_SUPERSEDED",
        requiresQueueReload: true,
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  };
  const completed: Array<{ wordId: string; reconciled?: boolean }> = [];
  try {
    const remaining = await flushPendingReviews("user-a", (wordId, result) => {
      completed.push({ wordId, reconciled: result.reconciled });
    });
    assert.equal(remaining, 0);
    assert.equal(blockedReviewCount("user-a"), 0);
    assert.equal(loadPendingReviews("user-a").length, 0);
    assert.deepEqual(completed, [{ wordId: "word-1", reconciled: true }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("one lease heartbeats before every sequential review request", async () => {
  const heartbeats: Array<{ leaseId?: string; expiresAt?: number }> = [];
  const terminalEvents: Array<{ kind: string; leaseId?: string }> = [];
  installStorage((key, value) => {
    if (key !== reviewQueueMutationStorageKey("user-a")) return false;
    const event = JSON.parse(value) as {
      kind?: string;
      leaseId?: string;
      expiresAt?: number;
    };
    if (event.kind === "mutation-started") {
      heartbeats.push({ leaseId: event.leaseId, expiresAt: event.expiresAt });
    } else if (
      event.kind === "server-mutated" ||
      event.kind === "mutation-released"
    ) {
      terminalEvents.push({ kind: event.kind, leaseId: event.leaseId });
    }
    return false;
  });
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, credentials("operation-a1"));
  enqueuePendingReview("user-a", "operation-a2", "word-2", 5, credentials("operation-a2"));
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  globalThis.fetch = async () => {
    now += 14_000;
    return new Response("{}", { status: 200 });
  };
  try {
    await flushPendingReviews("user-a");
    assert.ok(heartbeats.length >= 3);
    assert.equal(new Set(heartbeats.map((event) => event.leaseId)).size, 1);
    assert.ok(heartbeats.every((event) => Boolean(event.leaseId)));
    assert.ok(
      heartbeats.at(-1)!.expiresAt! > heartbeats[0].expiresAt!,
      "lease expiry was not extended between sequential requests",
    );
    assert.deepEqual(
      terminalEvents.map((event) => event.kind),
      ["server-mutated", "mutation-released"],
    );
    assert.ok(
      terminalEvents.every((event) => event.leaseId === heartbeats[0].leaseId),
      "mutation and release markers must close the same lease",
    );
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});

test("mutation plan is computed inside the Web Lock before network work", async () => {
  const data = installStorage();
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, credentials("operation-a1"));
  const itemKey = "study:review-item:user-a:operation-a1";
  const row = JSON.parse(data.get(itemKey)!) as Record<string, unknown>;
  row.nextAttemptAt = Date.now() + 60_000;
  data.set(itemKey, JSON.stringify(row));

  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalFetch = globalThis.fetch;
  const order: string[] = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        request: async (_name: string, callback: () => Promise<number>) => {
          const due = JSON.parse(data.get(itemKey)!) as Record<string, unknown>;
          due.nextAttemptAt = Date.now() - 1;
          data.set(itemKey, JSON.stringify(due));
          return callback();
        },
      },
    },
  });
  globalThis.fetch = async () => {
    order.push("fetch");
    return new Response("{}", { status: 200 });
  };
  try {
    await flushPendingReviews("user-a", undefined, (plan) => {
      order.push("barrier");
      assert.deepEqual(plan.willMutateWordIds, ["word-1"]);
    });
    assert.deepEqual(order, ["barrier", "fetch"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete (globalThis as { navigator?: unknown }).navigator;
    }
  }
});

test("successful submission retains its row when the mutation marker cannot be published", async () => {
  installStorage((key) => key === reviewQueueMutationStorageKey("user-a"));
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, {
    studySessionId: "session-valid",
    nonce: "nonce-valid",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  try {
    await assert.rejects(
      flushPendingReviews("user-a"),
      ReviewQueueStorageError,
    );
    assert.equal(pendingReviewCount("user-a"), 1);
    assert.equal(loadPendingReviews("user-a")[0]?.operationId, "operation-a1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mutation preflight includes due credentialed and adoptable legacy rows", () => {
  installStorage();
  enqueuePendingReview(
    "user-a",
    "operation-valid",
    "word-valid",
    5,
    credentials("operation-valid"),
  );
  enqueuePendingReview("user-a", "operation-legacy", "word-legacy", 3);

  const plan = planReviewQueueMutation("user-a", {
    studySessionId: "session-current",
    nonces: { "word-legacy": "nonce-legacy" },
  });
  assert.deepEqual(
    new Set(plan.willMutateWordIds),
    new Set(["word-valid", "word-legacy"]),
  );
  assert.deepEqual(plan.passivePendingWordIds, []);
});

test("mutation preflight treats expired credentials as active network work", () => {
  const data = installStorage();
  enqueuePendingReview(
    "user-a",
    "operation-expired",
    "word-expired",
    5,
    credentials("operation-expired"),
  );
  const key = "study:review-item:user-a:operation-expired";
  const row = JSON.parse(data.get(key)!) as Record<string, unknown>;
  delete row.nonce;
  row.credentialState = "expired";
  data.set(key, JSON.stringify(row));

  assert.deepEqual(
    planReviewQueueMutation("user-a").willMutateWordIds,
    ["word-expired"],
  );
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

test("partial legacy migration never overwrites a newer operation row", () => {
  const data = installStorage();
  const operationId = "operation-a1";
  data.set(
    "study:review-queue:user-a",
    JSON.stringify({
      version: 4,
      items: [
        {
          ownerId: "user-a",
          operationId,
          wordId: "word-1",
          quality: 2,
          ts: 100,
          attempts: 0,
          status: "pending",
          credentialState: "legacy-claimed",
        },
      ],
    }),
  );
  data.set(
    `study:review-item:user-a:${operationId}`,
    JSON.stringify({
      ownerId: "user-a",
      operationId,
      wordId: "word-1",
      quality: 5,
      ts: 100,
      attempts: 3,
      status: "pending",
      studySessionId: "session-current",
      nonce: "nonce-current",
      credentialState: "valid",
    }),
  );

  const [row] = loadPendingReviews("user-a");
  assert.equal(row.quality, 5);
  assert.equal(row.attempts, 3);
  assert.equal(row.nonce, "nonce-current");
  assert.equal(data.has("study:review-queue:user-a"), false);
});

test("legacy outbox rows become visibly blocked after one adoption pass", async () => {
  installStorage();
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("{}", { status: 200 });
  };
  try {
    finalizeLegacyCredentialClaims("user-a");
    await flushPendingReviews("user-a");
    assert.equal(calls, 0);
    assert.equal(pendingReviewCount("user-a"), 0);
    assert.equal(blockedReviewCount("user-a"), 1);
    assert.match(loadPendingReviews("user-a")[0].lastError ?? "", /来源凭证/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("expired session credentials are reauthorized and retried once", async () => {
  installStorage();
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, {
    studySessionId: "session-expired",
    nonce: "nonce-expired",
  });
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  let renewalBody: unknown;
  let retriedBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    if (requests.length === 1) {
      return new Response(JSON.stringify({ error: "学习 session 无效或已过期" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "/api/study/credentials") {
      renewalBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          studySession: {
            id: "session-fresh",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
          credentials: [
            {
              operationId: "operation-a1",
              wordId: "word-1",
              nonce: "nonce-fresh",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    retriedBody = JSON.parse(String(init?.body));
    return new Response("{}", { status: 200 });
  };
  try {
    await flushPendingReviews("user-a");
    assert.equal(pendingReviewCount("user-a"), 0);
    assert.equal(blockedReviewCount("user-a"), 0);
    assert.deepEqual(requests, [
      "/api/study",
      "/api/study/credentials",
      "/api/study",
    ]);
    assert.deepEqual(renewalBody, {
      previousSessionId: "session-expired",
      operations: [{ operationId: "operation-a1", wordId: "word-1" }],
    });
    const submittedAgain = retriedBody as Record<string, unknown> | null;
    assert.equal(submittedAgain?.studySessionId, "session-fresh");
    assert.equal(submittedAgain?.nonce, "nonce-fresh");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("only one repeated legacy review can adopt a word nonce", () => {
  installStorage();
  enqueuePendingReview("user-a", "legacy-a1", "word-1", 5);
  enqueuePendingReview("user-a", "legacy-a2", "word-1", 3);
  attachStudySessionCredentials("user-a", "session-fresh", {
    "word-1": "nonce-fresh",
  });
  finalizeLegacyCredentialClaims("user-a");

  const rows = loadPendingReviews("user-a");
  assert.equal(rows.filter((row) => row.credentialState === "valid").length, 1);
  assert.equal(rows.filter((row) => row.status === "blocked").length, 1);
});

test("rotation rebinds one pending operation per word", () => {
  installStorage();
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, {
    studySessionId: "session-old",
    nonce: "nonce-old",
  });
  enqueuePendingReview("user-a", "operation-a2", "word-1", 3, {
    studySessionId: "session-old",
    nonce: "nonce-old-2",
  });
  rebindStudySessionCredentials("user-a", "session-old", "session-new", {
    "word-1": "nonce-new",
  });
  const rows = loadPendingReviews("user-a");
  assert.equal(rows[0].studySessionId, "session-new");
  assert.equal(rows[0].nonce, "nonce-new");
  assert.equal(rows[1].studySessionId, "session-old");
});

test("rotation preserves a future retry deadline while refreshing credentials", () => {
  const data = installStorage();
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, {
    studySessionId: "session-old",
    nonce: "nonce-old",
  });
  const key = "study:review-item:user-a:operation-a1";
  const row = JSON.parse(data.get(key)!) as Record<string, unknown>;
  const retryAt = Date.now() + 10 * 60_000;
  row.nextAttemptAt = retryAt;
  data.set(key, JSON.stringify(row));

  rebindStudySessionCredentials("user-a", "session-old", "session-new", {
    "word-1": "nonce-new",
  });

  const rebound = loadPendingReviews("user-a")[0];
  assert.equal(rebound.studySessionId, "session-new");
  assert.equal(rebound.nextAttemptAt, retryAt);
});

test("rotation marker failure leaves old credentials untouched", () => {
  installStorage((key) => key === reviewQueueMutationStorageKey("user-a"));
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, {
    studySessionId: "session-old",
    nonce: "nonce-old",
  });

  assert.throws(
    () =>
      rebindStudySessionCredentials(
        "user-a",
        "session-old",
        "session-new",
        { "word-1": "nonce-new" },
      ),
    ReviewQueueStorageError,
  );
  const row = loadPendingReviews("user-a")[0];
  assert.equal(row.studySessionId, "session-old");
  assert.equal(row.nonce, "nonce-old");
});

for (const [status, error] of [
  [404, "原学习 session 不存在或已清理"],
  [403, "该单元已锁定"],
] as const) {
  test(`renewal ${status} blocks an expired row instead of retrying forever`, async () => {
    installStorage();
    enqueuePendingReview("user-a", "operation-a1", "word-1", 5, {
      studySessionId: "session-expired",
      nonce: "nonce-expired",
    });
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (input) => {
      calls++;
      if (String(input) === "/api/study") {
        return new Response(
          JSON.stringify({ error: "学习 session 无效或已过期" }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    };
    try {
      const remaining = await flushPendingReviews("user-a");
      assert.equal(calls, 2);
      assert.equal(remaining, 0);
      assert.equal(pendingReviewCount("user-a"), 0);
      assert.equal(blockedReviewCount("user-a"), 1);
      assert.equal(loadPendingReviews("user-a")[0].lastError, error);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("renewal 401 stays pending for retry after signing in again", async () => {
  installStorage();
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, {
    studySessionId: "session-expired",
    nonce: "nonce-expired",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) =>
    new Response(
      JSON.stringify({ error: String(input).includes("credentials") ? "未登录" : "学习 session 无效或已过期" }),
      {
        status: String(input).includes("credentials") ? 401 : 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  try {
    const remaining = await flushPendingReviews("user-a");
    assert.equal(remaining, 1);
    assert.equal(blockedReviewCount("user-a"), 0);
    assert.equal(loadPendingReviews("user-a")[0].credentialState, "expired");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("renewal rate limits set a cooldown before another credential request", async () => {
  installStorage();
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, {
    studySessionId: "session-expired",
    nonce: "nonce-expired",
  });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    if (String(input) === "/api/study") {
      return new Response(
        JSON.stringify({ error: "学习 session 无效或已过期" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ error: "请稍后再试" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "60",
      },
    });
  };
  try {
    await flushPendingReviews("user-a");
    const [row] = loadPendingReviews("user-a");
    assert.equal(calls, 2);
    assert.equal(row.credentialState, "expired");
    assert.ok(row.nextAttemptAt! >= Date.now() + 59_000);

    await flushPendingReviews("user-a");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("renewal storage failure replays one operation without blocking untouched rows", async () => {
  let failFreshCredentialWrite = false;
  const data = installStorage((_key, value) => {
    if (!failFreshCredentialWrite || !value.includes('"session-fresh-operation-a1"')) {
      return false;
    }
    failFreshCredentialWrite = false;
    return true;
  });
  for (const [operationId, wordId] of [
    ["operation-a1", "word-1"],
    ["operation-a2", "word-2"],
  ] as const) {
    enqueuePendingReview("user-a", operationId, wordId, 5, {
      studySessionId: "session-expired",
      nonce: `nonce-${operationId}`,
    });
    const key = `study:review-item:user-a:${operationId}`;
    const row = JSON.parse(data.get(key)!) as Record<string, unknown>;
    delete row.nonce;
    row.credentialState = "expired";
    data.set(key, JSON.stringify(row));
  }

  const originalFetch = globalThis.fetch;
  const renewalOperations: string[][] = [];
  const submitted: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (url === "/api/study/credentials") {
      const operations = body.operations as Array<{
        operationId: string;
        wordId: string;
      }>;
      renewalOperations.push(operations.map((item) => item.operationId));
      const operation = operations[0];
      failFreshCredentialWrite = renewalOperations.length === 1;
      return new Response(
        JSON.stringify({
          studySession: { id: `session-fresh-${operation.operationId}` },
          credentials: [
            {
              ...operation,
              nonce: `nonce-fresh-${operation.operationId}`,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    submitted.push(body.operationId as string);
    return new Response("{}", { status: 200 });
  };

  try {
    await assert.rejects(
      flushPendingReviews("user-a"),
      ReviewQueueStorageError,
    );
    assert.equal(pendingReviewCount("user-a"), 2);
    assert.equal(blockedReviewCount("user-a"), 0);

    await flushPendingReviews("user-a");
    await flushPendingReviews("user-a");

    assert.deepEqual(renewalOperations, [
      ["operation-a1"],
      ["operation-a1"],
      ["operation-a2"],
    ]);
    assert.deepEqual(submitted, ["operation-a1", "operation-a2"]);
    assert.equal(pendingReviewCount("user-a"), 0);
    assert.equal(blockedReviewCount("user-a"), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("successful submission fails visibly when local cleanup cannot be persisted", async () => {
  let failRemoval = true;
  installStorage(undefined, (key) =>
    failRemoval && key.includes("operation-a1"),
  );
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, {
    studySessionId: "session-valid",
    nonce: "nonce-valid",
  });
  const originalFetch = globalThis.fetch;
  let submissions = 0;
  globalThis.fetch = async () => {
    submissions++;
    return new Response("{}", { status: 200 });
  };

  try {
    await assert.rejects(
      flushPendingReviews("user-a"),
      ReviewQueueStorageError,
    );
    assert.equal(pendingReviewCount("user-a"), 1);
    failRemoval = false;
    await flushPendingReviews("user-a");
    assert.equal(submissions, 2);
    assert.equal(pendingReviewCount("user-a"), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retry state fails visibly when browser storage rejects the backoff update", async () => {
  let failRetryWrite = false;
  installStorage((_key, value) =>
    failRetryWrite && value.includes('"attempts":1'),
  );
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, {
    studySessionId: "session-valid",
    nonce: "nonce-valid",
  });
  failRetryWrite = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("server error", { status: 500 });

  try {
    await assert.rejects(
      flushPendingReviews("user-a"),
      ReviewQueueStorageError,
    );
    const [row] = loadPendingReviews("user-a");
    assert.equal(row.attempts, 0);
    assert.equal(row.nextAttemptAt, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rotation rebind fails visibly when browser storage is unavailable", () => {
  let failRebind = false;
  installStorage((_key, value) =>
    failRebind && value.includes('"studySessionId":"session-new"'),
  );
  enqueuePendingReview("user-a", "operation-a1", "word-1", 5, {
    studySessionId: "session-old",
    nonce: "nonce-old",
  });
  failRebind = true;

  assert.throws(
    () =>
      rebindStudySessionCredentials(
        "user-a",
        "session-old",
        "session-new",
        { "word-1": "nonce-new" },
      ),
    ReviewQueueStorageError,
  );
});
