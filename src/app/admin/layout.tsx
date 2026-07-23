import Link from "next/link";
import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
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
      <nav className="mx-auto mb-6 flex w-full max-w-[420px] gap-1 px-5">
        <Link
          href="/admin"
          className="rounded-full px-4 py-2 text-[13px] font-medium text-[#7C89A5] transition hover:bg-[#EEF4FF] hover:text-[#2563EB] dark:text-[#64748B] dark:hover:bg-[#1E3A5F] dark:hover:text-[#60A5FA]"
        >
          概览
        </Link>
        <Link
          href="/admin/users"
          className="rounded-full px-4 py-2 text-[13px] font-medium text-[#7C89A5] transition hover:bg-[#EEF4FF] hover:text-[#2563EB] dark:text-[#64748B] dark:hover:bg-[#1E3A5F] dark:hover:text-[#60A5FA]"
        >
          用户管理
        </Link>
        <Link
          href="/admin/words"
          className="rounded-full px-4 py-2 text-[13px] font-medium text-[#7C89A5] transition hover:bg-[#EEF4FF] hover:text-[#2563EB] dark:text-[#64748B] dark:hover:bg-[#1E3A5F] dark:hover:text-[#60A5FA]"
        >
          单词库
        </Link>
      </nav>

      {/* 内容区 */}
      <main className="mx-auto w-full max-w-[420px] flex-1 px-5 pb-16">
        {children}
      </main>
    </div>
  );
}
