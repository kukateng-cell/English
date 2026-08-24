"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { rosterFetch } from "@/lib/roster-client";
import { networkErrorMessage, responseErrorMessage } from "@/lib/api-error";
import {
  clientOperationFingerprint,
  pendingClientOperation,
  type PendingClientOperation,
} from "@/lib/catalog/client-operation";

const KINDS = [
  ["DEFINITION", "中文釋義"],
  ["LEVEL", "程度"],
  ["PART_OF_SPEECH", "詞性"],
  ["PHONETIC", "音標"],
  ["EXAMPLE", "例句"],
  ["DISTRACTOR", "正確答案或干擾項"],
  ["INAPPROPRIATE_WORD", "詞語不適合"],
  ["MISSING_WORD", "詞庫缺少詞語"],
  ["OTHER", "其他"],
] as const;

export type CatalogFeedbackTarget = { senseKey: string | null; term: string | null };

export default function CatalogFeedbackDialog({ target, onClose, onSubmitted }: {
  target: CatalogFeedbackTarget;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { tc } = useLocale();
  const dialogRef = useRef<HTMLElement | null>(null);
  const [kind, setKind] = useState(target.senseKey ? "DEFINITION" : "MISSING_WORD");
  const [term, setTerm] = useState(target.term ?? "");
  const [message, setMessage] = useState("");
  const [suggestedValue, setSuggestedValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pendingOperationRef = useRef<PendingClientOperation | null>(null);
  const availableKinds = target.senseKey
    ? KINDS.filter(([value]) => value !== "MISSING_WORD")
    : KINDS.filter(([value]) => value === "MISSING_WORD" || value === "OTHER");

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    return () => { window.clearTimeout(timer); previous?.focus(); };
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    event.stopPropagation();
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button, input, select, textarea, [href], [tabindex]:not([tabindex='-1'])")]
      .filter((item) => !item.hasAttribute("disabled"));
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function submit() {
    if (kind === "MISSING_WORD" && !term.trim()) {
      setError(tc("請填寫建議加入的英文詞。"));
      return;
    }
    if (message.trim().length < 3) {
      setError(tc("請用至少三個字說明問題。"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const requestBody = {
        senseKey: target.senseKey,
        term,
        kind,
        message,
        suggestedValue,
      };
      const fingerprint = clientOperationFingerprint(requestBody);
      pendingOperationRef.current = pendingClientOperation(pendingOperationRef.current, fingerprint, () => window.crypto.randomUUID());
      const response = await rosterFetch("/api/catalog/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: pendingOperationRef.current.operationId,
          ...requestBody,
        }),
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      pendingOperationRef.current = null;
      onSubmitted();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc(networkErrorMessage(cause)));
    } finally {
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/35 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="catalog-feedback-title">
    <section ref={dialogRef} tabIndex={-1} onKeyDown={handleKeyDown} className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-[var(--surface)] p-5 shadow-2xl sm:rounded-3xl">
      <div className="flex items-start justify-between gap-3">
        <div><h2 id="catalog-feedback-title" className="text-xl font-bold text-[var(--text)]">{tc("提出詞庫意見")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{tc("先簡單報告問題即可；意見不會直接改動學生詞庫，正式修改仍須審核。")}</p></div>
        <button type="button" className="ui-button ui-button-quiet ui-button-small" onClick={onClose} aria-label={tc("關閉") as string}>×</button>
      </div>
      <div className="mt-5 grid gap-4">
        <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("問題類型")}<select className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" value={kind} onChange={(event) => setKind(event.target.value)}>{availableKinds.map(([value, label]) => <option key={value} value={value}>{tc(label)}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("相關英文詞")}{kind === "MISSING_WORD" ? `（${tc("必填")}）` : ""}<input className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] disabled:bg-[var(--border-soft)]" value={term} required={kind === "MISSING_WORD"} aria-required={kind === "MISSING_WORD"} disabled={Boolean(target.senseKey)} onChange={(event) => setTerm(event.target.value)} /></label>
        {target.senseKey ? <p className="break-all text-xs text-[var(--muted)]">sense key：{target.senseKey}</p> : null}
        <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("發現咗咩問題？")}<textarea className="min-h-28 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]" value={message} maxLength={2000} onChange={(event) => setMessage(event.target.value)} placeholder={tc("例如：呢個中文解釋太深，A1 學生未必明白。") as string} /></label>
        <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("建議點改（可留空）")}<textarea className="min-h-20 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]" value={suggestedValue} maxLength={2000} onChange={(event) => setSuggestedValue(event.target.value)} /></label>
      </div>
      {error ? <p role="alert" className="mt-4 rounded-xl bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2 border-t border-[var(--border)] pt-4"><button type="button" className="ui-button ui-button-quiet" onClick={onClose}>{tc("取消")}</button><button type="button" className="ui-button ui-button-primary" disabled={saving} onClick={() => void submit()}>{saving ? tc("提交中…") : tc("提交意見")}</button></div>
    </section>
  </div>;
}
