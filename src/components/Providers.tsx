"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LocaleProvider } from "@/components/LocaleProvider";

import type { Locale } from "@/lib/i18n/config";

export default function Providers({
  children,
  /** SSR 传入的已规范化语言，供 LocaleProvider 决定首帧语言。 */
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  return (
    <NextAuthSessionProvider>
      <LocaleProvider initialLocale={initialLocale}>
        <ThemeProvider>
          <MotionConfig reducedMotion="user">{children}</MotionConfig>
        </ThemeProvider>
      </LocaleProvider>
    </NextAuthSessionProvider>
  );
}
