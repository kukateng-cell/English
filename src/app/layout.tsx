import type { Metadata } from "next";
import { cookies } from "next/headers";
import Providers from "@/components/Providers";
import {
  LOCALE_COOKIE_KEY,
  LOCALE_STORAGE_KEY,
  localeToHtmlLang,
  normalizeLocale,
  SITE_TITLE,
  SITE_DESCRIPTION,
} from "@/lib/i18n/config";
import { convertText } from "@/lib/i18n/convert";
import "./globals.css";

/**
 * 站点标题/描述：以简体为来源，依请求 cookie 的语言偏好即时转繁。
 * 繁体用户刷新/导航时看到的就是繁体标题（不再是恒定的简体）。
 * 客户端切换语言后由 LocaleProvider 同步 document.title，无需刷新。
 */
export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE_KEY)?.value);
  return {
    title: convertText(SITE_TITLE, locale),
    description: convertText(SITE_DESCRIPTION, locale),
  };
}

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
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE_KEY)?.value);

  return (
    <html
      lang={localeToHtmlLang(locale)}
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground font-sans">
        <script dangerouslySetInnerHTML={{ __html: initScript }} />
        <Providers initialLocale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
