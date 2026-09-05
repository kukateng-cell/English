import type { Prisma } from "@/lib/prisma";
import { withCurrentCatalogWord } from "@/lib/catalog/runtime";
import { normalizeCatalogText } from "@/lib/catalog/csv";
import type { QuestionWord } from "./question";

/** Load all current answers sharing the bare prompt, not just unlocked words. */
export async function loadQuestionAnswerContext(
  db: Pick<Prisma.TransactionClient, "word" | "wordSense">,
  target: { term: string; definition: string; lemma?: string; senseId?: string | null },
): Promise<{ lemma: string; source: QuestionWord[] }> {
  const sense = target.senseId ? await db.wordSense.findUnique({
    where: { id: target.senseId }, select: { catalogEntry: { select: { normalizedLemma: true } } },
  }) : null;
  const lemma = target.lemma ?? sense?.catalogEntry.normalizedLemma ?? target.term;
  const words = await db.word.findMany({
    where: withCurrentCatalogWord({ OR: [
      { term: { equals: target.term, mode: "insensitive" } },
      { definition: target.definition },
      { sense: { normalizedTerm: normalizeCatalogText(target.term) } },
      { sense: { catalogEntry: { normalizedLemma: normalizeCatalogText(lemma) } } },
    ] }),
    include: { sense: { select: { catalogEntry: { select: { normalizedLemma: true } } } } },
  });
  return { lemma, source: words.map(word => ({
    id: word.id, senseId: word.senseId, term: word.term,
    lemma: word.sense?.catalogEntry.normalizedLemma ?? word.term,
    definition: word.definition, acceptedAnswers: word.acceptedAnswers,
    acceptedForms: word.acceptedForms, synonyms: word.synonyms,
  })) };
}
