import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/session";
import { ROLES, homePathFor } from "@/lib/roles";
import { convertForServer } from "@/lib/i18n/convert";

/**
 * 管理後台 Layout —— 服務端角色守衛（第二道防線）。
 *
 * 攔截順序（雙重防護，零頁面閃爍）：
 *   1. src/proxy.ts        —— Edge 層先用 JWT 快取角色攔下大多數越權請求
 *   2. 本 Layout（此處）    —— RSC 層用 getServerSession 查庫取「最新角色」，
 *                             即便管理員剛改過角色也能即時生效
 *
 * 未登入 → /login?callbackUrl=/admin；角色非 ADMIN → 回到自己的首頁。
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?callbackUrl=/admin");
  }
  if (user.role !== ROLES.ADMIN) {
    redirect(homePathFor(user.role));
  }
  const cookieStore = await cookies();
  const tc = (s: string) => convertForServer(s, cookieStore.toString());
  return (
    <div className="flex min-h-full flex-col">
      {/* 顶部导航 */}
      <header className="mx-auto flex w-full max-w-[420px] items-center justify-between px-5 pt-5 pb-3">
        <Link
          href="/admin"
          className="text-[16px] font-bold tracking-[-0.02em] text-[#17213C] dark:text-[#E2E8F0]"
        >
          {tc("管理后台")}
        </Link>
        <Link
          href="/"
          className="flex items-center gap-1 text-[13px] text-[#7C89A5] transition hover:text-[#17213C] dark:text-[#64748B] dark:hover:text-[#E2E8F0]"
        >
          {tc("返回首页")}
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
          </svg>
        </Link>
      </header>

      {/* 标签栏 */}
      <nav className="mx-auto mb-6 flex w-full max-w-[420px] gap-1 px-5">
        <Link
          href="/admin"
          className="rounded-full px-4 py-2 text-[13px] font-medium text-[#7C89A5] transition hover:bg-[#EEF4FF] hover:text-[#2563EB] dark:text-[#64748B] dark:hover:bg-[#1E3A5F] dark:hover:text-[#60A5FA]"
        >
          {tc("概览")}
        </Link>
        <Link
          href="/admin/users"
          className="rounded-full px-4 py-2 text-[13px] font-medium text-[#7C89A5] transition hover:bg-[#EEF4FF] hover:text-[#2563EB] dark:text-[#64748B] dark:hover:bg-[#1E3A5F] dark:hover:text-[#60A5FA]"
        >
          {tc("用户管理")}
        </Link>
        <Link
          href="/admin/words"
          className="rounded-full px-4 py-2 text-[13px] font-medium text-[#7C89A5] transition hover:bg-[#EEF4FF] hover:text-[#2563EB] dark:text-[#64748B] dark:hover:bg-[#1E3A5F] dark:hover:text-[#60A5FA]"
        >
          {tc("单词库")}
        </Link>
      </nav>

      {/* 内容区 */}
      <main className="mx-auto w-full max-w-[420px] flex-1 px-5 pb-16">
        {children}
      </main>
    </div>
  );
}
