"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useLocale } from "@/components/LocaleProvider";

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
  const { tc } = useLocale();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      );
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
      (first ?? dialogRef.current)?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="ui-modal-backdrop fixed inset-0 z-50 flex items-end justify-center backdrop-blur-sm sm:items-center"
          onClick={onClose}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ y: "100%", opacity: 0.5 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0.5 }}
            transition={{ type: "spring", damping: 28, stiffness: 240 }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] w-full max-w-[480px] overflow-y-auto rounded-t-[28px] bg-[var(--surface)] px-5 pb-8 pt-4 shadow-2xl sm:rounded-[28px] dark:bg-[var(--surface)]"
          >
            {/* handle bar */}
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--border)] dark:bg-[var(--border)]" />
            <div className="mb-5 flex items-center justify-between">
              <h2
                id={titleId}
                className="text-[18px] font-bold tracking-[-0.02em] text-[var(--text)] dark:text-[var(--text)]"
              >
                {title}
              </h2>
              <button
                onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--muted)] transition hover:bg-[var(--border-soft)] dark:text-[var(--muted)] dark:hover:bg-[var(--border)]"
                aria-label={tc("关闭")}
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
