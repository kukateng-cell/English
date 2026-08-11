import test from "node:test";
import assert from "node:assert/strict";
import { isSameOriginImageUrl } from "@/lib/image-policy";

test("same-origin image policy accepts app paths and configured origin", () => {
  assert.equal(isSameOriginImageUrl("/images/apple.webp"), true);
  assert.equal(isSameOriginImageUrl("https://english.example/images/apple.webp", "https://english.example"), true);
});

test("same-origin image policy rejects external, protocol-relative and unsafe paths", () => {
  assert.equal(isSameOriginImageUrl("https://cdn.example/apple.webp", "https://english.example"), false);
  assert.equal(isSameOriginImageUrl("//cdn.example/apple.webp", "https://english.example"), false);
  assert.equal(isSameOriginImageUrl("/\\cdn.example/apple.webp"), false);
  assert.equal(isSameOriginImageUrl("javascript:alert(1)", "https://english.example"), false);
});
