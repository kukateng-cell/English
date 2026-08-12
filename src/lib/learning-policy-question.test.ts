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
  assert.deepEqual(publicQuestion.options, snapshot.options);
});
