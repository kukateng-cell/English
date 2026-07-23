import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Providers from "@/components/Providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "英语单词认读 · 中学生学习平台",
  description:
    "基于 SM-2 间隔重复算法的中学生英语单词认读学习网站。移动优先，随时随地学单词。",
};

/**
 * 在 hydration 之前同步执行的脚本：根据 localStorage / 系统偏好
 * 给 <html> 加上 .dark，避免刷新时主题「闪一下」。
 * 必须与 ThemeProvider 的初始逻辑保持一致。
 */
const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?(t==='dark'):(window.matchMedia('(prefers-color-scheme: dark)').matches);if(d){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full font-sans bg-[#F7F9FF] dark:bg-[#0B1120] text-[#17213C] dark:text-[#E2E8F0]">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
