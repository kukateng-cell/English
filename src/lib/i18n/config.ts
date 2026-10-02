/**
 * 語言／地區設定（集中管理）。
 *
 * 設計要點：
 * - 產品 UI、API fallback 及正式 DB 詞庫內容以繁體中文原文為 canonical。
 * - zh-Hant 直接顯示原文；zh-Hans 經 convertText／convertForServer 由繁體衍生。
 * - UI 文案、單詞釋義、單元／分類名、按鈕提示及錯誤訊息統一經 tc() 顯示，
 *   不在各頁維護兩份繁簡文案。
 * - 預設語言為繁體中文（zh-Hant）。
 */

export type Locale = "zh-Hant" | "zh-Hans";

/** 所有支援的語言（順序即下拉顯示順序）。 */
export const LOCALES: Locale[] = ["zh-Hant", "zh-Hans"];

/** 預設語言：首次進入（沒有任何記錄）時顯示繁體中文。 */
export const DEFAULT_LOCALE: Locale = "zh-Hant";

/** localStorage key（client 持久化）。 */
export const LOCALE_STORAGE_KEY = "locale";

/** Cookie key（SSR 初始值用，確保首次 HTML 的 lang 與 client 一致，避免閃爍）。 */
export const LOCALE_COOKIE_KEY = "locale";

/** 把 Locale 轉成標準 BCP-47 <html lang> 值。 */
export function localeToHtmlLang(locale: Locale): string {
  // zh-Hant／zh-Hans 本身就是合法的 BCP-47 語言子標籤。
  return locale;
}

/** 檢查任意字串是否為支援語言；不支援時回退 DEFAULT_LOCALE。 */
export function normalizeLocale(s: string | null | undefined): Locale {
  if (!s) return DEFAULT_LOCALE;
  const v = s.trim();
  // 寬鬆配對：zh-Hant／zh-Hant-MO／zh-TW → zh-Hant；zh-Hans／zh-CN／zh-SG → zh-Hans。
  if (/^zh[-_]?(hant|tw|mo|hk)/i.test(v)) return "zh-Hant";
  if (/^zh[-_]?(hans|cn|sg)/i.test(v)) return "zh-Hans";
  return (LOCALES as readonly string[]).includes(v) ? (v as Locale) : DEFAULT_LOCALE;
}

/**
 * 網站標題／描述只保存一份繁體原文，與全站文案策略一致。
 * 顯示層依目前語言經 convertText 即時轉換：
 * - server：layout 的 generateMetadata 讀取 cookie 產生 <title>；
 * - client：LocaleProvider 在切換語言時同步 document.title。
 */
export const SITE_TITLE = "英語單詞認讀 · 中學生學習平臺";
export const SITE_DESCRIPTION =
  "基於 SM-2 間隔重複算法的中學生英語單詞認讀學習網站。移動優先，隨時隨地學單詞。";
