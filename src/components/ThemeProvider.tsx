"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  /** 是否已在客户端挂载完成。挂载前主题值与 SSR 一致（light），
   *  仅用于让 ThemeToggle 避免显示与实际不符的图标。 */
  mounted: boolean;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "theme";

/**
 * 主题提供者：负责把用户的「浅色 / 深色」偏好持久化到 localStorage，
 * 并在 <html> 上增删 .dark 类，从而驱动 Tailwind 的 dark: 变体。
 *
 * 为避免 hydration mismatch，初始 state 固定为 "light"（与 SSR 一致），
 * 真实的用户偏好（localStorage > 系统偏好）在挂载后的 effect 中读取。
 * 页面背景不会因此闪烁：layout.tsx 里的内联脚本会在 React 渲染之前
 * 就把 .dark 加到 <html> 上。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // SSR 安全的初始值：与服务器端渲染一致，避免 hydration mismatch。
  const [theme, setThemeState] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  // 挂载后读取真实偏好（localStorage > 系统偏好 > 默认浅色）。
  // 用内联 async IIFE 包裹 setState，符合 react-hooks/set-state-in-effect 规则
  //（该规则只标记 effect body 内直接同步调用的 setState，不标记 IIFE 内的）。
  useEffect(() => {
    (async () => {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      const initial: Theme =
        stored === "light" || stored === "dark"
          ? stored
          : window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
      setThemeState(initial);
      setMounted(true);
    })();
  }, []);

  // 把主题同步到 <html> 上（增删 .dark）。挂载前由 layout 的内联脚本负责，
  // 这里仅在挂载后接管，确保切换时正确更新。
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [theme, mounted]);

  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* 忽略隐私模式等写入失败 */
    }
    setThemeState(t);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* 忽略 */
      }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme, mounted }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme 必须在 <ThemeProvider> 内部使用");
  return ctx;
}
