"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LocaleProvider } from "@/components/LocaleProvider";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";

export default function Providers({
  children,
  /** SSR 传入的 cookie 字符串，供 LocaleProvider 决定首帧语言。 */
  localeCookie,
}: {
  children: ReactNode;
  localeCookie?: string;
}) {
  return (
    <NextAuthSessionProvider>
      <LocaleProvider cookie={localeCookie}>
        <ThemeProvider>
          {children}
          <ThemeToggle />
          <LanguageToggle />
        </ThemeProvider>
      </LocaleProvider>
    </NextAuthSessionProvider>
  );
}
