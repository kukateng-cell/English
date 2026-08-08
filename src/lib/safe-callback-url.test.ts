import test from "node:test";
import assert from "node:assert/strict";
import { safeCallbackPath } from "./safe-callback-url";

const ORIGIN = "https://words.example";

test("accepts same-origin application paths", () => {
  assert.equal(
    safeCallbackPath("/study?level=A1#quiz", ORIGIN),
    "/study?level=A1#quiz",
  );
});

test("rejects protocol-relative and backslash callback bypasses", () => {
  assert.equal(safeCallbackPath("//evil.example", ORIGIN), "/");
  assert.equal(safeCallbackPath("/\\evil.example", ORIGIN), "/");
  assert.equal(safeCallbackPath("https://evil.example", ORIGIN), "/");
});
