"use client";

import { useState } from "react";
import Image from "next/image";
import { speakEnglish } from "@/lib/speech";
import { getSafeImageSrc } from "@/lib/image-policy";
import { useLocale } from "@/components/LocaleProvider";
import BottomSheet from "@/components/ui/BottomSheet";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";

interface WordFull {
  term: string;
  phonetic?: string | null;
  pos?: string | null;
  definition: string;
  examples?: { en: string; zh: string }[] | null;
  synonyms?: string[];
  antonyms?: string[];
  imageUrl?: string | null;
}

interface HelpPanelProps {
  word: WordFull;
  visible: boolean;
  onDismiss: () => void;
}

export default function HelpPanel({ word, visible, onDismiss }: HelpPanelProps) {
  const { tc } = useLocale();
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const examples = Array.isArray(word.examples) ? word.examples : [];
  const safeImageSrc = getSafeImageSrc(word.imageUrl);

  const imageFailed = Boolean(word.imageUrl && failedImageSrc === word.imageUrl);

  const meaningfulPos =
    word.pos &&
    word.pos.trim().length > 0 &&
    !/^\d+$/.test(word.pos.trim()) &&
    word.pos.trim().toLowerCase() !== "null"
      ? word.pos
      : null;

  return (
    <BottomSheet
      open={visible}
      onClose={onDismiss}
      title={
        <div className="coach-sheet-title">
          <strong>{word.term}</strong>
          {word.phonetic ? <span>{word.phonetic}</span> : null}
        </div>
      }
      actions={
        <Button
          data-testid="help-panel-dismiss"
          type="button"
          className="coach-sheet-dismiss"
          onClick={onDismiss}
        >
          {tc("我學會了，下一個")}
          <Icon name="arrow-right" size={18} />
        </Button>
      }
    >
      <div className="coach-sheet-heading-row">
        <span className="coach-sheet-kicker">{tc("教認字")}</span>
        <button
          type="button"
          className="ui-icon-button coach-sheet-speak"
          onClick={() => speakEnglish(word.term)}
          aria-label={tc("發音")}
        >
          <Icon name="volume" size={19} />
        </button>
      </div>

      <section className="coach-sheet-definition" aria-labelledby="coach-definition-label">
        <p id="coach-definition-label" className="coach-sheet-label">{tc("釋義")}</p>
        <p className="coach-sheet-definition-text">{tc(word.definition)}</p>
        {meaningfulPos ? <span className="coach-sheet-badge">{tc(meaningfulPos)}</span> : null}
      </section>

      {examples.length > 0 ? (
        <section className="coach-sheet-section" aria-labelledby="coach-examples-label">
          <p id="coach-examples-label" className="coach-sheet-label">{tc("例句")}</p>
          {examples.slice(0, 2).map((example, index) => (
            <article key={`${example.en}-${index}`} className="coach-sheet-example">
              <p>{example.en}</p>
              <p>{tc(example.zh)}</p>
            </article>
          ))}
        </section>
      ) : null}

      {(word.synonyms?.length || word.antonyms?.length) ? (
        <div className="coach-sheet-relations">
          {word.synonyms && word.synonyms.length > 0 ? (
            <section className="coach-sheet-relation">
              <p className="coach-sheet-label">{tc("近義詞")}</p>
              <p className="coach-sheet-synonyms">{word.synonyms.map((item) => tc(item)).join(" · ")}</p>
            </section>
          ) : null}
          {word.antonyms && word.antonyms.length > 0 ? (
            <section className="coach-sheet-relation">
              <p className="coach-sheet-label">{tc("反義詞")}</p>
              <p className="coach-sheet-antonyms">{word.antonyms.map((item) => tc(item)).join(" · ")}</p>
            </section>
          ) : null}
        </div>
      ) : null}

      {safeImageSrc && !imageFailed ? (
        <div className="coach-sheet-image">
          <Image
            src={safeImageSrc}
            alt={tc(`${word.term} 配圖`)}
            fill
            sizes="(max-width: 640px) 100vw, 440px"
            className="object-cover"
            onError={() => setFailedImageSrc(word.imageUrl ?? safeImageSrc)}
          />
        </div>
      ) : (
        <div className="coach-sheet-image-fallback" role="img" aria-label={tc("暫無可用圖片") as string}>
          <Icon name="image" size={28} />
          <span>{tc("暫無可用圖片")}</span>
        </div>
      )}
    </BottomSheet>
  );
}
