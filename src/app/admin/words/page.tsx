"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import WordFormModal, { type WordFormData } from "@/components/admin/WordFormModal";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import ErrorBanner from "@/components/ErrorBanner";
import { useLocale } from "@/components/LocaleProvider";
import Icon from "@/components/ui/Icon";
import { networkErrorMessage, responseErrorMessage } from "@/lib/api-error";
import { rosterFetch } from "@/lib/roster-client";

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

  // 彈窗狀態
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WordItem | null>(null);
  const [deleting, setDeleting] = useState<WordItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 删除失败的错误文案（在确认弹窗内展示，不静默失败）
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // 每次「打开」表单时自增，作为 Modal 的 key 强制 remount，让表单从最新 props 重新初始化。
  const [formKey, setFormKey] = useState(0);
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
        const res = await rosterFetch(`/api/admin/words/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          throw new Error(await responseErrorMessage(res, tc));
        }
        const updated: WordItem = await res.json();
        setWords((prev) => {
          const next = prev.map((w) => (w.id === updated.id ? { ...w, ...updated } : w));
          // 重新按字母序排列，因为 term 可能被改过
          next.sort((a, b) => a.term.localeCompare(b.term));
          return next;
        });
      } else {
        const res = await rosterFetch("/api/admin/words", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          throw new Error(await responseErrorMessage(res, tc));
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
    setDeleteError(null);
    try {
        const res = await rosterFetch(`/api/admin/words/${deleting.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(await responseErrorMessage(res, tc));
      }
      setWords((prev) => prev.filter((w) => w.id !== deleting.id));
      setDeleting(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "刪除失敗，請重試");
    } finally {
      setSubmitting(false);
    }
  };

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
        <button
          onClick={openCreate}
          className="flex h-10 items-center gap-1.5 rounded-2xl bg-[var(--primary)] px-4 text-[13px] font-semibold text-[var(--color-surface)] shadow-sm transition active:scale-[0.97]"
        >
          <Icon name="plus" size={16} />
          {tc("新增")}
        </button>
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
                {/* 操作按钮 */}
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => openEdit(word)}
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--border-soft)] hover:text-[var(--primary)] dark:text-[var(--muted)] dark:hover:bg-[var(--border-soft)] dark:hover:text-[var(--primary)]"
                    aria-label={tc("編輯")}
                  >
                    <Icon name="edit" size={16} />
                  </button>
                  <button
                    onClick={() => setDeleting(word)}
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] dark:text-[var(--muted)] dark:hover:bg-[var(--danger-bg)]"
                    aria-label={tc("刪除")}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
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
        title={tc("刪除單詞")}
        message={
          deleting
            ? tc(`確定刪除「${deleting.term}」嗎？關聯的學習記錄將一併刪除，且無法恢復。`)
            : ""
        }
        confirmText={tc("刪除")}
        destructive
        loading={submitting}
        error={deleteError}
        onConfirm={handleDelete}
        onClose={() => {
          setDeleteError(null);
          setDeleting(null);
        }}
      />
    </motion.div>
  );
}
