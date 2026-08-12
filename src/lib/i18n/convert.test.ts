import test from "node:test";
import assert from "node:assert/strict";
import { convertForServer, convertText } from "./convert";

test("Traditional conversion preserves English, phonetic text, levels and category shape", () => {
  const source = "学习认识单词 A2 · 日常生活 / hello / /ˈhaɪ/";
  assert.equal(
    convertText(source, "zh-Hant"),
    "學習認識單詞 A2 · 日常生活 / hello / /ˈhaɪ/",
  );
  assert.equal(convertText(source, "zh-Hans"), source);
});

test("server conversion follows the locale cookie without changing non-Chinese data", () => {
  assert.equal(convertForServer("学习 A1 · Common Verbs", "locale=zh-Hant"), "學習 A1 · Common Verbs");
  assert.equal(convertForServer("学习 A1 · Common Verbs", "locale=zh-Hans"), "学习 A1 · Common Verbs");
  assert.equal(convertForServer("学习 A1 · Common Verbs", "locale=invalid"), "學習 A1 · Common Verbs");
});
