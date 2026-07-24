"use client";

import { useState } from "react";
import Modal from "./Modal";

export interface WordFormData {
  term: string;
  phonetic: string;
  pos: string;
  definition: string;
  level: "A1" | "A2" | "B1";
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
];

const inputClass =
  "h-[44px] w-full rounded-2xl border border-[#E7EDF8] bg-white px-4 text-[14px] text-[#17213C] outline-none transition placeholder:text-[#BFCBE3] focus:border-[#2563EB] focus:ring-[3px] focus:ring-[#2563EB]/8 dark:border-[#1E293B] dark:bg-[#0B1220] dark:text-[#E2E8F0] dark:placeholder:text-[#475569] dark:focus:border-[#60A5FA]";

const textareaClass =
  "w-full rounded-2xl border border-[#E7EDF8] bg-white px-4 py-3 text-[14px] leading-relaxed text-[#17213C] outline-none transition placeholder:text-[#BFCBE3] focus:border-[#2563EB] focus:ring-[3px] focus:ring-[#2563EB]/8 dark:border-[#1E293B] dark:bg-[#0B1220] dark:text-[#E2E8F0] dark:placeholder:text-[#475569] dark:focus:border-[#60A5FA]";

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
      title={isEdit ? "编辑单词" : "添加单词"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
            单词 *
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
            <label className="mb-1.5 block text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
              音标
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
            <label className="mb-1.5 block text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
              词性
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
          <label className="mb-1.5 block text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
            释义 *
          </label>
          <textarea
            value={form.definition}
            onChange={(e) => set("definition", e.target.value)}
            placeholder="中文释义"
            rows={2}
            className={textareaClass}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
            级别
          </label>
          <div className="flex gap-2">
            {LEVEL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => set("level", opt.value)}
                className={`flex-1 rounded-2xl px-3 py-2.5 text-[13px] font-semibold transition ${
                  form.level === opt.value
                    ? "bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] text-white shadow-sm"
                    : "border border-[#E7EDF8] bg-white text-[#7C89A5] hover:border-[#2563EB]/30 dark:border-[#1E293B] dark:bg-[#0B1220] dark:text-[#64748B]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
            分类（主题）
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
            <label className="mb-1.5 block text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
              近义词
            </label>
            <input
              type="text"
              value={form.synonyms}
              onChange={(e) => set("synonyms", e.target.value)}
              placeholder="逗号分隔"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
              反义词
            </label>
            <input
              type="text"
              value={form.antonyms}
              onChange={(e) => set("antonyms", e.target.value)}
              placeholder="逗号分隔"
              className={inputClass}
            />
          </div>
        </div>

        {error && (
          <div className="rounded-2xl bg-red-50 px-4 py-2.5 text-[13px] text-red-600 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition hover:from-[#1D4ED8] hover:to-[#4F46E5] disabled:opacity-50"
        >
          {loading ? "保存中..." : isEdit ? "保存修改" : "添加单词"}
        </button>
      </form>
    </Modal>
  );
}
