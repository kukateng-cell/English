/**
 * 语言/地区配置（集中管理）。
 *
 * 设计要点：
 * - 唯一的「真实」内容来源是「简体中文」（源代码字面量 + DB 里的单词释义/单元名）。
 *   这是历史既成事实，避免大规模重写。
 * - zh-Hant 不是另一套独立文案，而是把简体在「显示层」即时转换成繁体
 *   （见 convert.ts 的 convertText / convertForServer）。因此 UI 文案、单词释义、单元/分类名、
 *   按钮提示、错误讯息全部统一走 tc() 转换，做到「集中管理、零散页面不再各自硬写繁简两版」。
 * - 预设语言为「繁体中文（zh-Hant）」，符合需求：新使用者首次开启即看到繁体。
 */

export type Locale = "zh-Hant" | "zh-Hans";

/** 所有支持的语言（顺序即下拉显示顺序）。 */
export const LOCALES: Locale[] = ["zh-Hant", "zh-Hans"];

/** 预设语言：首次进入（无任何记录）时显示繁体中文。 */
export const DEFAULT_LOCALE: Locale = "zh-Hant";

/** localStorage key（客户端持久化）。 */
export const LOCALE_STORAGE_KEY = "locale";

/** Cookie key（SSR 初始值用，确保首次 HTML 的 lang 与客户端一致、避免闪烁）。 */
export const LOCALE_COOKIE_KEY = "locale";

/** 把 Locale 转成标准 BCP-47 <html lang> 值。 */
export function localeToHtmlLang(locale: Locale): string {
  // zh-Hant / zh-Hans 本身就是合法的 BCP-47 语言子标签。
  return locale;
}

/** 检查任意字符串是否为支持的语言；不支援时回退 DEFAULT_LOCALE。 */
export function normalizeLocale(s: string | null | undefined): Locale {
  if (!s) return DEFAULT_LOCALE;
  const v = s.trim();
  // 宽松匹配：zh-Hant / zh-Hant-MO / zh-TW → zh-Hant；zh-Hans / zh-CN / zh-SG → zh-Hans
  if (/^zh[-_]?(hant|tw|mo|hk)/i.test(v)) return "zh-Hant";
  if (/^zh[-_]?(hans|cn|sg)/i.test(v)) return "zh-Hans";
  return (LOCALES as readonly string[]).includes(v) ? (v as Locale) : DEFAULT_LOCALE;
}

/**
 * 站点标题 / 描述（简体为唯一来源，与全站文案策略一致）。
 * 显示层依当前语言经 convertText 即时转繁：
 * - 服务端：layout 的 generateMetadata 读取 cookie 生成 <title>；
 * - 客户端：LocaleProvider 在切换语言时同步 document.title。
 * 这样「网页标题」也跟随语言选择，不再恒为简体。
 */
export const SITE_TITLE = "英语单词认读 · 中学生学习平台";
export const SITE_DESCRIPTION =
  "基于 SM-2 间隔重复算法的中学生英语单词认读学习网站。移动优先，随时随地学单词。";
