import { createHash } from "node:crypto";
import {
  OBJECTIVE_ITEM_CONSTRUCTION_VERSION,
} from "@/lib/learning-policy/types";

export type QuestionDirection = "en-zh" | "zh-en";

export interface QuestionWord {
  id: string;
  term: string;
  definition: string;
  senseId?: string | null;
  acceptedAnswers?: string[] | null;
  acceptedForms?: string[] | null;
  curatedDistractorsEn?: string[] | null;
  curatedDistractorsZh?: string[] | null;
  enableEnToZh?: boolean;
  enableZhToEn?: boolean;
  phonetic?: string | null;
  synonyms?: string[] | null;
  antonyms?: string[] | null;
}

export interface ObjectiveQuestionOption {
  id: string;
  text: string;
}

export interface ObjectiveQuestionSnapshotData {
  prompt: string;
  wordTerm: string;
  wordDefinition: string;
  direction: QuestionDirection;
  options: ObjectiveQuestionOption[];
  correctOptionId: string;
  itemConstructionVersion: typeof OBJECTIVE_ITEM_CONSTRUCTION_VERSION;
}

export interface PublicObjectiveQuestion {
  prompt: string;
  direction: QuestionDirection;
  options: ObjectiveQuestionOption[];
  itemConstructionVersion: typeof OBJECTIVE_ITEM_CONSTRUCTION_VERSION;
}

export interface ObjectiveQuestionBuildOptions {
  /** Teacher preview only. Production callers omit this to keep seeded choice. */
  direction?: QuestionDirection;
}

const OPTION_COUNT = 4;
const DISTRACTOR_COUNT = OPTION_COUNT - 1;

/** Keep question comparisons stable across harmless whitespace and Unicode variants. */
export function normalizeQuestionText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function hasCjk(value: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(value);
}

function normalizedSet(values: string[] | null | undefined): Set<string> {
  return new Set(
    (values ?? [])
      .map(normalizeQuestionText)
      .filter((value) => value.length > 0)
      .map((value) => value.toLocaleLowerCase("en-US")),
  );
}

function isQuizzable(word: QuestionWord): boolean {
  const term = normalizeQuestionText(word.term);
  const definition = normalizeQuestionText(word.definition);
  return (
    term.length > 0 &&
    definition.length > 0 &&
    term.toLocaleLowerCase("en-US") !== definition.toLocaleLowerCase("en-US") &&
    hasCjk(definition)
  );
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Deterministic, server-owned ordering. The seed is never exposed as an answer key. */
function order<T>(values: T[], seed: string, key: (value: T) => string): T[] {
  return [...values].sort((left, right) => {
    const leftDigest = digest(`${seed}\0${key(left)}`);
    const rightDigest = digest(`${seed}\0${key(right)}`);
    return leftDigest.localeCompare(rightDigest);
  });
}

function optionId(seed: string, candidateId: string, text: string): string {
  return `option_${digest(`${seed}\0${candidateId}\0${normalizeQuestionText(text)}`).slice(0, 24)}`;
}

function sameText(left: string, right: string): boolean {
  return normalizeQuestionText(left).toLocaleLowerCase("en-US") ===
    normalizeQuestionText(right).toLocaleLowerCase("en-US");
}

function directionAnswerSet(word: QuestionWord, direction: QuestionDirection): Set<string> {
  const answer = direction === "en-zh" ? word.definition : word.term;
  const accepted = direction === "en-zh" ? word.acceptedAnswers : word.acceptedForms;
  return new Set([answer, ...(accepted ?? [])].map((value) => normalizeQuestionText(value).toLocaleLowerCase("en-US")));
}

function isCuratedWord(word: QuestionWord): boolean {
  return word.senseId !== undefined && word.senseId !== null;
}

function allowedDirections(word: QuestionWord): QuestionDirection[] {
  if (!isCuratedWord(word)) return ["en-zh", "zh-en"];
  return [
    ...(word.enableEnToZh ? ["en-zh" as const] : []),
    ...(word.enableZhToEn ? ["zh-en" as const] : []),
  ];
}

function curatedCandidates(word: QuestionWord, direction: QuestionDirection): string[] {
  return (direction === "en-zh" ? word.curatedDistractorsZh : word.curatedDistractorsEn) ?? [];
}

/**
 * Construct the immutable server-side question snapshot. Returning null is
 * intentional: an invalid or under-populated question must not become a live
 * probe with a guessed answer or a weak distractor set.
 */
export function buildObjectiveQuestion(
  word: QuestionWord,
  source: readonly QuestionWord[],
  seed: string,
  buildOptions: ObjectiveQuestionBuildOptions = {},
): ObjectiveQuestionSnapshotData | null {
  if (!isQuizzable(word) || seed.trim().length === 0) return null;

  const directions = allowedDirections(word);
  if (directions.length === 0) return null;
  if (buildOptions.direction && !directions.includes(buildOptions.direction)) return null;
  const direction = buildOptions.direction
    ?? directions[digest(`${seed}\0direction`).charCodeAt(0) % directions.length]!;
  const answerText = direction === "en-zh" ? word.definition : word.term;
  const targetTerm = normalizeQuestionText(word.term);
  const targetDefinition = normalizeQuestionText(word.definition);
  const answerKey = normalizeQuestionText(answerText).toLocaleLowerCase("en-US");
  const targetAnswers = directionAnswerSet(word, direction);
  const targetSynonyms = normalizedSet(word.synonyms);
  const candidates = isCuratedWord(word)
    ? curatedCandidates(word, direction).map((text, index) => ({
        id: `${word.senseId}:${direction}:${index}`,
        term: direction === "zh-en" ? text : `curated-${index}`,
        definition: direction === "en-zh" ? text : `curated-${index}`,
      } satisfies QuestionWord))
    : source.filter((candidate) => {
        if (!isQuizzable(candidate) || candidate.id === word.id) return false;
        const candidateTerm = normalizeQuestionText(candidate.term);
        const candidateDefinition = normalizeQuestionText(candidate.definition);
        const candidateText = direction === "en-zh" ? candidateDefinition : candidateTerm;
        if (normalizeQuestionText(candidateText).toLocaleLowerCase("en-US") === answerKey) return false;
        if (direction === "en-zh") {
          if (!hasCjk(candidateDefinition) || sameText(candidateTerm, targetTerm)) return false;
        } else {
          if (hasCjk(candidateTerm) || sameText(candidateDefinition, targetDefinition)) return false;
          const candidateTermKey = candidateTerm.toLocaleLowerCase("en-US");
          if (targetSynonyms.has(candidateTermKey)) return false;
          const candidateSynonyms = normalizedSet(candidate.synonyms);
          if (candidateSynonyms.has(targetTerm.toLocaleLowerCase("en-US"))) return false;
        }
        return true;
      });

  const uniqueCandidates = new Map<string, QuestionWord>();
  for (const candidate of order(candidates, `${seed}\0candidates`, (item) => item.id)) {
    const text = direction === "en-zh" ? candidate.definition : candidate.term;
    const key = normalizeQuestionText(text).toLocaleLowerCase("en-US");
    if (targetAnswers.has(key)) continue;
    if (direction === "zh-en" && targetSynonyms.has(key)) continue;
    if (!uniqueCandidates.has(key)) uniqueCandidates.set(key, candidate);
  }

  const distractors = [...uniqueCandidates.values()]
    .slice(0, DISTRACTOR_COUNT)
    .map((candidate) => {
      const text = direction === "en-zh" ? candidate.definition : candidate.term;
      return {
        id: optionId(seed, candidate.id, text),
        text: normalizeQuestionText(text),
      } satisfies ObjectiveQuestionOption;
    });

  if (distractors.length !== DISTRACTOR_COUNT) return null;

  const correctOption: ObjectiveQuestionOption = {
    id: optionId(seed, word.id, answerText),
    text: normalizeQuestionText(answerText),
  };
  const options = order(
    [correctOption, ...distractors],
    `${seed}\0options`,
    (option) => option.id,
  );

  return {
    prompt: normalizeQuestionText(direction === "en-zh" ? targetTerm : targetDefinition),
    wordTerm: targetTerm,
    wordDefinition: targetDefinition,
    direction,
    options,
    correctOptionId: correctOption.id,
    itemConstructionVersion: OBJECTIVE_ITEM_CONSTRUCTION_VERSION,
  };
}

/** Strip the server-only answer key before an item crosses the API boundary. */
export function toPublicObjectiveQuestion(
  snapshot: ObjectiveQuestionSnapshotData,
): PublicObjectiveQuestion {
  return {
    prompt: snapshot.prompt,
    direction: snapshot.direction,
    options: snapshot.options.map((option) => ({ ...option })),
    itemConstructionVersion: snapshot.itemConstructionVersion,
  };
}
