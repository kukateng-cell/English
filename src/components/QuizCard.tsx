"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { speakEnglish } from "@/lib/speech";
import { useLocale } from "@/components/LocaleProvider";
import Icon from "@/components/ui/Icon";

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
    level?: string;
    category?: string | null;
  };
  direction: "en-zh" | "zh-en";
  options: QuizOption[];
  correctId: string;
}

interface QuizCardProps {
  question: QuizQuestion;
  onAnswer: (correct: boolean, interactionEpoch: number) => void;
  disabled?: boolean;
  interactionEpoch?: number;
}

const cardMotion = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: 90, rotate: 6 },
  transition: { type: "spring" as const, stiffness: 320, damping: 26 },
};

export default function QuizCard({
  question,
  onAnswer,
  disabled = false,
  interactionEpoch = 0,
}: QuizCardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const answerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { tc } = useLocale();
  const answered = selectedId !== null;
  const isEnZh = question.direction === "en-zh";

  const speak = () => speakEnglish(question.word.term);

  useEffect(() => {
    if (disabled && answerTimerRef.current) {
      clearTimeout(answerTimerRef.current);
      answerTimerRef.current = null;
    }
    return () => {
      if (answerTimerRef.current) {
        clearTimeout(answerTimerRef.current);
        answerTimerRef.current = null;
      }
    };
  }, [disabled, interactionEpoch, question.word.id, question.direction]);

  const handlePick = (optId: string) => {
    if (answered || disabled) return;
    setSelectedId(optId);
    const correct = optId === question.correctId;
    const answerEpoch = interactionEpoch;
    answerTimerRef.current = setTimeout(() => {
      answerTimerRef.current = null;
      onAnswer(correct, answerEpoch);
    }, correct ? 700 : 1400);
  };

  const optionState = (optId: string): "correct" | "wrong" | "dim" | "idle" => {
    if (!answered) return "idle";
    if (optId === question.correctId) return "correct";
    if (optId === selectedId) return "wrong";
    return "dim";
  };

  return (
    <div className="study-stream-probe mx-auto w-full px-5">
      <div className="quiz-intro">
        <div className="quiz-intro-copy">
          <span className="quiz-eyebrow">{tc("认字小测")}</span>
          <h2>{tc("把意思配回单词")}</h2>
          <p>{tc("确认你真的认得它，再继续下一张。")}</p>
        </div>
      </div>

      <motion.div
        key={question.word.id + question.direction}
        {...cardMotion}
        className="quiz-card-surface quiz-card-layout"
      >
        <div className="quiz-prompt-meta">
          <span className="quiz-prompt-label">{tc(isEnZh ? "看英文" : "看中文")}</span>
          {question.word.level ? (
            <span className="level-badge">
              {question.word.level} · {tc(question.word.category ?? "未分类")}
            </span>
          ) : null}
        </div>
        {isEnZh ? (
          <>
            <h2 className="quiz-card-term quiz-probe-prompt">{question.word.term}</h2>
            {question.word.phonetic && <p className="quiz-card-phonetic">{question.word.phonetic}</p>}
            <button onClick={speak} className="quiz-card-speak" aria-label={tc("发音")}>
              <Icon name="volume" size={18} />
              <span>{tc("发音")}</span>
            </button>
            <p className="quiz-instruction">{tc("选出它的中文意思")}</p>
          </>
        ) : (
          <>
            <p className="quiz-card-term quiz-probe-prompt is-definition">{tc(question.word.definition)}</p>
            <p className="quiz-instruction">{tc("选出最贴近的英文解释")}</p>
          </>
        )}
      </motion.div>

      <div className="quiz-options">
        {question.options.map((opt, i) => {
          const st = optionState(opt.id);
          const isCorrect = st === "correct";
          const isWrong = st === "wrong";

          const label = String.fromCharCode(65 + i);

          let containerClass = "quiz-option";
          if (isCorrect) {
            containerClass += " quiz-option-correct";
          } else if (isWrong) {
            containerClass += " quiz-option-wrong";
          } else if (st === "dim") {
            containerClass += " quiz-option-dim";
          }

          return (
            <motion.button
              key={opt.id + i}
              data-testid="quiz-option"
              data-option-id={opt.id}
              aria-pressed={selectedId === opt.id}
              onClick={() => handlePick(opt.id)}
              disabled={answered || disabled}
              whileTap={{ scale: answered || disabled ? 1 : 0.97 }}
              className={containerClass}
            >
              {/* 圆形编号 */}
              <span
                className={`quiz-option-index rounded-full text-xs font-bold ${
                  isCorrect
                    ? "quiz-option-index-correct"
                    : isWrong
                      ? "quiz-option-index-wrong"
                      : ""
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
                  className="quiz-feedback-correct text-lg"
                >
                  ✓
                </motion.span>
              )}
              {answered && isWrong && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="quiz-feedback-wrong text-lg"
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
            <span className="quiz-feedback-correct font-medium">{tc("✓ 答对了！")}</span>
          ) : (
            <span className="quiz-feedback-wrong font-medium">
              {tc("✕ 答错了，再试一次吧")}
            </span>
          )}
        </motion.p>
      )}
    </div>
  );
}
