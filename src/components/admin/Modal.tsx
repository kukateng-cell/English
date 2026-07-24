"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * 底部弹出的通用 Modal（移动端友好，适配管理后台的 420px 容器）。
 * 点击遮罩或按 Esc 关闭。
 */
export default function Modal({ open, onClose, title, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: "100%", opacity: 0.5 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0.5 }}
            transition={{ type: "spring", damping: 28, stiffness: 240 }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] w-full max-w-[480px] overflow-y-auto rounded-t-[28px] bg-white px-5 pb-8 pt-4 shadow-2xl sm:rounded-[28px] dark:bg-[#111827]"
          >
            {/* handle bar */}
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#E7EDF8] dark:bg-[#1E293B]" />
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-[18px] font-bold tracking-[-0.02em] text-[#17213C] dark:text-[#E2E8F0]">
                {title}
              </h2>
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#7C89A5] transition hover:bg-[#F1F5F9] dark:text-[#64748B] dark:hover:bg-[#1E293B]"
                aria-label="关闭"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
