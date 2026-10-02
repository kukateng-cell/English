import test from "node:test";
import assert from "node:assert/strict";
import { convertForServer, convertText } from "./convert";

test("Traditional display preserves the canonical source verbatim", () => {
  const source = "學習認識單詞 A2 · 日常生活 / hello / /ˈhaɪ/";
  assert.equal(
    convertText(source, "zh-Hant"),
    "學習認識單詞 A2 · 日常生活 / hello / /ˈhaɪ/",
  );
  assert.equal(
    convertText("干預、乾燥、頭髮及發佈", "zh-Hant"),
    "干預、乾燥、頭髮及發佈",
  );
});

test("Simplified display is derived from the Traditional source", () => {
  assert.equal(
    convertText("完整詞庫與詞庫治理工作區 · 等待審核", "zh-Hans"),
    "完整词库与词库治理工作区 · 等待审核",
  );
  assert.equal(
    convertText("學習認識單詞 A2 · 日常生活", "zh-Hans"),
    "学习认识单词 A2 · 日常生活",
  );
});

test("server conversion follows the locale cookie without changing non-Chinese data", () => {
  assert.equal(convertForServer("學習 A1 · Common Verbs", "locale=zh-Hant"), "學習 A1 · Common Verbs");
  assert.equal(convertForServer("學習 A1 · Common Verbs", "locale=zh-Hans"), "学习 A1 · Common Verbs");
  assert.equal(convertForServer("學習 A1 · Common Verbs", "locale=invalid"), "學習 A1 · Common Verbs");
});

test("catalog distractor terminology stays canonical after conversion", () => {
  for (const source of ["干擾項", "乾擾項", "幹擾項", "干扰项", "幹扰項"]) {
    assert.equal(convertText(`英譯中${source}：需要修正`, "zh-Hant"), "英譯中干擾項：需要修正");
    assert.equal(convertText(`英譯中${source}：需要修正`, "zh-Hans"), "英译中干扰项：需要修正");
  }
  const preview = "使用正式學生出題器即時抽選三個安全干擾項；預覽不會建立學習紀錄或影響統計。";
  assert.equal(convertText(preview, "zh-Hant"), preview);
  assert.equal(
    convertText(preview, "zh-Hans"),
    "使用正式学生出题器即时抽选三个安全干扰项；预览不会建立学习纪录或影响统计。",
  );
});
