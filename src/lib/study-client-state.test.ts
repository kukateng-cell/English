import assert from "node:assert/strict";
import test from "node:test";
import { clearAllStudyClientState, clearStudyClientState } from "./study-client-state";

class MemoryStorage {
  private values = new Map<string, string>();
  get length(): number { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
}

test("suspension cleanup removes both V1 and V2 account-local state", () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  storage.setItem("study:checkpoint:user-a:global", "v1");
  storage.setItem("study:checkpoint:user-b:global", "keep");
  storage.setItem("study:review-queue:user-a", "queue");
  storage.setItem("study:review-item:user-a:op-1", "item");
  storage.setItem("study:review-mutation:user-a", "mutation");
  storage.setItem("study:review-server-revision:user-a", "revision");
  storage.setItem("study:review-active-lease:user-a:lease-1", "lease");
  storage.setItem("english:study-stream-v2:outbox:user-a", "v2");
  storage.setItem("english:study-stream-v2:checkpoint:user-a:global", "v2cp");
  storage.setItem("english:study-stream-v2:checkpoint:user-a:unit", "v2unit");
  storage.setItem("english:study-stream-v2:checkpoint:user-b:global", "keep");

  clearStudyClientState("user-a");

  assert.equal(storage.getItem("study:checkpoint:user-a:global"), null);
  assert.equal(storage.getItem("study:review-queue:user-a"), null);
  assert.equal(storage.getItem("study:review-item:user-a:op-1"), null);
  assert.equal(storage.getItem("study:review-mutation:user-a"), null);
  assert.equal(storage.getItem("study:review-server-revision:user-a"), null);
  assert.equal(storage.getItem("study:review-active-lease:user-a:lease-1"), null);
  assert.equal(storage.getItem("english:study-stream-v2:outbox:user-a"), null);
  assert.equal(storage.getItem("english:study-stream-v2:checkpoint:user-a:global"), null);
  assert.equal(storage.getItem("english:study-stream-v2:checkpoint:user-a:unit"), null);
  assert.equal(storage.getItem("study:checkpoint:user-b:global"), "keep");
  assert.equal(storage.getItem("english:study-stream-v2:checkpoint:user-b:global"), "keep");
  delete (globalThis as { window?: unknown }).window;
});

test("unauthenticated boundary clears all namespaced study state", () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  for (const [key, value] of [
    ["study:checkpoint:user-a:global", "v1"],
    ["study:review-queue:user-a", "queue"],
    ["study:review-item:user-b:op-1", "item"],
    ["study:review-mutation:user-b", "mutation"],
    ["study:review-server-revision:user-b", "revision"],
    ["study:review-active-lease:user-b:lease-1", "lease"],
    ["study:review-queue", "legacy"],
    ["english:study-stream-v2:outbox:user-a", "v2"],
    ["english:study-stream-v2:checkpoint:user-b:global", "v2cp"],
    ["unrelated:key", "keep"],
  ] as const) storage.setItem(key, value);

  clearAllStudyClientState();

  for (const key of [
    "study:checkpoint:user-a:global",
    "study:review-queue:user-a",
    "study:review-item:user-b:op-1",
    "study:review-mutation:user-b",
    "study:review-server-revision:user-b",
    "study:review-active-lease:user-b:lease-1",
    "study:review-queue",
    "english:study-stream-v2:outbox:user-a",
    "english:study-stream-v2:checkpoint:user-b:global",
  ]) assert.equal(storage.getItem(key), null);
  assert.equal(storage.getItem("unrelated:key"), "keep");
  delete (globalThis as { window?: unknown }).window;
});
