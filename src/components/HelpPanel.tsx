"use client";

import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { speakEnglish } from "@/lib/speech";
import { useLocale } from "@/components/LocaleProvider";

interface WordFull {
  term: string;
  phonetic?: string | null;
  pos?: string | null;
  definition: string;
  examples?: { en: string; zh: string }[] | null;
  synonyms?: string[];
  antonyms?: string[];
  imageUrl?: string | null;
}

interface HelpPanelProps {
  word: WordFull;
  visible: boolean;
  onDismiss: () => void;
}

export default function HelpPanel({ word, visible, onDismiss }: HelpPanelProps) {
  const { tc } = useLocale();
  const speak = () => speakEnglish(word.term);
  const examples = Array.isArray(word.examples) ? word.examples : [];
  // 过滤无意义的词性值（如 "0"、空、"null"、纯数字）
  const meaningfulPos =
    word.pos &&
    word.pos.trim().length > 0 &&
    !/^\d+$/.test(word.pos.trim()) &&
    word.pos.trim().toLowerCase() !== "null"
      ? word.pos
      : null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 26, stiffness: 220 }}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-[28px] bg-[#EEF4FF] px-5 pb-10 pt-5 shadow-[0_-8px_40px_rgba(38,65,140,0.1)] dark:bg-[#0F1D32] dark:shadow-[0_-8px_40px_rgba(0,0,0,0.4)]"
        >
          {/* Handle bar */}
          <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-[#BFCBE3] dark:bg-[#334155]" />

          {/* 单词 + 发音 */}
          <div className="mb-5 flex items-center gap-3">
            <div>
              <h3 className="text-[26px] font-bold leading-tight text-[#17213C] dark:text-[#E2E8F0]">
                {word.term}
              </h3>
              {word.phonetic && (
                <p className="mt-0.5 text-sm text-[#7C89A5] dark:text-[#64748B]">{word.phonetic}</p>
              )}
            </div>
            <button
              onClick={speak}
              className="ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#DBEAFE] text-lg transition hover:bg-[#BFDBFE] active:scale-[0.95] dark:bg-[#1E3A5F] dark:hover:bg-[#1E40AF]/40"
              aria-label={tc("发音")}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            </button>
          </div>

          {/* 释义 */}
          <div className="mb-5 rounded-2xl bg-white p-4 shadow-[0_2px_12px_rgba(38,65,140,0.04)] dark:bg-[#111827] dark:shadow-none">
            <p className="mb-1 text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">{tc("释义")}</p>
            <p className="text-[18px] font-medium leading-relaxed text-[#17213C] dark:text-[#E2E8F0]">
              {tc(word.definition)}
            </p>
            {meaningfulPos && (
              <span className="mt-2 inline-block rounded-full bg-[#EEF4FF] px-3 py-1 text-xs font-medium text-[#2563EB] dark:bg-[#1E3A5F] dark:text-[#60A5FA]">
                {tc(meaningfulPos)}
              </span>
            )}
          </div>

          {/* 例句 */}
          {examples.length > 0 && (
            <div className="mb-5">
              <p className="mb-3 text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">{tc("例句")}</p>
              {examples.slice(0, 2).map((ex, i) => (
                <div key={i} className="mb-3 rounded-2xl bg-white p-4 shadow-[0_2px_12px_rgba(38,65,140,0.04)] dark:bg-[#111827] dark:shadow-none">
                  <p className="text-[15px] leading-relaxed text-[#17213C] dark:text-[#E2E8F0]">{ex.en}</p>
                  <p className="mt-2 text-[14px] leading-relaxed text-[#7C89A5] dark:text-[#64748B]">{tc(ex.zh)}</p>
                </div>
              ))}
            </div>
          )}

          {/* 近义词 / 反义词 */}
          {(word.synonyms?.length || word.antonyms?.length) && (
            <div className="mb-5 flex gap-6">
              {word.synonyms && word.synonyms.length > 0 && (
                <div className="flex-1 rounded-2xl bg-white p-4 shadow-[0_2px_12px_rgba(38,65,140,0.04)] dark:bg-[#111827] dark:shadow-none">
                  <p className="mb-1 text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">{tc("近义词")}</p>
                  <p className="text-[14px] font-medium text-[#22C55E] dark:text-[#4ADE80]">
                    {word.synonyms.map((s) => tc(s)).join(" · ")}
                  </p>
                </div>
              )}
              {word.antonyms && word.antonyms.length > 0 && (
                <div className="flex-1 rounded-2xl bg-white p-4 shadow-[0_2px_12px_rgba(38,65,140,0.04)] dark:bg-[#111827] dark:shadow-none">
                  <p className="mb-1 text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">{tc("反义词")}</p>
                  <p className="text-[14px] font-medium text-[#EF6B6B] dark:text-[#F87171]">
                    {word.antonyms.map((s) => tc(s)).join(" · ")}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 图片 */}
          {word.imageUrl && (
            <div className="relative mb-5 h-44 overflow-hidden rounded-2xl">
              <Image
                src={word.imageUrl}
                alt={word.term}
                fill
                className="object-cover"
              />
            </div>
          )}

          {/* 学完了按钮：点击后进入「当前词」的测试，而非跳到下一个词 */}
          <button
            data-testid="help-panel-dismiss"
            onClick={onDismiss}
            className="mt-1 flex h-[44px] w-full items-center justify-center rounded-2xl bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] text-[15px] font-semibold text-white shadow-[0_8px_24px_rgba(37,99,235,0.18)] transition-all hover:shadow-[0_12px_30px_rgba(37,99,235,0.25)] active:scale-[0.98] dark:shadow-[0_8px_24px_rgba(37,99,235,0.1)]"
          >
            {tc("我学会了，下一个 →")}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
