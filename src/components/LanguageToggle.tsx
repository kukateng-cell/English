"use client";

import { useState, useRef, useEffect } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { LOCALES, type Locale } from "@/lib/i18n/config";

/**
 * 语言切换按钮（繁体 / 简体）。固定在右下角，与主题切换按钮并列。
 *
 * 点击展开一个小选单，列出所有支持的语言；当前语言打勾。
 * 切换后即时生效（<html lang> 与所有 tc() 文案随之更新），并持久化到
 * localStorage + cookie，刷新或再次登入都保留。
 *
 * 挂载前渲染一个稳定占位按钮，避免 SSR（预设 zh-Hant）与客户端真实偏好
 * 之间的 hydration mismatch。
 */
const LOCALE_LABELS: Record<Locale, { short: string; full: string }> = {
  "zh-Hant": { short: "繁", full: "繁體中文" },
  "zh-Hans": { short: "简", full: "简体中文" },
};

export default function LanguageToggle() {
  const { locale, setLocale, mounted } = useLocale();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭选单
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // 挂载前渲染占位（与 ThemeToggle 一致的 hydration 策略）。
  if (!mounted) {
    return (
      <button
        aria-hidden="true"
        tabIndex={-1}
        className="fixed bottom-4 right-[4.5rem] z-40 h-11 w-11 rounded-full border border-zinc-200 bg-white/90 opacity-0 dark:border-zinc-700 dark:bg-zinc-800/90"
      />
    );
  }

  const currentLabel = LOCALE_LABELS[locale];

  return (
    <div ref={menuRef} className="fixed bottom-5 right-[4.5rem] z-40">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={currentLabel.full}
        title={currentLabel.full}
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#E7EDF8] bg-white/90 text-[13px] font-bold text-[#7C89A5] shadow-[0_4px_16px_rgba(38,65,140,0.06)] backdrop-blur transition hover:bg-white hover:text-[#17213C] active:scale-95 dark:border-[#1E293B] dark:bg-[#111827]/90 dark:text-[#64748B] dark:hover:bg-[#111827] dark:hover:text-[#E2E8F0]"
      >
        {currentLabel.short}
      </button>

      {open && (
        <div className="absolute bottom-14 right-0 w-36 overflow-hidden rounded-2xl border border-[#E7EDF8] bg-white shadow-[0_12px_40px_rgba(38,65,140,0.12)] dark:border-[#1E293B] dark:bg-[#111827]">
          {LOCALES.map((loc) => {
            const isActive = loc === locale;
            const label = LOCALE_LABELS[loc];
            return (
              <button
                key={loc}
                onClick={() => {
                  setLocale(loc);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-4 py-2.5 text-[14px] transition hover:bg-[#F8FAFF] dark:hover:bg-[#1A2332] ${
                  isActive
                    ? "font-semibold text-[#2563EB] dark:text-[#60A5FA]"
                    : "text-[#17213C] dark:text-[#E2E8F0]"
                }`}
              >
                {label.full}
                {isActive && (
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.1 3.1 6.8-6.8a1 1 0 011.4 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
