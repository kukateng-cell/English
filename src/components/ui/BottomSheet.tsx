"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { useLocale } from "@/components/LocaleProvider";
import Icon from "./Icon";

const FOCUSABLE = "a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex='-1'])";

export default function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  returnFocusRef,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  returnFocusRef?: RefObject<HTMLElement | null>;
  labelledBy?: string;
}) {
  const { tc } = useLocale();
  const titleId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const resolvedTitleId = labelledBy ?? titleId;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousActive = document.activeElement as HTMLElement | null;
    const focusReturnTarget = returnFocusRef?.current;
    document.body.style.overflow = "hidden";
    document.body.dataset.sheetOpen = "true";
    const focusInitial = window.setTimeout(() => {
      const first = sheetRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? sheetRef.current)?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusInitial);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      delete document.body.dataset.sheetOpen;
      const target = focusReturnTarget ?? previousActive;
      target?.focus();
    };
  }, [onClose, open, returnFocusRef]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="ui-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={sheetRef} className="ui-sheet" role="dialog" aria-modal="true" aria-labelledby={resolvedTitleId} tabIndex={-1}>
        <div className="ui-sheet-handle" aria-hidden="true" />
        <header className="ui-sheet-header">
          <div>
            <h2 id={resolvedTitleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" className="ui-icon-button" aria-label={tc("关闭")} onClick={onClose}><Icon name="close" /></button>
        </header>
        <div className="ui-sheet-body">{children}</div>
        {actions ? <div className="ui-sheet-actions">{actions}</div> : null}
      </section>
    </div>,
    document.body,
  );
}
