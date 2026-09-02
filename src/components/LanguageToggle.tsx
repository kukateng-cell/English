"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import Icon from "@/components/ui/Icon";

const LABELS: Record<Locale, string> = { "zh-Hans": "簡體中文", "zh-Hant": "繁體中文" };

export default function LanguageToggle() {
  const { locale, setLocale, tc, mounted } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);
  if (!mounted) return <span className="global-language-toggle" aria-hidden="true" />;
  const currentLabel = tc(LABELS[locale]);
  return <div ref={ref} className="global-language-toggle"><button type="button" className="ui-icon-button" aria-label={currentLabel} aria-expanded={open} onClick={() => setOpen((value) => !value)}><Icon name="globe" size={18}/></button>{open ? <div className="global-locale-menu" role="menu">{LOCALES.map((nextLocale) => <button type="button" role="menuitemradio" aria-checked={nextLocale === locale} key={nextLocale} className={nextLocale === locale ? "is-active" : undefined} onClick={() => { setLocale(nextLocale); setOpen(false); }}>{tc(LABELS[nextLocale])}</button>)}</div> : null}</div>;
}
