"use client";

import { signOut } from "next-auth/react";
import { useLocale } from "@/components/LocaleProvider";

/**
 * 退出登录按钮（小图标）。
 * 放在各页面顶栏右侧，点击即登出并回到登录页，
 * 让用户在需要切换账号时随时可以退出。
 */
export default function LogoutButton() {
  const { tc } = useLocale();
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      aria-label={tc("退出登录")}
      title={tc("退出登录")}
      className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--border-soft)] text-[var(--muted)] transition hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] active:scale-[0.95] dark:bg-[var(--border-soft)] dark:text-[var(--muted)] dark:hover:bg-[var(--danger-bg)] dark:hover:text-[var(--danger)]"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
    </button>
  );
}
