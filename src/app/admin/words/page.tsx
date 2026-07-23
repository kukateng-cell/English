"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface WordItem {
  id: string;
  term: string;
  phonetic: string | null;
  definition: string;
  level: string;
  category: string | null;
  reviewCount: number;
}

const levelColors: Record<string, string> = {
  A1: "bg-[#ECFDF5] text-[#15803D] dark:bg-[#052E16] dark:text-[#4ADE80]",
  A2: "bg-[#EEF4FF] text-[#2563EB] dark:bg-[#1E3A5F] dark:text-[#60A5FA]",
  B1: "bg-[#EEF0FF] text-[#4F46E5] dark:bg-[#1E1B4B] dark:text-[#A5B4FC]",
};

export default function AdminWordsPage() {
  const [words, setWords] = useState<WordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("ALL");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/words");
        if (res.ok) setWords(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = words.filter((w) => {
    const matchSearch =
      w.term.toLowerCase().includes(search.toLowerCase()) ||
      w.definition.includes(search);
    const matchLevel = levelFilter === "ALL" || w.level === levelFilter;
    return matchSearch && matchLevel;
  });

  const levels = ["ALL", "A1", "A2", "B1"];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.03em] text-[#17213C] dark:text-[#E2E8F0]">
          单词库
        </h1>
        <p className="mt-1 text-[14px] text-[#7C89A5] dark:text-[#64748B]">
          共 {words.length} 个单词
        </p>
      </div>

      {/* 搜索 + 筛选 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <svg
            className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#BFCBE3]"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="搜索单词..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-[44px] w-full rounded-2xl border border-[#E7EDF8] bg-white pl-10 pr-4 text-[14px] outline-none transition placeholder:text-[#BFCBE3] focus:border-[#2563EB] focus:ring-[3px] focus:ring-[#2563EB]/8 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#E2E8F0] dark:placeholder:text-[#475569]"
          />
        </div>
      </div>

      {/* 等级筛选 */}
      <div className="flex gap-2">
        {levels.map((lvl) => (
          <button
            key={lvl}
            onClick={() => setLevelFilter(lvl)}
            className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${
              levelFilter === lvl
                ? "bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] text-white shadow-sm"
                : "border border-[#E7EDF8] bg-white text-[#7C89A5] hover:border-[#2563EB]/30 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#64748B]"
            }`}
          >
            {lvl === "ALL" ? "全部" : lvl}
          </button>
        ))}
      </div>

      {/* 单词列表 */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#E7EDF8] bg-white p-10 text-center text-[14px] text-[#7C89A5] dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#64748B]">
          暂无匹配的单词
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((word, i) => (
            <motion.div
              key={word.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
              className="rounded-2xl border border-[#E7EDF8] bg-white p-4 shadow-sm transition hover:border-[#2563EB]/20 dark:border-[#1E293B] dark:bg-[#111827]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-[18px] font-bold tracking-[-0.02em] text-[#17213C] dark:text-[#E2E8F0]">
                      {word.term}
                    </h3>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${levelColors[word.level] || ""}`}>
                      {word.level}
                    </span>
                  </div>
                  {word.phonetic && (
                    <p className="text-[13px] text-[#7C89A5] dark:text-[#64748B] mb-1">
                      {word.phonetic}
                    </p>
                  )}
                  <p className="text-[14px] leading-relaxed text-[#17213C] dark:text-[#E2E8F0] line-clamp-2">
                    {word.definition}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3 text-[12px] text-[#7C89A5] dark:text-[#64748B]">
                {word.category && (
                  <span className="rounded-full bg-[#EEF4FF] px-2 py-0.5 dark:bg-[#1E3A5F]">
                    {word.category}
                  </span>
                )}
                <span>📝 {word.reviewCount} 次被学习</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
