"use client";

import Modal from "./Modal";
import { useLocale } from "@/components/LocaleProvider";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  loading?: boolean;
  /** 删除/提交失败时的错误文案（在弹窗内展示，不静默失败）。 */
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * 危险操作（删除）的二次确认弹窗。
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText,
  cancelText,
  destructive = false,
  loading = false,
  error = null,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const { tc } = useLocale();
  const confirm = confirmText ?? tc("确认");
  const cancel = cancelText ?? tc("取消");
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="mb-6 text-[14px] leading-relaxed text-[var(--muted)] dark:text-[var(--muted)]">
        {message}
      </p>
      {error && (
        <div className="mb-4 rounded-xl bg-[var(--danger-bg)] px-3 py-2.5 text-[13px] font-medium text-[var(--danger)] dark:bg-[var(--danger-bg)] dark:text-[var(--danger)]">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={onClose}
          disabled={loading}
          className="flex-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[14px] font-semibold text-[var(--muted)] transition hover:bg-[var(--border-soft)] disabled:opacity-50 dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--muted)] dark:hover:bg-[var(--border)]"
        >
          {cancel}
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={`flex-1 rounded-2xl px-4 py-3 text-[14px] font-semibold text-[var(--color-surface)] transition disabled:opacity-50 ${
            destructive
              ? "bg-[var(--danger)]"
              : "bg-[var(--primary)]"
          }`}
        >
          {loading ? tc("处理中...") : confirm}
        </button>
      </div>
    </Modal>
  );
}
