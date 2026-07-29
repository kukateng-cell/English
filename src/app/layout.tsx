import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import Providers from "@/components/Providers";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  localeToHtmlLang,
  normalizeLocale,
} from "@/lib/i18n/config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 标题/描述以简体为来源；显示层会依语言转繁（见 LocaleProvider）。
// metadata 里的文字属 SSR 静态输出，这里给简体（与源代码一致）；
// 浏览器/SEO 以 <html lang> 为准（lang 随用户选择动态更新）。
export const metadata: Metadata = {
  title: "英语单词认读 · 中学生学习平台",
  description:
    "基于 SM-2 间隔重复算法的中学生英语单词认读学习网站。移动优先，随时随地学单词。",
};

/**
 * 在 hydration 之前同步执行的脚本：
 *  1. 主题：根据 localStorage / 系统偏好给 <html> 加 .dark，避免刷新时「闪一下」。
 *     必须与 ThemeProvider 的初始逻辑保持一致。
 *  2. 语言：根据 localStorage 拿到使用者选择，更新 <html lang>。
 *     这样即使 SSR 用了 cookie/预设值，客户端若已有不同的 localStorage 记录，
 *     也会在首帧前就修正 lang，避免短暂显示错误语言标签。
 */
const initScript = `(function(){try{
  var t=localStorage.getItem('theme');var d=t?(t==='dark'):(window.matchMedia('(prefers-color-scheme: dark)').matches);if(d){document.documentElement.classList.add('dark');}
  var l=localStorage.getItem('${LOCALE_STORAGE_KEY}');
  if(l){var m=/^zh[-_]?(hant|tw|mo|hk)/i.test(l)?'zh-Hant':(/^zh[-_]?(hans|cn|sg)/i.test(l)?'zh-Hans':null);if(m){document.documentElement.lang=m;}}
}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 从请求 cookie 决定首帧语言（SSR 可读，避免客户端闪烁）。
  // 无 cookie 时回退预设值（繁体中文）。
  const cookieStore = await cookies();
  const localeCookie = cookieStore.toString();
  const locale = normalizeLocale(cookieStore.get("locale")?.value);

  return (
    <html
      lang={localeToHtmlLang(locale)}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full font-sans bg-[#F7F9FF] dark:bg-[#0B1120] text-[#17213C] dark:text-[#E2E8F0]">
        <script dangerouslySetInnerHTML={{ __html: initScript }} />
        <Providers localeCookie={localeCookie}>{children}</Providers>
      </body>
    </html>
  );
}
