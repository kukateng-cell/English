"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

function focusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true",
  );
}

/**
 * Keeps an overlay modal, even when it is rendered inside the workspace tree,
 * isolated from every sibling branch up to document.body.
 */
export function useCatalogModalFocus({
  open,
  onClose,
  panelRef,
  rootRef,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLElement | null>;
  rootRef: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !panelRef.current || !rootRef.current) return;
    const panel = panelRef.current;
    const root = rootRef.current;
    const previousFocus =
      returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    const previousOverflow = document.body.style.overflow;
    const inertState = new Map<HTMLElement, boolean>();
    let branch: HTMLElement = root;

    while (branch.parentElement) {
      const parent = branch.parentElement;
      for (const sibling of parent.children) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        if (!inertState.has(sibling))
          inertState.set(sibling, sibling.hasAttribute("inert"));
        sibling.setAttribute("inert", "");
      }
      branch = parent;
      if (parent === document.body) break;
    }
    document.body.style.overflow = "hidden";

    const focusBoundary = (backward: boolean) => {
      const focusable = focusableElements(panel);
      (backward ? focusable.at(-1) : focusable[0])?.focus();
      if (!focusable.length) panel.focus();
    };
    const timer = window.setTimeout(() => focusBoundary(false), 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(panel);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      if (!panel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!panel.contains(event.target as Node)) focusBoundary(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      document.body.style.overflow = previousOverflow;
      for (const [element, wasInert] of inertState)
        element.toggleAttribute("inert", wasInert);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open, panelRef, returnFocusRef, rootRef]);
}
