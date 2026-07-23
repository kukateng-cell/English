"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { speakEnglish } from "@/lib/speech";

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
  direction: "en-zh" | "zh-en"; // en-zh: 给英文选中文；zh-en: 给中文选英文
  options: QuizOption[];
  correctId: string;
}

interface QuizCardProps {
  question: QuizQuestion;
  onAnswer: (correct: boolean) => void;
}

export default function QuizCard({ question, onAnswer }: QuizCardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const answered = selectedId !== null;
  const isEnZh = question.direction === "en-zh";

  const speak = () => speakEnglish(question.word.term);

  const handlePick = (optId: string) => {
    if (answered) return;
    setSelectedId(optId);
    const correct = optId === question.correctId;
    // 答对快速过；答错多停一会让人看清正确答案
    setTimeout(() => onAnswer(correct), correct ? 700 : 1400);
  };

  const optionState = (optId: string): "correct" | "wrong" | "dim" | "idle" => {
    if (!answered) return "idle";
    if (optId === question.correctId) return "correct";
    if (optId === selectedId) return "wrong";
    return "dim";
  };

  const stateClasses: Record<string, string> = {
    correct: "border-green-500 bg-green-50 text-green-700",
    wrong: "border-red-500 bg-red-50 text-red-700",
    dim: "border-zinc-200 bg-white text-zinc-300",
    idle: "border-zinc-200 bg-white text-zinc-800 hover:border-blue-400 hover:bg-blue-50/40 active:scale-[0.98]",
  };

  return (
    <div className="mx-auto w-full max-w-md px-4">
      {/* 题干 */}
      <div className="mb-3 text-center">
        <span className="inline-block rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600">
          {isEnZh ? "🔤 看英文，选中文" : "🀄 看中文，选英文"}
        </span>
      </div>

      <motion.div
        key={question.word.id + question.direction}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-5 flex min-h-40 flex-col items-center justify-center rounded-3xl border border-zinc-200/60 bg-white p-6 shadow-lg shadow-zinc-200/50"
      >
        {isEnZh ? (
          <>
            <h2 className="mb-2 text-center text-4xl font-bold tracking-tight text-zinc-900">
              {question.word.term}
            </h2>
            {question.word.phonetic && (
              <p className="text-sm text-zinc-400">{question.word.phonetic}</p>
            )}
            <button
              onClick={speak}
              className="mt-2 text-xs text-blue-500 hover:text-blue-600"
            >
              🔊 发音
            </button>
          </>
        ) : (
          <p className="text-center text-2xl font-medium leading-relaxed text-zinc-900">
            {question.word.definition}
          </p>
        )}
      </motion.div>

      {/* 选项 */}
      <div className="grid grid-cols-1 gap-3">
        {question.options.map((opt, i) => {
          const st = optionState(opt.id);
          return (
            <motion.button
              key={opt.id + i}
              onClick={() => handlePick(opt.id)}
              disabled={answered}
              whileTap={{ scale: answered ? 1 : 0.97 }}
              className={`flex items-center gap-3 rounded-2xl border-2 px-5 py-4 text-left text-base transition ${stateClasses[st]}`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="flex-1">{opt.text}</span>
              {answered && st === "correct" && <span>✓</span>}
              {answered && st === "wrong" && <span>✕</span>}
            </motion.button>
          );
        })}
      </div>

      {/* 反馈提示 */}
      {answered && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 text-center text-sm"
        >
          {selectedId === question.correctId ? (
            <span className="text-green-600">答对了！</span>
          ) : (
            <span className="text-red-500">
              答错了，这个词稍后会再考你一次 ↻
            </span>
          )}
        </motion.p>
      )}
    </div>
  );
}
