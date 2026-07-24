"use client";

import Modal from "./Modal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  loading?: boolean;
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
  confirmText = "确认",
  cancelText = "取消",
  destructive = false,
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="mb-6 text-[14px] leading-relaxed text-[#7C89A5] dark:text-[#64748B]">
        {message}
      </p>
      <div className="flex gap-2">
        <button
          onClick={onClose}
          disabled={loading}
          className="flex-1 rounded-2xl border border-[#E7EDF8] bg-white px-4 py-3 text-[14px] font-semibold text-[#7C89A5] transition hover:bg-[#F8FAFC] disabled:opacity-50 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#64748B] dark:hover:bg-[#1E293B]"
        >
          {cancelText}
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
          {loading ? "处理中..." : confirmText}
        </button>
      </div>
    </Modal>
  );
}
