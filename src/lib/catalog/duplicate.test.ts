import assert from "node:assert/strict";
import test from "node:test";
import { catalogExactConflict, catalogSameSense } from "./duplicate";

const payload = {
  term: "Run",
  lemma: "run",
  partOfSpeech: "verb",
  definitionZh: "跑步",
};

test("catalogSameSense normalizes case and surrounding whitespace", () => {
  assert.equal(
    catalogSameSense(payload, {
      term: " RUN ",
      pos: " Verb ",
      definitionZh: " 跑步 ",
    }),
    true,
  );
});

test("catalogSameSense allows the same headword with a different sense", () => {
  assert.equal(
    catalogSameSense(payload, {
      lemma: "run",
      partOfSpeech: "verb",
      definitionZh: "經營",
    }),
    false,
  );
});

test("catalogSameSense rejects non-object candidates", () => {
  assert.equal(catalogSameSense(payload, null), false);
});

test("catalogExactConflict checks beyond a fifty-item display boundary", () => {
  const differentSenses = Array.from({ length: 50 }, (_, index) => ({
    lemma: "run",
    pos: "verb",
    definitionZh: `其他意思 ${index + 1}`,
  }));
  assert.equal(
    catalogExactConflict(
      payload,
      [...differentSenses, { lemma: "run", pos: "verb", definitionZh: "跑步" }],
      [],
    ),
    "EXISTING",
  );
});

test("catalogExactConflict finds a pending lemma variant without exposing it", () => {
  assert.equal(
    catalogExactConflict(payload, [], [
      {
        term: "ran",
        lemma: "run",
        partOfSpeech: "verb",
        definitionZh: "跑步",
      },
    ]),
    "PENDING",
  );
});
