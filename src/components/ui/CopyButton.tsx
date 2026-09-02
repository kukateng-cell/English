"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import Icon from "@/components/ui/Icon";

type CopyState = "idle" | "copied" | "failed";

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard copy was not available");
}

export default function CopyButton({ value }: { value: string }) {
  const { tc } = useLocale();
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  async function handleCopy() {
    if (!value) return;
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    try {
      await copyText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    resetTimer.current = window.setTimeout(() => setState("idle"), 2200);
  }

  const label = state === "copied"
    ? tc("已複製")
    : state === "failed"
      ? tc("複製失敗")
      : tc("複製密碼");

  return (
    <button
      type="button"
      className="ui-button ui-button-secondary ui-button-small"
      onClick={() => void handleCopy()}
      aria-label={label}
    >
      <Icon name={state === "copied" ? "check" : "copy"} size={16} />
      {label}
    </button>
  );
}
