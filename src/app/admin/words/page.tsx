"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import ErrorBanner from "@/components/ErrorBanner";
import { useLocale } from "@/components/LocaleProvider";
import Icon from "@/components/ui/Icon";
import { networkErrorMessage, responseErrorMessage } from "@/lib/api-error";

interface WordItem {
  id: string;
  term: string;
  phonetic: string | null;
  pos?: string | null;
  definition: string;
  level: string;
  category: string | null;
  synonyms?: string[];
  antonyms?: string[];
  reviewCount: number;
}

const levelColors: Record<string, string> = {
  A1: "bg-[var(--success-bg)] text-[var(--success)] dark:bg-[var(--success-bg)] dark:text-[var(--success)]",
  A2: "bg-[var(--border-soft)] text-[var(--primary)] dark:bg-[var(--border-soft)] dark:text-[var(--primary)]",
  B1: "bg-[var(--border-soft)] text-[var(--primary-2)] dark:bg-[var(--border-soft)] dark:text-[var(--primary-2)]",
  B2: "bg-[var(--border-soft)] text-[var(--primary)] dark:bg-[var(--border-soft)] dark:text-[var(--primary-2)]",
};

export default function AdminWordsPage() {
  const [words, setWords] = useState<WordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("ALL");
  const [visibleCount, setVisibleCount] = useState(100);

  const { tc } = useLocale();

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/words");
        if (!res.ok) {
          setError(await responseErrorMessage(res, tc));
          return;
        }
        setWords(await res.json());
      } catch (e) {
        setError(tc(networkErrorMessage(e)));
      } finally {
        setLoading(false);
      }
    })();
  }, [reloadKey, tc]);

  const filtered = words.filter((w) => {
    const matchSearch =
      w.term.toLowerCase().includes(search.toLowerCase()) ||
      w.definition.includes(search);
    const matchLevel = levelFilter === "ALL" || w.level === levelFilter;
    return matchSearch && matchLevel;
  });

  const levels = ["ALL", "A1", "A2", "B1", "B2"];
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorBanner
        message={error}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.03em] text-[var(--text)] dark:text-[var(--text)]">
            {tc("單詞庫")}
          </h1>
          <p className="mt-1 text-[14px] text-[var(--muted)] dark:text-[var(--muted)]">
            {tc(`共 ${words.length} 個單詞`)}
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--muted)]">
          {tc("CSV catalog 只讀投影")}
        </span>
      </div>

      {/* 搜尋＋篩選 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Icon name="search" size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="text"
            placeholder={tc("搜尋單詞…")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisibleCount(100);
            }}
            className="h-[44px] w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] pl-10 pr-4 text-[14px] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--primary)]/8 dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--text)] dark:placeholder:text-[var(--muted)]"
          />
        </div>
      </div>

      {/* 等級篩選 */}
      <div className="flex gap-2">
        {levels.map((lvl) => (
          <button
            key={lvl}
            onClick={() => {
              setLevelFilter(lvl);
              setVisibleCount(100);
            }}
            className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${
              levelFilter === lvl
                ? "bg-[var(--primary)] text-[var(--color-surface)] shadow-sm"
                : "border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--primary)]/30 dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--muted)]"
            }`}
          >
            {lvl === "ALL" ? tc("全部") : lvl}
          </button>
        ))}
      </div>

      {/* 单词列表 */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-[14px] text-[var(--muted)] dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--muted)]">
          {tc("暫無符合的單詞")}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.slice(0, visibleCount).map((word) => (
            <div
              key={word.id}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition hover:border-[var(--primary)]/20 dark:border-[var(--border)] dark:bg-[var(--surface)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-[18px] font-bold tracking-[-0.02em] text-[var(--text)] dark:text-[var(--text)]">
                      {word.term}
                    </h3>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${levelColors[word.level] || ""}`}>
                      {word.level}
                    </span>
                  </div>
                  {word.phonetic && (
                    <p className="text-[13px] text-[var(--muted)] dark:text-[var(--muted)] mb-1">
                      {word.phonetic}
                    </p>
                  )}
                  <p className="text-[14px] leading-relaxed text-[var(--text)] dark:text-[var(--text)] line-clamp-2">
                    {tc(word.definition)}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[var(--border-soft)] px-2 py-1 text-[11px] text-[var(--muted)]">
                  {tc("由 catalog workflow 管理")}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-3 text-[12px] text-[var(--muted)] dark:text-[var(--muted)]">
                {word.category && (
                  <span className="rounded-full bg-[var(--border-soft)] px-2 py-0.5 dark:bg-[var(--border-soft)]">
                    {tc(word.category)}
                  </span>
                )}
                <span className="admin-meta-item"><Icon name="repeat" size={14} /> {word.reviewCount} {tc("次被學習")}</span>
              </div>
            </div>
          ))}
          {visibleCount < filtered.length ? (
            <button
              type="button"
              onClick={() => setVisibleCount((count) => Math.min(count + 100, filtered.length))}
              className="flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[13px] font-semibold text-[var(--primary)] transition hover:bg-[var(--border-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--primary)] dark:hover:bg-[var(--border-soft)]"
            >
              {tc("載入更多")}
            </button>
          ) : null}
        </div>
      )}

    </motion.div>
  );
}
