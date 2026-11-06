"use client";

import WordCard from "@/components/WordCard";

const fixtures = [
  {
    id: "stress",
    term: "characteristically",
    level: "B2",
    category: null,
    phonetic: null,
  },
  {
    id: "localized",
    term: "internationalization",
    level: "A2",
    // 正式 taxonomy 代碼：學生端只會收到代碼，標籤由 student-category-label 轉成中文。
    category: "arts-culture-media",
    phonetic: null,
  },
] as const;

export default function FidelityFixture() {
  return (
    <main
      id="main-content"
      data-testid="word-card-fidelity-fixture"
      className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-8"
    >
      <h1 className="font-display text-2xl font-bold">WordCard fidelity fixture</h1>
      {fixtures.map((fixture) => (
        <section
          key={fixture.id}
          data-testid={`word-card-fixture-${fixture.id}`}
          className="min-w-0 rounded-[30px] border border-[var(--border)] bg-[var(--border-soft)] p-2"
        >
          <WordCard
            word={fixture}
            queueNote="fixture queue note"
            onSwipeLeft={() => undefined}
            onSwipeRight={() => undefined}
          />
        </section>
      ))}
    </main>
  );
}
