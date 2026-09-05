import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB } from "fake-indexeddb";
import { createStudyStreamCredential, type StudyStreamActionInput } from "@/lib/study-stream/contracts";
import {
  StudyStreamOutboxCorruptError,
  STUDY_STREAM_OUTBOX_MAX_ROWS,
  enqueueStudyStreamAction,
  loadStudyStreamOutbox,
  loadStudyStreamCheckpoint,
  saveStudyStreamCheckpoint,
  updateStudyStreamAction,
  removeStudyStreamAction,
} from "@/lib/study-stream/outbox";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test("V2 outbox action schema keeps credentials and payload scoped to one operation", () => {
  const action: StudyStreamActionInput = {
    flowVersion: "v2",
    studySessionId: "session-123",
    streamItemId: "item-123",
    operationId: "operation-123",
    itemCredential: createStudyStreamCredential(),
    actionKind: "SELF_RATING",
    clientKnownRevision: 1,
    payload: { selfRating: "selfForgot" },
  };
  assert.deepEqual(action.payload, { selfRating: "selfForgot" });
  assert.equal(Object.prototype.hasOwnProperty.call(action.payload, "wordId"), false);
});

test("V2 outbox rejects corruption and can rebind an expiring item credential", async () => {
  const previousWindow = globalThis.window;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, indexedDB },
  });
  try {
    const userId = "outbox-user";
    const action: StudyStreamActionInput = {
      flowVersion: "v2",
      studySessionId: "session-123",
      streamItemId: "item-123",
      operationId: "operation-123",
      itemCredential: createStudyStreamCredential(),
      actionKind: "SELF_RATING",
      clientKnownRevision: 1,
      payload: { selfRating: "selfForgot" },
    };
    assert.deepEqual(await enqueueStudyStreamAction(userId, action), { ok: true });
    const reboundCredential = createStudyStreamCredential();
    await updateStudyStreamAction(userId, action.operationId, {
      studySessionId: action.studySessionId,
      streamItemId: action.streamItemId,
      itemCredential: reboundCredential,
      clientKnownRevision: 2,
    });
    assert.equal(loadStudyStreamOutbox(userId)[0]?.action.itemCredential, reboundCredential);
    assert.equal(loadStudyStreamOutbox(userId)[0]?.action.clientKnownRevision, 2);

    storage.setItem("english:study-stream-v2:outbox:corrupt", "{");
    assert.throws(
      () => loadStudyStreamOutbox("corrupt"),
      StudyStreamOutboxCorruptError,
    );

    storage.setItem("english:study-stream-v2:outbox:oversized", JSON.stringify(
      Array.from({ length: STUDY_STREAM_OUTBOX_MAX_ROWS + 1 }, () => ({ invalid: true })),
    ));
    assert.throws(
      () => loadStudyStreamOutbox("oversized"),
      StudyStreamOutboxCorruptError,
    );

    storage.setItem("english:study-stream-v2:checkpoint:outbox-user:global", JSON.stringify({
      version: 1,
      sessionId: "session-123",
      streamItemId: null,
      clientRevision: -1,
      phase: "unexpected",
      updatedAt: Date.now(),
    }));
    assert.equal(
      // A malformed checkpoint must not become an interactive presentation state.
      // The server bootstrap remains the source of truth.
      loadStudyStreamCheckpoint("outbox-user", "global"),
      null,
    );

    const checkpoint = {
      sessionId: "session-123",
      streamItemId: "item-123",
      clientRevision: 2,
      phase: "learning-card" as const,
    };
    assert.deepEqual(saveStudyStreamCheckpoint(userId, "global", checkpoint), { ok: true });
    const savedCheckpoint = storage.getItem("english:study-stream-v2:checkpoint:outbox-user:global");
    assert.deepEqual(saveStudyStreamCheckpoint(userId, "global", checkpoint), { ok: true });
    assert.equal(storage.getItem("english:study-stream-v2:checkpoint:outbox-user:global"), savedCheckpoint);
    storage.setItem("english:study-stream-v2:checkpoint:outbox-user:global", JSON.stringify({
      version: 1,
      sessionId: checkpoint.sessionId,
      streamItemId: checkpoint.streamItemId,
      clientRevision: checkpoint.clientRevision,
      phase: checkpoint.phase,
      updatedAt: "corrupt",
    }));
    assert.deepEqual(saveStudyStreamCheckpoint(userId, "global", checkpoint), { ok: true });
    assert.equal(typeof loadStudyStreamCheckpoint(userId, "global")?.updatedAt, "number");

    storage.clear();
    for (let index = 0; index < STUDY_STREAM_OUTBOX_MAX_ROWS; index += 1) {
      assert.deepEqual(await enqueueStudyStreamAction(userId, {
        ...action,
        operationId: `operation-${index.toString().padStart(2, "0")}`,
      }), { ok: true });
    }
    assert.deepEqual(await enqueueStudyStreamAction(userId, {
      ...action,
      operationId: "operation-over-capacity",
    }), {
      ok: false,
      error: "待同步學習操作已達安全上限；請先恢復同步後再繼續學習",
    });
    storage.clear();
    const second = { ...action, operationId: "operation-second" };
    await Promise.all([enqueueStudyStreamAction(userId, action), enqueueStudyStreamAction(userId, second)]);
    assert.equal(loadStudyStreamOutbox(userId).length, 2);
    await Promise.all([
      removeStudyStreamAction(userId, action.operationId),
      enqueueStudyStreamAction(userId, { ...action, operationId: "operation-third" }),
    ]);
    assert.deepEqual(loadStudyStreamOutbox(userId).map(row => row.action.operationId).sort(), ["operation-second", "operation-third"]);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  }
});
