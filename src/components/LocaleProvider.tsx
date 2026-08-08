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
  SITE_TITLE,
  type Locale,
} from "@/lib/i18n/config";
import { convertText } from "@/lib/i18n/convert";
import { useRouter } from "next/navigation";

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

interface LocaleProviderProps {
  children: ReactNode;
  /** SSR 传入的已规范化语言，用于决定首帧语言（避免客户端再闪烁）。 */
  initialLocale?: Locale;
}

/**
 * 语言提供者：负责把使用者的「繁体 / 简体」偏好持久化到 localStorage + cookie，
 * 并把对应的 BCP-47 语言标签写到 <html lang>。
 *
 * SSR 阶段根据 initialLocale 决定首帧语言；客户端挂载后再读 localStorage 接管。
 * 挂载后语言变化会即时反映到 <html lang>，满足「lang 跟随选择更新」。
 */
export function LocaleProvider({ children, initialLocale }: LocaleProviderProps) {
  const router = useRouter();
  // 首帧语言（SSR 与 hydration 必须一致，避免 mismatch）：从 initialLocale 或预设值。
  const [locale, setLocaleState] = useState<Locale>(
    () => initialLocale ?? DEFAULT_LOCALE,
  );
  const [mounted, setMounted] = useState(false);

  // 挂载后：读 localStorage（主要持久化来源），与 SSR 首帧协调。
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
        if (stored) {
          const next = normalizeLocale(stored);
          setLocaleState((prev) => (prev === next ? prev : next));
          if (next !== (initialLocale ?? DEFAULT_LOCALE)) {
            document.cookie = `${LOCALE_COOKIE_KEY}=${encodeURIComponent(next)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
            router.refresh();
          }
        }
      } catch {
        // localStorage 不可用（隐私模式等）→ 维持 cookie/预设值。
      } finally {
        setMounted(true);
      }
    });
  }, [initialLocale, router]);

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

  // 切换语言时同步浏览器标签页标题：metadata 的 <title> 是 SSR 输出，
  // 客户端切换语言不会自动重算，这里显式覆盖 document.title，
  // 让繁体偏好立即反映到标签页（与 layout 的 generateMetadata 互补）。
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = convertText(SITE_TITLE, locale);
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // 忽略写入失败（隐私模式）
    }
    // 先同步 cookie，再刷新 RSC；否则首页／后台 layout 的服务端文案要到下次
    // 导航才会切换语言。effect 仍保留作初始挂载同步。
    document.cookie = `${LOCALE_COOKIE_KEY}=${encodeURIComponent(next)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    router.refresh();
  }, [router]);

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
