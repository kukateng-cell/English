import assert from "node:assert/strict";
import test from "node:test";
import {
  buildObjectiveQuestion,
  toPublicObjectiveQuestion,
  type QuestionWord,
} from "@/lib/learning-policy/question";

const target: QuestionWord = {
  id: "word-target",
  term: "rapid",
  definition: "迅速的；快速的",
  synonyms: ["fast"],
  antonyms: ["slow"],
};

const source: QuestionWord[] = [
  target,
  { id: "word-1", term: "ancient", definition: "古代的；古老的" },
  { id: "word-2", term: "bright", definition: "明亮的；聰明的" },
  { id: "word-3", term: "quiet", definition: "安靜的" },
  { id: "word-4", term: "slow", definition: "緩慢的" },
  { id: "word-5", term: "fast", definition: "快速的" },
  { id: "word-6", term: "quick", definition: "迅速的；快速的" },
  { id: "word-7", term: "DVD", definition: "DVD" },
];

test("objective construction is deterministic and uses four opaque options", () => {
  const first = buildObjectiveQuestion(target, source, "stream-item-1");
  const second = buildObjectiveQuestion(target, source, "stream-item-1");

  assert.deepEqual(first, second);
  assert.ok(first);
  assert.equal(first.options.length, 4);
  assert.equal(first.options.filter((option) => option.id === first.correctOptionId).length, 1);
  assert.ok(first.options.every((option) => !option.id.includes("word-")));
  assert.notEqual(first.correctOptionId, target.id);
});

test("construction rejects synonym, duplicate-definition and non-quizzable distractors", () => {
  const snapshot = buildObjectiveQuestion(target, source, "stream-item-2");

  assert.ok(snapshot);
  const texts = snapshot.options.map((option) => option.text.toLocaleLowerCase("en-US"));
  assert.equal(new Set(texts).size, texts.length);
  assert.ok(!texts.includes("快速的；快速的"));
  assert.ok(!texts.includes("dvd"));
  assert.ok(!snapshot.options.some((option) => option.text === "slow" || option.text === "fast"));
});

test("construction fails closed when fewer than three valid distractors exist", () => {
  const snapshot = buildObjectiveQuestion(
    target,
    [target, { id: "only", term: "calm", definition: "平靜的" }],
    "stream-item-3",
  );

  assert.equal(snapshot, null);
});

test("public projection never exposes the answer key", () => {
  const snapshot = buildObjectiveQuestion(target, source, "stream-item-4");
  assert.ok(snapshot);

  const publicQuestion = toPublicObjectiveQuestion(snapshot);
  assert.equal("correctOptionId" in publicQuestion, false);
  assert.equal("wordTerm" in publicQuestion, false);
  assert.equal("wordDefinition" in publicQuestion, false);
  assert.deepEqual(publicQuestion.options, snapshot.options);
});

test("sense-level construction uses only the row's curated pool and enabled direction", () => {
  const sense: QuestionWord = {
    id: "run-a1",
    senseId: "sense-run-a1",
    term: "run",
    definition: "跑步",
    enableEnToZh: true,
    enableZhToEn: false,
    curatedDistractorsZh: ["行走", "跳躍", "游泳", "站立", "坐下", "經營"],
    curatedDistractorsEn: ["walk", "jump", "swim", "stand", "sit"],
  };
  const snapshot = buildObjectiveQuestion(sense, [sense, { id: "run-a2", senseId: "sense-run-a2", term: "run", definition: "經營" }], "sense-seed");
  assert.ok(snapshot);
  assert.equal(snapshot.direction, "en-zh");
  assert.ok(snapshot.options.every((option) => option.text === "跑步" || sense.curatedDistractorsZh?.includes(option.text)));
  assert.ok(!snapshot.options.some((option) => option.text === "經營"));
});

test("teacher preview can request an enabled direction without changing default construction", () => {
  const sense: QuestionWord = {
    id: "book-sense",
    senseId: "sense-book",
    term: "book",
    definition: "書本",
    enableEnToZh: true,
    enableZhToEn: true,
    curatedDistractorsZh: ["鉛筆", "桌子", "窗戶", "書包", "尺子"],
    curatedDistractorsEn: ["pen", "desk", "window", "bag", "ruler"],
  };
  const defaultQuestion = buildObjectiveQuestion(sense, [sense], "unchanged-default-seed");
  const englishToChinese = buildObjectiveQuestion(sense, [sense], "preview-seed", { direction: "en-zh" });
  const chineseToEnglish = buildObjectiveQuestion(sense, [sense], "preview-seed", { direction: "zh-en" });

  assert.ok(defaultQuestion);
  assert.ok(englishToChinese);
  assert.ok(chineseToEnglish);
  assert.equal(englishToChinese.direction, "en-zh");
  assert.equal(englishToChinese.prompt, "book");
  assert.equal(chineseToEnglish.direction, "zh-en");
  assert.equal(chineseToEnglish.prompt, "書本");
});

test("teacher preview fails closed when requesting a disabled direction", () => {
  const sense: QuestionWord = {
    id: "run-a1",
    senseId: "sense-run-a1",
    term: "run",
    definition: "跑步",
    enableEnToZh: true,
    enableZhToEn: false,
    curatedDistractorsZh: ["行走", "跳躍", "游泳", "站立", "坐下"],
    curatedDistractorsEn: ["walk", "jump", "swim", "stand", "sit"],
  };

  assert.equal(buildObjectiveQuestion(sense, [sense], "preview-seed", { direction: "zh-en" }), null);
});
