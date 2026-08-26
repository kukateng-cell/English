"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { rosterFetch } from "@/lib/roster-client";
import { networkErrorMessage } from "@/lib/api-error";
import { catalogValidationResponseErrorMessage } from "@/lib/catalog/client-validation";

type Payload = {
  term: string;
  definitionZh: string;
  enableEnToZh: boolean;
  enableZhToEn: boolean;
};

type Preview = {
  prompt: string;
  direction: "en-zh" | "zh-en";
  options: Array<{ id: string; text: string }>;
  correctOptionId: string;
  correctAnswer: string;
  itemConstructionVersion: string;
};

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

export default function CatalogQuestionPreview({ payload, senseKey }: { payload: Payload; senseKey?: string | null }) {
  const { tc } = useLocale();
  const titleId = useId();
  const [direction, setDirection] = useState<"en-zh" | "zh-en">(payload.enableEnToZh ? "en-zh" : "zh-en");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const effectiveDirection = direction === "en-zh" && !payload.enableEnToZh && payload.enableZhToEn
    ? "zh-en"
    : direction === "zh-en" && !payload.enableZhToEn && payload.enableEnToZh
      ? "en-zh"
      : direction;
  const currentKey = JSON.stringify({ senseKey: senseKey ?? null, payload, direction: effectiveDirection });
  const previewGenerationRef = useRef(0);
  const previewAbortRef = useRef<AbortController | null>(null);
  const visiblePreview = previewKey === currentKey ? preview : null;
  const visibleError = error?.key === currentKey ? error.message : null;
  const loading = loadingKey === currentKey;

  useEffect(() => () => {
    previewGenerationRef.current += 1;
    previewAbortRef.current?.abort();
  }, []);

  function changeDirection(next: "en-zh" | "zh-en") {
    previewGenerationRef.current += 1;
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    setPreview(null);
    setPreviewKey("");
    setError(null);
    setLoadingKey(null);
    setDirection(next);
  }

  async function generate() {
    const requestKey = currentKey;
    const generation = ++previewGenerationRef.current;
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setLoadingKey(requestKey);
    setError(null);
    try {
      const response = await rosterFetch("/api/catalog/question-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ payload, senseKey, direction: effectiveDirection, seed: window.crypto.randomUUID() }),
      });
      if (generation !== previewGenerationRef.current) return;
      if (!response.ok) {
        throw new Error(
          await catalogValidationResponseErrorMessage(response, tc),
        );
      }
      const body = await response.json() as { preview: Preview };
      if (generation !== previewGenerationRef.current) return;
      setPreview(body.preview);
      setPreviewKey(requestKey);
    } catch (cause) {
      if (generation !== previewGenerationRef.current || isAbortError(cause)) return;
      setPreview(null);
      setError({ key: requestKey, message: cause instanceof Error ? cause.message : tc(networkErrorMessage(cause)) });
    } finally {
      if (previewAbortRef.current === controller) previewAbortRef.current = null;
      if (generation === previewGenerationRef.current) {
        setLoadingKey((current) => current === requestKey ? null : current);
      }
    }
  }

  return <section className="mt-4 rounded-2xl border border-[var(--primary)]/25 bg-[var(--border-soft)] p-4" aria-labelledby={titleId}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 id={titleId} className="font-bold text-[var(--text)]">{tc("學生題目預覽")}</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{tc("使用正式學生出題器即時抽選三個安全干擾項；預覽不會建立學習紀錄或影響統計。")}</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("預覽方向")}
          <select key={effectiveDirection} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" value={effectiveDirection} onChange={(event) => changeDirection(event.target.value as "en-zh" | "zh-en")}>
            <option value="en-zh" disabled={!payload.enableEnToZh}>{tc("英譯中")}{!payload.enableEnToZh ? `（${tc("未啟用")}）` : ""}</option>
            <option value="zh-en" disabled={!payload.enableZhToEn}>{tc("中譯英")}{!payload.enableZhToEn ? `（${tc("未啟用")}）` : ""}</option>
          </select>
        </label>
        <button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={loading || (effectiveDirection === "en-zh" ? !payload.enableEnToZh : !payload.enableZhToEn)} onClick={() => void generate()}>
          {loading ? tc("正在出題…") : visiblePreview ? tc("再抽一組") : tc("產生預覽")}
        </button>
      </div>
    </div>
    {visibleError ? <p role="alert" className="mt-3 rounded-xl bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">{visibleError}</p> : null}
    {visiblePreview ? <div className="mx-auto mt-4 max-w-2xl rounded-[26px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--primary)]">{visiblePreview.direction === "en-zh" ? tc("選出正確中文意思") : tc("選出正確英文詞")}</p>
      <p className="mt-3 text-center text-3xl font-bold tracking-[-0.03em] text-[var(--text)]">{visiblePreview.prompt}</p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {visiblePreview.options.map((option, index) => {
          const correct = option.id === visiblePreview.correctOptionId;
          return <div key={option.id} className={`flex min-h-14 items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold ${correct ? "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"}`}>
            <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--border-soft)] text-xs">{String.fromCharCode(65 + index)}</span>
            <span>{option.text}</span>
            {correct ? <span className="ml-auto text-[10px] font-bold">{tc("正確答案")}</span> : null}
          </div>;
        })}
      </div>
      <p className="mt-3 text-right text-[10px] text-[var(--muted)]">{visiblePreview.itemConstructionVersion}</p>
    </div> : null}
  </section>;
}
