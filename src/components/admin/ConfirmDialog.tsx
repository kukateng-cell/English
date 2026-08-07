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
      <p className="mb-6 text-[14px] leading-relaxed text-[#7C89A5] dark:text-[#64748B]">
        {message}
      </p>
      {error && (
        <div className="mb-4 rounded-xl bg-[#FEF2F2] px-3 py-2.5 text-[13px] font-medium text-[#EF6B6B] dark:bg-[#2D0B0B] dark:text-[#F87171]">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={onClose}
          disabled={loading}
          className="flex-1 rounded-2xl border border-[#E7EDF8] bg-white px-4 py-3 text-[14px] font-semibold text-[#7C89A5] transition hover:bg-[#F8FAFC] disabled:opacity-50 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#64748B] dark:hover:bg-[#1E293B]"
        >
          {cancel}
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={`flex-1 rounded-2xl px-4 py-3 text-[14px] font-semibold text-white transition disabled:opacity-50 ${
            destructive
              ? "bg-gradient-to-r from-[#EF4444] to-[#DC2626] hover:from-[#DC2626] hover:to-[#B91C1C]"
              : "bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] hover:from-[#1D4ED8] hover:to-[#4F46E5]"
          }`}
        >
          {loading ? tc("处理中...") : confirm}
        </button>
      </div>
    </Modal>
  );
}
