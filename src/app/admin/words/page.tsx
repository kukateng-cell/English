"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import WordFormModal, { type WordFormData } from "@/components/admin/WordFormModal";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import ErrorBanner from "@/components/ErrorBanner";
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
  A1: "bg-[#ECFDF5] text-[#15803D] dark:bg-[#052E16] dark:text-[#4ADE80]",
  A2: "bg-[#EEF4FF] text-[#2563EB] dark:bg-[#1E3A5F] dark:text-[#60A5FA]",
  B1: "bg-[#EEF0FF] text-[#4F46E5] dark:bg-[#1E1B4B] dark:text-[#A5B4FC]",
  B2: "bg-[#FDF4FF] text-[#9333EA] dark:bg-[#2A1245] dark:text-[#C084FC]",
};

export default function AdminWordsPage() {
  const [words, setWords] = useState<WordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("ALL");

  // 弹窗状态
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WordItem | null>(null);
  const [deleting, setDeleting] = useState<WordItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 每次「打开」表单时自增，作为 Modal 的 key 强制 remount，让表单从最新 props 重新初始化。
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/words");
        if (!res.ok) {
          setError(await responseErrorMessage(res));
          return;
        }
        setWords(await res.json());
      } catch (e) {
        setError(networkErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [reloadKey]);

  const filtered = words.filter((w) => {
    const matchSearch =
      w.term.toLowerCase().includes(search.toLowerCase()) ||
      w.definition.includes(search);
    const matchLevel = levelFilter === "ALL" || w.level === levelFilter;
    return matchSearch && matchLevel;
  });

  const openCreate = () => {
    setEditing(null);
    setFormKey((k) => k + 1);
    setFormOpen(true);
  };

  const openEdit = (word: WordItem) => {
    setEditing(word);
    setFormKey((k) => k + 1);
    setFormOpen(true);
  };

  const handleSubmit = async (data: WordFormData) => {
    setSubmitting(true);
    try {
      // 把逗号分隔的字符串切成数组发给后端
      const payload = {
        ...data,
        synonyms: data.synonyms
          ? data.synonyms.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        antonyms: data.antonyms
          ? data.antonyms.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
      };
      if (editing) {
        const res = await fetch(`/api/admin/words/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? "更新失败");
        }
        const updated: WordItem = await res.json();
        setWords((prev) => {
          const next = prev.map((w) => (w.id === updated.id ? { ...w, ...updated } : w));
          // 重新按字母序排列，因为 term 可能被改过
          next.sort((a, b) => a.term.localeCompare(b.term));
          return next;
        });
      } else {
        const res = await fetch("/api/admin/words", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? "创建失败");
        }
        const created: WordItem = await res.json();
        setWords((prev) => {
          const next = [...prev, created];
          next.sort((a, b) => a.term.localeCompare(b.term));
          return next;
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/words/${deleting.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "删除失败");
      }
      setWords((prev) => prev.filter((w) => w.id !== deleting.id));
      setDeleting(null);
    } finally {
      setSubmitting(false);
    }
  };

  const levels = ["ALL", "A1", "A2", "B1", "B2"];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
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
          <h1 className="text-[22px] font-bold tracking-[-0.03em] text-[#17213C] dark:text-[#E2E8F0]">
            单词库
          </h1>
          <p className="mt-1 text-[14px] text-[#7C89A5] dark:text-[#64748B]">
            共 {words.length} 个单词
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex h-10 items-center gap-1.5 rounded-2xl bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] px-4 text-[13px] font-semibold text-white shadow-sm transition hover:from-[#1D4ED8] hover:to-[#4F46E5] active:scale-[0.97]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          添加
        </button>
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
                {/* 操作按钮 */}
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => openEdit(word)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[#7C89A5] transition hover:bg-[#EEF4FF] hover:text-[#2563EB] dark:text-[#64748B] dark:hover:bg-[#1E3A5F] dark:hover:text-[#60A5FA]"
                    aria-label="编辑"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setDeleting(word)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[#7C89A5] transition hover:bg-red-50 hover:text-red-500 dark:text-[#64748B] dark:hover:bg-red-950/40"
                    aria-label="删除"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
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

      {/* 添加 / 编辑弹窗 */}
      <WordFormModal
        key={formKey}
        open={formOpen}
        word={editing}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
      />
      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleting}
        title="删除单词"
        message={
          deleting
            ? `确定删除「${deleting.term}」吗？关联的学习记录将一并删除，且无法恢复。`
            : ""
        }
        confirmText="删除"
        destructive
        loading={submitting}
        onConfirm={handleDelete}
        onClose={() => setDeleting(null)}
      />
    </motion.div>
  );
}
