"use client";

import { useState } from "react";
import Modal from "./Modal";
import { useLocale } from "@/components/LocaleProvider";

export interface WordFormData {
  term: string;
  phonetic: string;
  pos: string;
  definition: string;
  level: "A1" | "A2" | "B1" | "B2";
  category: string;
  synonyms: string;
  antonyms: string;
}

interface WordFormModalProps {
  open: boolean;
  /** 传入则编辑模式；否则新建模式。 */
  word?: {
    id: string;
    term: string;
    phonetic: string | null;
    pos?: string | null;
    definition: string;
    level: string;
    category: string | null;
    synonyms?: string[];
    antonyms?: string[];
  } | null;
  onClose: () => void;
  onSubmit: (data: WordFormData) => Promise<void>;
}

const LEVEL_OPTIONS: { value: WordFormData["level"]; label: string }[] = [
  { value: "A1", label: "A1" },
  { value: "A2", label: "A2" },
  { value: "B1", label: "B1" },
  { value: "B2", label: "B2" },
];

const inputClass =
  "h-[44px] w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 text-[14px] text-[var(--text)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--primary)]/8 dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--text)] dark:placeholder:text-[var(--muted)] dark:focus:border-[var(--primary)]";

const textareaClass =
  "w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[14px] leading-relaxed text-[var(--text)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--primary)]/8 dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--text)] dark:placeholder:text-[var(--muted)] dark:focus:border-[var(--primary)]";

const EMPTY: WordFormData = {
  term: "",
  phonetic: "",
  pos: "",
  definition: "",
  level: "A1",
  category: "",
  synonyms: "",
  antonyms: "",
};

export default function WordFormModal({
  open,
  word,
  onClose,
  onSubmit,
}: WordFormModalProps) {
  const isEdit = !!word;
  // lazy initializer 从 props 取初值；父组件通过 key 在每次打开时强制 remount，
  // 避免 effect 内 setState（react-hooks/set-state-in-effect）。
  const [form, setForm] = useState<WordFormData>(
    word
      ? {
          term: word.term,
          phonetic: word.phonetic ?? "",
          pos: word.pos ?? "",
          definition: word.definition,
          level: (word.level as WordFormData["level"]) || "A1",
          category: word.category ?? "",
          synonyms: (word.synonyms ?? []).join(", "),
          antonyms: (word.antonyms ?? []).join(", "),
        }
      : EMPTY
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { tc } = useLocale();

  const set = (key: keyof WordFormData, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!form.term.trim()) {
      setError("单词不能为空");
      return;
    }
    if (!form.definition.trim()) {
      setError("释义不能为空");
      return;
    }

    setLoading(true);
    try {
      await onSubmit({ ...form, term: form.term.trim(), definition: form.definition.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? tc("编辑单词") : tc("添加单词")}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">
            {tc("单词")} *
          </label>
          <input
            type="text"
            value={form.term}
            onChange={(e) => set("term", e.target.value)}
            placeholder="如 apple"
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">
              {tc("音标")}
            </label>
            <input
              type="text"
              value={form.phonetic}
              onChange={(e) => set("phonetic", e.target.value)}
              placeholder="/ˈæp.əl/"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">
              {tc("词性")}
            </label>
            <input
              type="text"
              value={form.pos}
              onChange={(e) => set("pos", e.target.value)}
              placeholder="n. / v."
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">
            {tc("释义")} *
          </label>
          <textarea
            value={form.definition}
            onChange={(e) => set("definition", e.target.value)}
            placeholder={tc("中文释义")}
            rows={2}
            className={textareaClass}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">
            {tc("级别")}
          </label>
          <div className="flex gap-2">
            {LEVEL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => set("level", opt.value)}
                className={`flex-1 rounded-2xl px-3 py-2.5 text-[13px] font-semibold transition ${
                  form.level === opt.value
                    ? "bg-[var(--primary)] text-[var(--color-surface)] shadow-sm"
                    : "border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--primary)]/30 dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--muted)]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">
            {tc("分类（主题）")}
          </label>
          <input
            type="text"
            value={form.category}
            onChange={(e) => set("category", e.target.value)}
            placeholder="如 Food / Colors"
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">
              {tc("近义词")}
            </label>
            <input
              type="text"
              value={form.synonyms}
              onChange={(e) => set("synonyms", e.target.value)}
              placeholder={tc("逗号分隔")}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">
              {tc("反义词")}
            </label>
            <input
              type="text"
              value={form.antonyms}
              onChange={(e) => set("antonyms", e.target.value)}
              placeholder={tc("逗号分隔")}
              className={inputClass}
            />
          </div>
        </div>

        {error && (
          <div className="rounded-2xl bg-[var(--danger-bg)] px-4 py-2.5 text-[13px] text-[var(--danger)] dark:bg-[var(--danger-bg)] dark:text-[var(--danger)]">
            {tc(error)}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl bg-[var(--primary)] px-4 py-3 text-[15px] font-semibold text-[var(--color-surface)] shadow-sm transition disabled:opacity-50"
        >
          {loading ? tc("保存中...") : isEdit ? tc("保存修改") : tc("添加单词")}
        </button>
      </form>
    </Modal>
  );
}
