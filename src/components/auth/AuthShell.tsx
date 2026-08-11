"use client";

import type { ReactNode } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { useTheme } from "@/components/ThemeProvider";
import BrandLockup from "@/components/brand/BrandLockup";
import Icon from "@/components/ui/Icon";
import { LOCALES, type Locale } from "@/lib/i18n/config";

const LOCALE_LABELS: Record<Locale, string> = { "zh-Hans": "简体中文", "zh-Hant": "繁体中文" };

export default function AuthShell({ children }: { children: ReactNode }) {
  const { locale, setLocale, tc } = useLocale();
  const { theme, toggleTheme, mounted } = useTheme();
  return (
    <div className="auth-shell">
      <header className="auth-header"><BrandLockup /><div className="auth-controls"><button type="button" className="ui-icon-button" aria-label={tc(theme === "dark" ? "切换到浅色模式" : "切换到深色模式")} onClick={toggleTheme} disabled={!mounted}><Icon name={theme === "dark" ? "sun" : "moon"} size={19}/></button><div className="auth-locale-control" role="group" aria-label={tc("语言") as string}>{LOCALES.map((nextLocale) => <button type="button" key={nextLocale} className={nextLocale === locale ? "is-active" : undefined} aria-pressed={nextLocale === locale} onClick={() => setLocale(nextLocale)}>{tc(LOCALE_LABELS[nextLocale])}</button>)}</div></div></header>
      <main id="main-content" className="auth-main" tabIndex={-1}>{children}</main>
    </div>
  );
}
