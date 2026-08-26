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

test("Simplified conversion also normalizes Traditional source literals", () => {
  assert.equal(
    convertText("完整詞庫與詞庫治理工作區 · 等待審核", "zh-Hans"),
    "完整词库与词库治理工作区 · 等待审核",
  );
  assert.equal(convertText("完整词库与词库治理工作区", "zh-Hans"), "完整词库与词库治理工作区");
});

test("server conversion follows the locale cookie without changing non-Chinese data", () => {
  assert.equal(convertForServer("学习 A1 · Common Verbs", "locale=zh-Hant"), "學習 A1 · Common Verbs");
  assert.equal(convertForServer("学习 A1 · Common Verbs", "locale=zh-Hans"), "学习 A1 · Common Verbs");
  assert.equal(convertForServer("学习 A1 · Common Verbs", "locale=invalid"), "學習 A1 · Common Verbs");
});

test("catalog distractor terminology stays canonical after conversion", () => {
  for (const source of ["干擾項", "幹擾項", "干扰项", "幹扰項"]) {
    assert.equal(convertText(`英譯中${source}：需要修正`, "zh-Hant"), "英譯中干擾項：需要修正");
    assert.equal(convertText(`英譯中${source}：需要修正`, "zh-Hans"), "英译中干扰项：需要修正");
  }
  // OpenCC may use the Taiwan glyph「幹預」; the catalog-specific correction
  // must not rewrite unrelated occurrences of 干/幹.
  assert.equal(convertText("干預及干涉不應被任意替換", "zh-Hant"), "幹預及干涉不應被任意替換");
});
