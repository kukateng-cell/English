"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  SPEECH_RATE_BOUNDS,
  SPEECH_RATE_EVENT,
  getSpeechRate,
  setSpeechRate,
  speakEnglish,
  stopSpeech,
} from "@/lib/speech";
import { useLocale } from "@/components/LocaleProvider";

const PRESETS = [
  { label: "慢", value: 0.6 },
  { label: "正常", value: 0.85 },
  { label: "稍快", value: 1.0 },
  { label: "快", value: 1.25 },
];

const PREVIEW_TEXT = "Hello! This is the playback speed.";

function formatRate(r: number): string {
  return `${r.toFixed(2).replace(/0$/, "").replace(/\.$/, "")}×`;
}

/**
 * 悬浮语速调节控件。
 * - 点击按钮展开滑杆 + 预设 + 试听；
 * - 设置持久化于 localStorage，所有朗读（认字卡 / 测试 / 助记面板）默认套用。
 */
export default function SpeechRateControl() {
  const { tc } = useLocale();
  const [rate, setRate] = useState<number>(getSpeechRate);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // 监听语速变化（其他实例 / 跨标签页）以同步显示
  useEffect(() => {
    const onCustom = (e: Event) =>
      setRate((e as CustomEvent).detail as number);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "english.speechRate") setRate(getSpeechRate());
    };
    window.addEventListener(SPEECH_RATE_EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SPEECH_RATE_EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        popoverRef.current?.contains(t) ||
        buttonRef.current?.contains(t)
      )
        return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const commit = (v: number) => {
    setRate(v);
    setSpeechRate(v);
  };

  const preview = () => {
    speakEnglish(PREVIEW_TEXT, { rate });
  };

  return (
    <div className="fixed right-4 top-4 z-40">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="调整朗读语速"
        className="flex items-center gap-1.5 rounded-full border border-zinc-200/70 bg-white/90 px-3 py-1.5 text-xs font-medium text-zinc-600 shadow-sm backdrop-blur transition hover:bg-white active:scale-95"
      >
        <span>🔊</span>
        <span>语速 {formatRate(rate)}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-64 rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-800">
                朗读语速
              </span>
              <span className="text-xs font-medium text-blue-600">
                {formatRate(rate)}
              </span>
            </div>

            {/* 滑杆 */}
            <input
              type="range"
              min={SPEECH_RATE_BOUNDS.min}
              max={SPEECH_RATE_BOUNDS.max}
              step={0.05}
              value={rate}
              onChange={(e) => commit(Number(e.target.value))}
              className="w-full accent-blue-600"
              aria-label="语速滑杆"
            />
            <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
              <span>慢</span>
              <span>快</span>
            </div>

            {/* 预设 */}
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              {PRESETS.map((p) => {
                const active = Math.abs(p.value - rate) < 0.001;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => commit(p.value)}
                    className={`rounded-lg border px-1 py-1.5 text-xs transition ${
                      active
                        ? "border-blue-500 bg-blue-50 text-blue-600"
                        : "border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                    }`}
                  >
                    {tc(p.label)}
                  </button>
                );
              })}
            </div>

            {/* 试听 */}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={preview}
                className="flex-1 rounded-lg bg-blue-600 py-2 text-xs font-medium text-white transition hover:bg-blue-700 active:scale-[0.98]"
              >
                ▶ 试听
              </button>
              <button
                type="button"
                onClick={stopSpeech}
                aria-label="停止朗读"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition hover:bg-zinc-50"
              >
                ■
              </button>
            </div>

            <p className="mt-2 text-center text-[10px] text-zinc-400">
              设置会自动保存，所有朗读都会套用
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
