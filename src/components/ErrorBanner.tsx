"use client";

import { useLocale } from "@/components/LocaleProvider";
import Icon from "@/components/ui/Icon";

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
    <div role="alert" aria-live="assertive" className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--danger-bg)] text-[var(--danger)] dark:bg-[var(--danger-bg)] dark:text-[var(--danger)]">
        <Icon name="warning" size={26} />
      </div>
      <p className="max-w-xs text-[14px] leading-relaxed text-[var(--muted)]">
        {tc(message)}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 flex h-10 items-center gap-1.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 text-[13px] font-semibold text-[var(--primary)] transition hover:bg-[var(--border-soft)] active:scale-[0.97]"
        >
          <Icon name="refresh" size={14} />
          {tc(retryLabel)}
        </button>
      )}
    </div>
  );
}
