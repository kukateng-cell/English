import type { CatalogGovernancePayload } from "@/lib/catalog/governance";
import type { QuestionWord } from "@/lib/learning-policy/question";

export function catalogPayloadToQuestionWord(input: {
  id: string;
  senseId: string;
  payload: CatalogGovernancePayload;
}): QuestionWord {
  return {
    id: input.id,
    senseId: input.senseId,
    term: input.payload.term,
    lemma: input.payload.lemma,
    definition: input.payload.definitionZh,
    acceptedAnswers: input.payload.acceptedAnswersZh,
    acceptedForms: input.payload.acceptedFormsEn,
    curatedDistractorsEn: input.payload.distractorEn,
    curatedDistractorsZh: input.payload.distractorZh,
    enableEnToZh: input.payload.enableEnToZh,
    enableZhToEn: input.payload.enableZhToEn,
    phonetic: input.payload.phoneticIpa,
    synonyms: input.payload.synonymsEn,
    antonyms: input.payload.antonymsEn,
  };
}
