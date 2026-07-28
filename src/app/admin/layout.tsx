import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/session";
import { ROLES, homePathFor } from "@/lib/roles";
import NavTabs from "@/components/NavTabs";

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
  return (
    <div className="flex min-h-full flex-col">
      {/* 顶部导航 */}
      <header className="mx-auto flex w-full max-w-[420px] items-center justify-between px-5 pt-5 pb-3">
        <Link
          href="/admin"
          className="text-[16px] font-bold tracking-[-0.02em] text-[#17213C] dark:text-[#E2E8F0]"
        >
          管理后台
        </Link>
        <Link
          href="/"
          className="flex items-center gap-1 text-[13px] text-[#7C89A5] transition hover:text-[#17213C] dark:text-[#64748B] dark:hover:text-[#E2E8F0]"
        >
          返回首页
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
          </svg>
        </Link>
      </header>

      {/* 标签栏 */}
      <NavTabs
        tabs={[
          { href: "/admin", label: "概览" },
          { href: "/admin/users", label: "用户管理" },
          { href: "/admin/words", label: "单词库" },
        ]}
      />

      {/* 内容区 */}
      <main className="mx-auto w-full max-w-[420px] flex-1 px-5 pb-16">
        {children}
      </main>
    </div>
  );
}
