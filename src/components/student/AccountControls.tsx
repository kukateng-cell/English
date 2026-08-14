"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { useLocale } from "@/components/LocaleProvider";
import { useTheme } from "@/components/ThemeProvider";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import Icon from "@/components/ui/Icon";
import Link from "next/link";

const LOCALE_LABELS: Record<Locale, string> = {
  "zh-Hans": "简体中文",
  "zh-Hant": "繁体中文",
};

export default function AccountControls({
  user,
  compact = false,
  homeHref = "/",
  homeLabel = "回到首页",
}: {
  user: { name: string | null; email: string };
  compact?: boolean;
  homeHref?: string;
  homeLabel?: string;
}) {
  const { locale, setLocale, tc } = useLocale();
  const { theme, toggleTheme, mounted } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const rawLabel = user.name?.trim() || user.email;
  const label = tc(rawLabel);
  const initials = label.slice(0, 1).toUpperCase();

  useEffect(() => {
    if (!open) return;
    const focusable = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>("a[href],button:not(:disabled)") ?? []);
    const first = window.setTimeout(() => focusable()[0]?.focus(), 0);
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(first);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={compact ? "account-controls account-controls-compact" : "account-controls"}>
      <button ref={triggerRef} type="button" className="account-trigger" aria-label={tc("账户菜单")} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}>
        <span className="account-avatar" aria-hidden="true">{initials}</span>
        <span className="account-trigger-copy"><strong>{label}</strong><small>{tc("学习账户")}</small></span>
        <Icon name="chevron-down" size={16} />
      </button>
      {open ? (
        <div ref={menuRef} className="account-menu" role="menu" aria-label={tc("账户菜单") as string}>
          <div className="account-menu-heading">{label}</div>
          <LinkHome href={homeHref} label={homeLabel} onNavigate={() => setOpen(false)} />
          <button type="button" role="menuitem" className="account-menu-item" onClick={toggleTheme} disabled={!mounted}>
            <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
            <span>{tc(theme === "dark" ? "切换到浅色模式" : "切换到深色模式")}</span>
          </button>
          <div className="account-locale" role="group" aria-label={tc("语言") as string}>
            {LOCALES.map((nextLocale) => <button key={nextLocale} type="button" className={nextLocale === locale ? "account-locale-option is-active" : "account-locale-option"} onClick={() => setLocale(nextLocale)}>{tc(LOCALE_LABELS[nextLocale])}</button>)}
          </div>
          <button type="button" role="menuitem" className="account-menu-item account-menu-danger" onClick={() => signOut({ callbackUrl: "/login" })}>
            <Icon name="logout" size={18} /><span>{tc("退出登录")}</span>
          </button>
        </div>
      ) : null}
      {!compact ? <span className="account-touch-hint">{tc("账户")}</span> : null}
    </div>
  );
}

function LinkHome({ href, label, onNavigate }: { href: string; label: string; onNavigate: () => void }) {
  const { tc } = useLocale();
  return <Link href={href} role="menuitem" className="account-menu-item" onClick={onNavigate}><Icon name="home" size={18} /><span>{tc(label)}</span></Link>;
}
