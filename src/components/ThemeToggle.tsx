"use client";

import { useTheme } from "@/components/ThemeProvider";
import { useLocale } from "@/components/LocaleProvider";
import Icon from "@/components/ui/Icon";

export default function ThemeToggle() {
  const { theme, toggleTheme, mounted } = useTheme();
  const { tc } = useLocale();
  const label = tc(theme === "dark" ? "切换到浅色模式" : "切换到深色模式");
  if (!mounted) return <span className="global-theme-toggle" aria-hidden="true" />;
  return <button type="button" className="ui-icon-button global-theme-toggle" onClick={toggleTheme} aria-label={label} title={label}><Icon name={theme === "dark" ? "sun" : "moon"} size={19}/></button>;
}
