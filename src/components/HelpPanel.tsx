"use client";

import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";

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
  const speak = () => {
    const u = new SpeechSynthesisUtterance(word.term);
    u.lang = "en-US";
    u.rate = 0.8;
    speechSynthesis.speak(u);
  };

  const examples = Array.isArray(word.examples) ? word.examples : [];

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-3xl bg-white px-6 pb-10 pt-6 shadow-2xl"
        >
          {/* Handle bar */}
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-zinc-200" />

          <div className="flex items-center gap-3 mb-4">
            <h3 className="text-2xl font-bold text-zinc-900">{word.term}</h3>
            {word.phonetic && (
              <span className="text-sm text-zinc-400">{word.phonetic}</span>
            )}
            <button
              onClick={speak}
              className="ml-auto flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-lg transition hover:bg-blue-100"
            >
              🔊
            </button>
          </div>

          {/* 释义 */}
          <div className="mb-4">
            <p className="text-sm font-medium text-zinc-500 mb-1">释义</p>
            <p className="text-lg text-zinc-900">{word.definition}</p>
            {word.pos && (
              <span className="inline-block mt-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">
                {word.pos}
              </span>
            )}
          </div>

          {/* 例句 */}
          {examples.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-medium text-zinc-500 mb-2">例句</p>
              {examples.slice(0, 2).map((ex, i) => (
                <div key={i} className="mb-2 rounded-xl bg-zinc-50 p-3">
                  <p className="text-sm text-zinc-800">{ex.en}</p>
                  <p className="mt-1 text-xs text-zinc-400">{ex.zh}</p>
                </div>
              ))}
            </div>
          )}

          {/* 近义词 / 反义词 */}
          {(word.synonyms?.length || word.antonyms?.length) && (
            <div className="mb-4 flex gap-6">
              {word.synonyms && word.synonyms.length > 0 && (
                <div className="flex-1">
                  <p className="text-sm font-medium text-zinc-500 mb-1">近义词</p>
                  <p className="text-sm text-green-600">
                    {word.synonyms.join(" · ")}
                  </p>
                </div>
              )}
              {word.antonyms && word.antonyms.length > 0 && (
                <div className="flex-1">
                  <p className="text-sm font-medium text-zinc-500 mb-1">反义词</p>
                  <p className="text-sm text-red-500">
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
            className="mt-2 w-full rounded-xl bg-blue-600 py-3 font-medium text-white transition hover:bg-blue-700 active:scale-[0.98]"
          >
            我学会了，下一个 →
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
