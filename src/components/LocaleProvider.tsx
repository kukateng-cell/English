"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_KEY,
  LOCALE_STORAGE_KEY,
  localeToHtmlLang,
  normalizeLocale,
  type Locale,
} from "@/lib/i18n/config";
import { convertText } from "@/lib/i18n/convert";

interface LocaleContextValue {
  locale: Locale;
  /** 切换语言（同时写入 localStorage 与 cookie，并更新 <html lang>）。 */
  setLocale: (locale: Locale) => void;
  /** 是否已在客户端挂载完成。挂载前 locale 与 SSR 一致（cookie/预设值），
   *  仅供需要避免 hydration mismatch 的组件判断。 */
  mounted: boolean;
  /**
   * 文案转换：把简体来源字符串转成当前语言的显示形式。
   * - zh-Hans：原样（来源即简体）。
   * - zh-Hant：简→繁。
   *
   * 用于所有「字面量 UI 文案」「DB 单词释义」「单元/分类名」等。
   * 这是全站唯一的繁简出口，达成「集中管理、不分散硬写两版」。
   */
  tc: (text: string) => string;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

/**
 * 读取初始语言偏好。
 *
 * 优先级：cookie > localStorage > DEFAULT_LOCALE。
 * - cookie 在 SSR 阶段也能读到，保证首帧 <html lang> 正确、无闪烁。
 * - localStorage 是主要持久化来源（刷新、再次登入都保留）；
 *   LocaleProvider 会在挂载时把 localStorage 的值同步回 cookie，确保两端一致。
 *
 * 此函数在服务端（无 localStorage/window）也安全：只读 cookie。
 */
function readInitialLocale(cookieHeader?: string): Locale {
  // cookie（SSR 可读）
  if (cookieHeader) {
    const match = cookieHeader.match(
      new RegExp(`(?:^|; )${LOCALE_COOKIE_KEY}=([^;]*)`),
    );
    if (match) return normalizeLocale(decodeURIComponent(match[1]));
  }
  return DEFAULT_LOCALE;
}

interface LocaleProviderProps {
  children: ReactNode;
  /** SSR 传入的 cookie 字符串，用于决定首帧语言（避免客户端再闪烁）。 */
  cookie?: string;
}

/**
 * 语言提供者：负责把使用者的「繁体 / 简体」偏好持久化到 localStorage + cookie，
 * 并把对应的 BCP-47 语言标签写到 <html lang>。
 *
 * SSR 阶段根据 cookie 决定首帧语言；客户端挂载后再读 localStorage 接管。
 * 挂载后语言变化会即时反映到 <html lang>，满足「lang 跟随选择更新」。
 */
export function LocaleProvider({ children, cookie }: LocaleProviderProps) {
  // 首帧语言（SSR 与 hydration 必须一致，避免 mismatch）：从 cookie 或预设值。
  const [locale, setLocaleState] = useState<Locale>(() =>
    readInitialLocale(cookie),
  );
  const [mounted, setMounted] = useState(false);

  // 挂载后：读 localStorage（主要持久化来源），与 SSR 首帧协调。
  useEffect(() => {
    (async () => {
      try {
        const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
        if (stored) {
          const next = normalizeLocale(stored);
          if (next !== locale) setLocaleState(next);
        }
      } catch {
        // localStorage 不可用（隐私模式等）→ 维持 cookie/预设值。
      }
      setMounted(true);
    })();
  }, [locale]);

  // 把语言同步到 <html lang> 与 cookie（SSR 首帧由 layout 的 lang 属性提供，
  // 这里在挂载后与切换时接管）。localStorage 也在 setLocale 时写入。
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = localeToHtmlLang(locale);
    }
    if (typeof document !== "undefined") {
      document.cookie = `${LOCALE_COOKIE_KEY}=${encodeURIComponent(locale)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // 忽略写入失败（隐私模式）
    }
    // cookie 由上面的 effect 同步（保证 <html lang> 与 cookie 一起更新）。
  }, []);

  // tc：用 useMemo 稳定引用，避免每次渲染都生成新函数导致子组件重渲染。
  const tc = useCallback((text: string) => convertText(text, locale), [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, mounted, tc }),
    [locale, setLocale, mounted, tc],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

/** 取得当前语言与转换函数。必须在 LocaleProvider 内使用。 */
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale 必须在 <LocaleProvider> 内使用");
  }
  return ctx;
}

/**
 * 给服务端组件用的：从请求 cookie 解出初始语言（供 LocaleProvider 的 cookie prop）。
 * 在 layout 的 RSC 里调用，把结果传进 Providers。
 */
export function pickLocaleFromCookies(cookieHeader: string | undefined): Locale {
  return readInitialLocale(cookieHeader);
}
