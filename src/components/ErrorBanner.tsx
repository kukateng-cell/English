"use client";

import { useLocale } from "@/components/LocaleProvider";

interface ErrorBannerProps {
  message: string;
  /** 提供则显示「重试」按钮，点击后重新触发数据加载。 */
  onRetry?: () => void;
  retryLabel?: string;
}

/**
 * 数据加载失败的通用错误展示。
 *
 * 用于各页面顶层 fetch 出错（401/403/500/断网等）时替代空数据，
 * 配合 lib/api-error 的中文提示一起使用。
 */
export default function ErrorBanner({
  message,
  onRetry,
  retryLabel = "重试",
}: ErrorBannerProps) {
  const { tc } = useLocale();
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--danger-bg)] text-[var(--danger)] dark:bg-[var(--danger-bg)] dark:text-[var(--danger)]">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
      <p className="max-w-xs text-[14px] leading-relaxed text-[var(--muted)]">
        {tc(message)}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 flex h-10 items-center gap-1.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 text-[13px] font-semibold text-[var(--primary)] transition hover:bg-[var(--border-soft)] active:scale-[0.97]"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          {tc(retryLabel)}
        </button>
      )}
    </div>
  );
}
