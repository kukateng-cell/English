"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { speakEnglish } from "@/lib/speech";
import { useLocale } from "@/components/LocaleProvider";

export interface QuizOption {
  id: string;
  text: string;
}

export interface QuizQuestion {
  word: {
    id: string;
    term: string;
    phonetic?: string | null;
    definition: string;
  };
  direction: "en-zh" | "zh-en";
  options: QuizOption[];
  correctId: string;
}

interface QuizCardProps {
  question: QuizQuestion;
  onAnswer: (correct: boolean) => void;
}

const cardMotion = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: 90, rotate: 6 },
  transition: { type: "spring" as const, stiffness: 320, damping: 26 },
};

export default function QuizCard({ question, onAnswer }: QuizCardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { tc } = useLocale();
  const answered = selectedId !== null;
  const isEnZh = question.direction === "en-zh";

  const speak = () => speakEnglish(question.word.term);

  const handlePick = (optId: string) => {
    if (answered) return;
    setSelectedId(optId);
    const correct = optId === question.correctId;
    setTimeout(() => onAnswer(correct), correct ? 700 : 1400);
  };

  const optionState = (optId: string): "correct" | "wrong" | "dim" | "idle" => {
    if (!answered) return "idle";
    if (optId === question.correctId) return "correct";
    if (optId === selectedId) return "wrong";
    return "dim";
  };

  return (
    <div className="mx-auto w-full max-w-md px-5">
      {/* 题干标签 */}
      <div className="mb-4 text-center">
        <span className="inline-block rounded-full bg-[#EEF4FF] px-4 py-1.5 text-[13px] font-medium text-[#2563EB] dark:bg-[#1E3A5F] dark:text-[#60A5FA]">
          {isEnZh ? tc("看英文，选中文") : tc("看中文，选英文")}
        </span>
      </div>

      {/* 题目卡片 */}
      <motion.div
        key={question.word.id + question.direction}
        {...cardMotion}
        className="mb-6 flex min-h-[160px] flex-col items-center justify-center rounded-[28px] border border-[#E7EDF8] bg-white p-6 shadow-[0_12px_30px_rgba(38,65,140,0.08)] dark:border-[#1E293B] dark:bg-[#111827] dark:shadow-[0_12px_30px_rgba(0,0,0,0.3)]"
      >
        {isEnZh ? (
          <>
            <h2
              className="mb-2 text-center text-[#17213C] dark:text-[#E2E8F0]"
              style={{ fontSize: "42px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.15 }}
            >
              {question.word.term}
            </h2>
            {question.word.phonetic && (
              <p className="mb-3 text-[15px] text-[#7C89A5] dark:text-[#64748B]">{question.word.phonetic}</p>
            )}
            <button
              onClick={speak}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EFF6FF] text-lg transition hover:bg-[#DBEAFE] active:scale-[0.95] dark:bg-[#1E3A5F] dark:hover:bg-[#1E40AF]/30"
              aria-label={tc("发音")}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            </button>
          </>
        ) : (
          <p className="text-center text-[26px] font-semibold leading-relaxed text-[#17213C] dark:text-[#E2E8F0]">
            {tc(question.word.definition)}
          </p>
        )}
      </motion.div>

      {/* 选项 */}
      <div className="flex flex-col gap-3">
        {question.options.map((opt, i) => {
          const st = optionState(opt.id);
          const isCorrect = st === "correct";
          const isWrong = st === "wrong";

          const label = String.fromCharCode(65 + i);

          // 动态样式
          let containerClass =
            "flex items-center gap-3 rounded-2xl border-2 px-5 py-4 text-left text-[15px] leading-snug transition-all duration-200";

          if (st === "idle") {
            containerClass +=
              " border-[#E7EDF8] bg-white text-[#17213C] hover:border-[#2563EB]/30 hover:bg-[#F8FAFF] active:scale-[0.98] dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#E2E8F0] dark:hover:border-[#1E3A5F] dark:hover:bg-[#1A2332]";
          } else if (isCorrect) {
            containerClass +=
              " border-[#22C55E] bg-[#ECFDF5] text-[#15803D] dark:border-[#22C55E] dark:bg-[#052E16] dark:text-[#4ADE80]";
          } else if (isWrong) {
            containerClass +=
              " border-[#EF6B6B] bg-[#FEF2F2] text-[#DC2626] dark:border-[#EF6B6B] dark:bg-[#2D0B0B] dark:text-[#F87171]";
          } else {
            containerClass +=
              " border-[#E7EDF8] bg-white opacity-40 dark:border-[#1E293B] dark:bg-[#111827]";
          }

          return (
            <motion.button
              key={opt.id + i}
              onClick={() => handlePick(opt.id)}
              disabled={answered}
              whileTap={{ scale: answered ? 1 : 0.97 }}
              className={containerClass}
            >
              {/* 圆形编号 */}
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  isCorrect
                    ? "bg-[#22C55E] text-white"
                    : isWrong
                      ? "bg-[#EF6B6B] text-white"
                      : "border border-[#D1D5DB] text-[#7C89A5] dark:border-[#475569] dark:text-[#64748B]"
                }`}
              >
                {label}
              </span>

              <span className="flex-1">{tc(opt.text)}</span>

              {/* 反馈图标 */}
              {answered && isCorrect && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="text-lg text-[#22C55E] dark:text-[#4ADE80]"
                >
                  ✓
                </motion.span>
              )}
              {answered && isWrong && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="text-lg text-[#EF6B6B] dark:text-[#F87171]"
                >
                  ✕
                </motion.span>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* 反馈提示 */}
      {answered && (
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-5 text-center text-[14px]"
        >
          {selectedId === question.correctId ? (
            <span className="font-medium text-[#22C55E] dark:text-[#4ADE80]">{tc("✓ 答对了！")}</span>
          ) : (
            <span className="font-medium text-[#EF6B6B] dark:text-[#F87171]">
              {tc("✕ 答错了，这个词稍后会再考你一次")}
            </span>
          )}
        </motion.p>
      )}
    </div>
  );
}
