"use client";

import { useTheme } from "@/components/ThemeProvider";

/**
 * 浅色 / 深色切换按钮。固定在右下角作为浮动按钮，
 * 全站可见。点击即切换主题。
 */
export default function ThemeToggle() {
  const { theme, toggleTheme, mounted } = useTheme();
  const isDark = theme === "dark";

  // 挂载前渲染一个稳定的占位按钮，避免 SSR（默认 light）与客户端真实偏好
  // 之间的 hydration mismatch。实际的 .dark 类已由 layout 的内联脚本应用，
  // 因此页面背景此刻已正确，只有这个图标需要等挂载后再显示。
  if (!mounted) {
    return (
      <button
        aria-hidden="true"
        tabIndex={-1}
        className="fixed bottom-4 right-4 z-40 h-11 w-11 rounded-full border border-zinc-200 bg-white/90 opacity-0 dark:border-zinc-700 dark:bg-zinc-800/90"
      />
    );
  }

  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? "切换到浅色模式" : "切换到深色模式"}
      title={isDark ? "切换到浅色模式" : "切换到深色模式"}
      className="fixed bottom-5 right-5 z-40 flex h-11 w-11 items-center justify-center rounded-2xl border border-[#E7EDF8] bg-white/90 text-[#7C89A5] shadow-[0_4px_16px_rgba(38,65,140,0.06)] backdrop-blur transition hover:bg-white hover:text-[#17213C] active:scale-95 dark:border-[#1E293B] dark:bg-[#111827]/90 dark:text-[#64748B] dark:hover:bg-[#111827] dark:hover:text-[#E2E8F0]"
    >
      {isDark ? (
        // 深色模式下显示「太阳」，提示可切换到浅色
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        // 浅色模式下显示「月亮」，提示可切换到深色
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
