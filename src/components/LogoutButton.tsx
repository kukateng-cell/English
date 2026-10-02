"use client";

import { signOut } from "next-auth/react";
import { useLocale } from "@/components/LocaleProvider";
import Icon from "@/components/ui/Icon";

/**
 * 退出登录按钮（小图标）。
 * 放在各页面顶栏右侧，点击即登出并回到登录页，
 * 让用户在需要切换账号时随时可以退出。
 */
export default function LogoutButton({ className }: { className?: string } = {}) {
  const { tc } = useLocale();
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      aria-label={tc("退出登入")}
      title={tc("退出登入")}
      className={className ?? "flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--border-soft)] text-[var(--muted)] transition hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] active:scale-[0.95] dark:bg-[var(--border-soft)] dark:text-[var(--muted)] dark:hover:bg-[var(--danger-bg)] dark:hover:text-[var(--danger)]"}
    >
      <Icon name="logout" size={18} />
    </button>
  );
}
