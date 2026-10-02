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
  SITE_TITLE,
  type Locale,
} from "@/lib/i18n/config";
import { convertText } from "@/lib/i18n/convert";
import { useRouter } from "next/navigation";

interface LocaleContextValue {
  locale: Locale;
  /** 切換語言（同時寫入 localStorage 與 cookie，並更新 <html lang>）。 */
  setLocale: (locale: Locale) => void;
  /** 是否已在 client 掛載完成。掛載前 locale 與 SSR 一致（cookie／預設值），
   *  只供需要避免 hydration mismatch 的 component 判斷。 */
  mounted: boolean;
  /**
   * 文案顯示：來源必須是經審定的繁體中文原文。
   * - zh-Hant：直接保留繁體原文。
   * - zh-Hans：由繁體原文衍生簡體。
   *
   * 用於所有 UI 文案、DB 單詞釋義及單元／分類名；這是全站唯一繁簡出口。
   */
  tc: (text: string) => string;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

interface LocaleProviderProps {
  children: ReactNode;
  /** SSR 傳入的已規範化語言，用於決定首幀語言（避免 client 再閃爍）。 */
  initialLocale?: Locale;
}

/**
 * 語言 provider：把使用者的繁體／簡體偏好持久化到 localStorage＋cookie，
 * 並把對應的 BCP-47 語言標籤寫到 <html lang>。
 *
 * SSR 階段根據 initialLocale 決定首幀語言；client 掛載後把 localStorage
 * 同步到同一語言，避免舊 localStorage 在 hydration 後覆蓋 SSR 文案造成閃爍。
 */
export function LocaleProvider({ children, initialLocale }: LocaleProviderProps) {
  const router = useRouter();
  // 首幀語言（SSR 與 hydration 必須一致）：從 initialLocale 或預設值取得。
  const [locale, setLocaleState] = useState<Locale>(
    () => initialLocale ?? DEFAULT_LOCALE,
  );
  const [mounted, setMounted] = useState(false);

  // Cookie 是 server 可見的首幀來源；掛載後把舊版本／衝突的 localStorage
  // 對齊到 SSR locale，不讓它在 hydration 後改寫頁面語言。
  useEffect(() => {
    queueMicrotask(() => {
      try {
        localStorage.setItem(
          LOCALE_STORAGE_KEY,
          initialLocale ?? DEFAULT_LOCALE,
        );
      } catch {
        // localStorage 不可用（私隱模式等）→ 維持 cookie／預設值。
      } finally {
        setMounted(true);
      }
    });
  }, [initialLocale]);

  // 把語言同步到 <html lang> 與 cookie；localStorage 亦在 setLocale 時寫入。
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = localeToHtmlLang(locale);
    }
    if (typeof document !== "undefined") {
      document.cookie = `${LOCALE_COOKIE_KEY}=${encodeURIComponent(locale)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    }
  }, [locale]);

  // 切換語言時同步瀏覽器分頁標題；metadata 的 <title> 是 SSR 輸出，
  // client 切換語言不會自動重算，所以在此更新 document.title。
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
      // 忽略寫入失敗（私隱模式）。
    }
    // 先同步 cookie，再重新整理 RSC，確保 server 文案立即切換語言。
    document.cookie = `${LOCALE_COOKIE_KEY}=${encodeURIComponent(next)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    router.refresh();
  }, [router]);

  // tc：穩定引用，避免每次 render 都產生新函數令子 component 重繪。
  const tc = useCallback((text: string) => convertText(text, locale), [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, mounted, tc }),
    [locale, setLocale, mounted, tc],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

/** 取得目前語言與轉換函數；必須在 LocaleProvider 內使用。 */
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale 必須在 <LocaleProvider> 內使用");
  }
  return ctx;
}
