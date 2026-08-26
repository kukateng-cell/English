/**
 * 简繁转换（集中式原语）。
 *
 * 站点历史代码同时存在简体及繁体字面量，DB 内容则以规范来源保存。
 * 本模块在显示层统一转换到目标字形，供 LocaleProvider 的 tc() 调用。
 *
 * 为什么不用「两套独立文案」？
 * - 文案量大（按钮/提示/错误/释义/单元名…），维护两套易脱节、易混用。
 * - 单词释义与单元名都在 DB 里（简体），不可能为每个词都维护繁体版本。
 * - opencc-js 的 S2T（简→繁）转换对常见中文准确度足够，且为纯 JS、可在浏览器运行。
 *
 * 策略：
 * - zh-Hans：统一跑繁→简，已经是简体的内容保持不变。
 * - zh-Hant：统一跑简→繁转换（含词汇校正 TWPhrases 的「一字多译」修正）。
 *
 * 转换器在首次调用时惰性初始化（opencc-js 的 Converter 需加载字典数据）。
 * 在 SSR（Node）与客户端浏览器都能用——opencc-js 侦测到环境自行选择加载方式。
 */
import * as OpenCC from "opencc-js";
import type { Locale } from "./config";

// 惰性建立的转换器（简体 → 繁体）。
// 使用 s2t（含台湾常用词校正）以贴近需求里 zh-Hant 的预期。
let hantConverter: ((s: string) => string) | null = null;
let hantInitFailed = false;
let hansConverter: ((s: string) => string) | null = null;
let hansInitFailed = false;

/**
 * 取得「简→繁」转换函数。失败时回退为「不转换」（确保站点永远可用）。
 *
 * 注意：opencc-js 的 Converter API 在不同版本有差异；这里按当前类型与实现，
 *   将 Converter({ from: "cn", to: "tw" }) 作为 (s: string) => string 直接调用。
 */
function getHantConverter(): (s: string) => string {
  if (hantConverter) return hantConverter;
  if (hantInitFailed) return (s) => s; // 失败后不再重试，避免每次调用都报错
  try {
    const converter = OpenCC.Converter({ from: "cn", to: "tw" });
    hantConverter = converter;
    return converter;
  } catch (e) {
    // 某些环境（极受限的 Edge runtime）可能加载失败；降级为原样输出。
    console.warn("[i18n] opencc-js 简繁转换初始化失败，回退为不转换：", e);
    hantInitFailed = true;
    return (s) => s;
  }
}

function getHansConverter(): (s: string) => string {
  if (hansConverter) return hansConverter;
  if (hansInitFailed) return (s) => s;
  try {
    const converter = OpenCC.Converter({ from: "hk", to: "cn" });
    hansConverter = converter;
    return converter;
  } catch (e) {
    console.warn("[i18n] opencc-js 繁简转换初始化失败，回退为不转换：", e);
    hansInitFailed = true;
    return (s) => s;
  }
}

/**
 * 把来源文本依目标语言转换后返回。
 * - locale === "zh-Hans" → 繁→简；已经是简体的内容保持不变。
 * - locale === "zh-Hant" → 简→繁转换。
 *
 * 这是给 tc() 用的低层函数；组件层请用 useLocale().tc。
 */
export function convertText(text: string, locale: Locale): string {
  if (!text) return text;
  if (locale === "zh-Hans") {
    return getHansConverter()(text)
      .replaceAll("幹扰项", "干扰项")
      .replaceAll("幹擾項", "干扰项");
  }
  return getHantConverter()(text)
    .replaceAll("幹擾項", "干擾項")
    .replaceAll("幹扰項", "干擾項")
    .replaceAll("干扰项", "干擾項");
}

/**
 * 服务端转换：根据请求 cookie 决定语言后转换。
 * 供服务端组件（RSC，如 layout、root page）在无法用 useLocale() 时使用。
 *
 * 用法（在 RSC 里）：
 *   import { convertForServer } from "@/lib/i18n/convert";
 *   import { cookies } from "next/headers";
 *   const cookieStore = await cookies();
 *   const text = convertForServer("管理后台", cookieStore.toString());
 */
export function convertForServer(
  text: string,
  cookieHeader?: string,
): string {
  // 内联解析 locale cookie，避免与 config 的 normalizeLocale 循环依赖。
  let locale: Locale = "zh-Hant"; // 预设繁体
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
