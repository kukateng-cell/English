"use client";

import { useTheme } from "@/components/ThemeProvider";
import { useLocale } from "@/components/LocaleProvider";
import Icon from "@/components/ui/Icon";

export default function ThemeToggle({ className = "ui-icon-button global-theme-toggle" }: { className?: string }) {
  const { theme, toggleTheme, mounted } = useTheme();
  const { tc } = useLocale();
  const label = tc(theme === "dark" ? "切換到淺色模式" : "切換到深色模式");
  if (!mounted) return <span className={className} aria-hidden="true" />;
  return <button type="button" className={className} onClick={toggleTheme} aria-label={label} title={label}><Icon name={theme === "dark" ? "sun" : "moon"} size={19}/></button>;
}
