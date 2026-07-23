"use client";

import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { speakEnglish } from "@/lib/speech";

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
  const speak = () => speakEnglish(word.term);

  const examples = Array.isArray(word.examples) ? word.examples : [];

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-3xl bg-white px-6 pb-10 pt-6 shadow-2xl dark:bg-zinc-900 dark:shadow-black/50"
        >
          {/* Handle bar */}
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-zinc-200 dark:bg-zinc-700" />

          <div className="flex items-center gap-3 mb-4">
            <h3 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{word.term}</h3>
            {word.phonetic && (
              <span className="text-sm text-zinc-400 dark:text-zinc-500">{word.phonetic}</span>
            )}
            <button
              onClick={speak}
              className="ml-auto flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-lg transition hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
            >
              🔊
            </button>
          </div>

          {/* 释义 */}
          <div className="mb-4">
            <p className="text-sm font-medium text-zinc-500 mb-1 dark:text-zinc-400">释义</p>
            <p className="text-lg text-zinc-900 dark:text-zinc-100">{word.definition}</p>
            {word.pos && (
              <span className="inline-block mt-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {word.pos}
              </span>
            )}
          </div>

          {/* 例句 */}
          {examples.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-medium text-zinc-500 mb-2 dark:text-zinc-400">例句</p>
              {examples.slice(0, 2).map((ex, i) => (
                <div key={i} className="mb-2 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800">
                  <p className="text-sm text-zinc-800 dark:text-zinc-200">{ex.en}</p>
                  <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{ex.zh}</p>
                </div>
              ))}
            </div>
          )}

          {/* 近义词 / 反义词 */}
          {(word.synonyms?.length || word.antonyms?.length) && (
            <div className="mb-4 flex gap-6">
              {word.synonyms && word.synonyms.length > 0 && (
                <div className="flex-1">
                  <p className="text-sm font-medium text-zinc-500 mb-1 dark:text-zinc-400">近义词</p>
                  <p className="text-sm text-green-600 dark:text-green-400">
                    {word.synonyms.join(" · ")}
                  </p>
                </div>
              )}
              {word.antonyms && word.antonyms.length > 0 && (
                <div className="flex-1">
                  <p className="text-sm font-medium text-zinc-500 mb-1 dark:text-zinc-400">反义词</p>
                  <p className="text-sm text-red-500 dark:text-red-400">
                    {word.antonyms.join(" · ")}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 图片 */}
          {word.imageUrl && (
            <div className="relative mb-4 h-40 overflow-hidden rounded-xl">
              <Image
                src={word.imageUrl}
                alt={word.term}
                fill
                className="object-cover"
              />
            </div>
          )}

          {/* 学完了按钮 */}
          <button
            onClick={onDismiss}
            className="mt-2 w-full rounded-xl bg-blue-600 py-3 font-medium text-white transition hover:bg-blue-700 active:scale-[0.98] dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            我学会了，下一个 →
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
