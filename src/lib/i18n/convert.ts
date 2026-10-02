/**
 * 繁簡顯示轉換（集中式原語）。
 *
 * 產品可見中文及正式詞庫內容一律以經審定的繁體中文為 canonical 原文。
 * zh-Hant 直接保留原文，避免簡轉繁工具擅自改變一字多義或專用術語；只有
 * zh-Hans 會由同一份繁體原文衍生簡體顯示。
 *
 * `normalizeTraditionalTerminology()` 只收斂已知的舊版「干擾項」錯誤字形，
 * 不是通用資料清洗器。新文案及 catalog 資料仍必須直接提供正確繁體原文。
 */
import * as OpenCC from "opencc-js";
import type { Locale } from "./config";

let hansConverter: ((s: string) => string) | null = null;
let hansInitFailed = false;

function normalizeTraditionalTerminology(text: string): string {
  return text
    .replaceAll("乾擾項", "干擾項")
    .replaceAll("幹擾項", "干擾項")
    .replaceAll("幹扰項", "干擾項")
    .replaceAll("干扰项", "干擾項");
}

function getHansConverter(): (s: string) => string {
  if (hansConverter) return hansConverter;
  if (hansInitFailed) return (s) => s;
  try {
    const converter = OpenCC.Converter({ from: "hk", to: "cn" });
    hansConverter = converter;
    return converter;
  } catch (e) {
    console.warn("[i18n] opencc-js 繁簡轉換初始化失敗，回退為不轉換：", e);
    hansInitFailed = true;
    return (s) => s;
  }
}

/**
 * 把繁體 canonical 原文依目標語言顯示。
 * - locale === "zh-Hant" → 保留繁體原文，只收斂已知術語錯字。
 * - locale === "zh-Hans" → 先收斂繁體原文，再衍生簡體顯示。
 *
 * 這是給 tc() 使用的低層函數；component 請使用 useLocale().tc。
 */
export function convertText(text: string, locale: Locale): string {
  if (!text) return text;
  const canonical = normalizeTraditionalTerminology(text);
  if (locale === "zh-Hans") {
    return getHansConverter()(canonical)
      .replaceAll("幹扰项", "干扰项")
      .replaceAll("幹擾項", "干扰项")
      // 簡體顯示沿用既有常用詞，但原始文案仍只保存繁體版本。
      .replaceAll("登入", "登录")
      .replaceAll("载入", "加载")
      .replaceAll("帐号", "账号")
      .replaceAll("帐户", "账户")
      .replaceAll("联络", "联系")
      .replaceAll("连线", "连接")
      .replaceAll("伺服器", "服务器");
  }
  return canonical;
}

/**
 * 服務端轉換：根據請求 cookie 決定語言後轉換。
 * 供 Server Component（例如 layout、root page）無法使用 useLocale() 時使用。
 *
 * 用法（在 RSC 里）：
 *   import { convertForServer } from "@/lib/i18n/convert";
 *   import { cookies } from "next/headers";
 *   const cookieStore = await cookies();
 *   const text = convertForServer("管理後台", cookieStore.toString());
 */
export function convertForServer(
  text: string,
  cookieHeader?: string,
): string {
  // 內聯解析 locale cookie，避免與 config 的 normalizeLocale 循環依賴。
  let locale: Locale = "zh-Hant"; // 預設繁體
  if (cookieHeader) {
    const m = cookieHeader.match(/(?:^|; )locale=([^;]*)/);
    if (m) {
      const v = decodeURIComponent(m[1]);
      if (/^zh[-_]?(hans|cn|sg)/i.test(v)) locale = "zh-Hans";
      else if (/^zh[-_]?(hant|tw|mo|hk)/i.test(v)) locale = "zh-Hant";
    }
  }
  return convertText(text, locale);
}
