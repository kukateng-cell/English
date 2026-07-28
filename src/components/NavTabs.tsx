"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface TabItem {
  href: string;
  label: string;
}

interface NavTabsProps {
  tabs: TabItem[];
}

/**
 * 胶囊形导航标签栏——自动根据当前路由高亮 active 状态。
 *
 * 匹配规则：
 *   精确匹配 href；
 *   若为首页（/admin 或 /teacher），仅精确匹配；
 *   子路由（如 /admin/users）不会激活首页标签。
 */
export default function NavTabs({ tabs }: NavTabsProps) {
  const pathname = usePathname();

  return (
    <nav className="mx-auto mb-6 flex w-full max-w-[420px] gap-1 px-5">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-full px-4 py-2 text-[13px] font-medium transition ${
              isActive
                ? "bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] text-white shadow-[0_4px_12px_rgba(37,99,235,0.15)]"
                : "text-[#7C89A5] hover:bg-[#EEF4FF] hover:text-[#2563EB] dark:text-[#64748B] dark:hover:bg-[#1E3A5F] dark:hover:text-[#60A5FA]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
