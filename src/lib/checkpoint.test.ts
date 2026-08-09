import test from "node:test";
import assert from "node:assert/strict";
import { loadCheckpoint, saveCheckpoint } from "./checkpoint";

test("checkpoint is user scoped and retains an unfinished quiz", () => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
        removeItem: (key: string) => data.delete(key),
      },
    },
  });

  saveCheckpoint("user-a", "global", {
    phase: "quiz",
    unitKey: "global",
    queueSignature: ["word-2", "word-1"],
    studySessionId: "session-12345678",
    currentIndex: 0,
    knownWordIds: ["word-2"],
    unknownWordIds: [],
    quizStats: { correct: 0, wrong: 1 },
    quizTargetId: "word-2",
    quizWrongCount: 1,
    pendingQuizIds: [],
  });

  assert.equal(loadCheckpoint("user-b", "global"), null);
  const restored = loadCheckpoint("user-a", "global");
  assert.equal(restored?.phase, "quiz");
  assert.equal(restored?.currentIndex, 0);
  assert.deepEqual(restored?.queueSignature, ["word-2", "word-1"]);
});

test("malformed current-version checkpoints are rejected without throwing", () => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
        removeItem: (key: string) => data.delete(key),
      },
    },
  });
  const key = "study:checkpoint:user-a:global";
  const base = {
    version: 5,
    ownerId: "user-a",
    unitKey: "global",
    ts: Date.now(),
    phase: "assess",
    currentIndex: 0,
    knownWordIds: [],
    unknownWordIds: [],
    quizStats: { correct: 0, wrong: 0 },
    quizTargetId: null,
    quizWrongCount: 0,
    pendingQuizIds: [],
    studySessionId: "session-12345678",
  };

  for (const queueSignature of [null, "word-1", ["dup", "dup"], ["bad,id"]]) {
    data.set(key, JSON.stringify({ ...base, queueSignature }));
    assert.equal(loadCheckpoint("user-a", "global"), null);
  }

  for (const inconsistent of [
    {
      ...base,
      queueSignature: ["word-1"],
      phase: "quiz",
      quizTargetId: "not-in-queue",
    },
    {
      ...base,
      queueSignature: ["word-1"],
      pendingQuizIds: ["not-in-queue"],
    },
    {
      ...base,
      queueSignature: ["word-1"],
      knownWordIds: ["word-1"],
      unknownWordIds: ["word-1"],
    },
  ]) {
    data.set(key, JSON.stringify(inconsistent));
    assert.equal(loadCheckpoint("user-a", "global"), null);
  }
});
