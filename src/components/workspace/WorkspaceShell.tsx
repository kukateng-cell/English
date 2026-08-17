"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useLocale } from "@/components/LocaleProvider";
import BrandLockup from "@/components/brand/BrandLockup";
import AccountControls from "@/components/student/AccountControls";
import Icon, { type IconName } from "@/components/ui/Icon";
import type { Role } from "@/lib/roles";

type WorkspaceItem = { href: string; label: string; icon: IconName };

const ITEMS: Record<"teacher" | "admin", WorkspaceItem[]> = {
  teacher: [
    { href: "/teacher", label: "概览", icon: "bar-chart" },
    { href: "/teacher/analytics", label: "學習分析", icon: "trending-up" },
    { href: "/teacher/roster", label: "學生", icon: "clipboard" },
  ],
  admin: [
    { href: "/admin", label: "概览", icon: "bar-chart" },
    { href: "/admin/analytics", label: "學習分析", icon: "trending-up" },
    { href: "/admin/roster", label: "班级与名单", icon: "clipboard" },
    { href: "/admin/users", label: "用户管理", icon: "users" },
    { href: "/admin/words", label: "单词库", icon: "book" },
  ],
};

export default function WorkspaceShell({
  role,
  user,
  children,
}: {
  role: "teacher" | "admin";
  user: { name: string | null; email: string; role: Role };
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { tc } = useLocale();
  const items = ITEMS[role];
  const homeHref = role === "admin" ? "/admin" : "/teacher";
  const roleTitle = role === "admin" ? "管理工作台" : "教师工作台";
  const isActivePath = (href: string) => {
    if (role === "teacher" && href === "/teacher/roster" && (pathname === "/teacher/roster" || pathname.startsWith("/teacher/roster/") || pathname === "/teacher/progress" || pathname.startsWith("/teacher/progress/"))) return true;
    return href === homeHref ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  };
  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-main">{tc("跳到主要内容")}</a>
      <aside className="workspace-sidebar" aria-label={tc(role === "admin" ? "管理导航" : "教师导航") as string}>
        <BrandLockup />
        <div className="workspace-role-label">{tc(roleTitle)}</div>
        <nav className="workspace-nav" aria-label={tc("工作区导航") as string}>
          {items.map((item) => {
            const active = isActivePath(item.href);
            return <Link key={item.href} href={item.href} className={active ? "workspace-nav-link is-active" : "workspace-nav-link"} aria-current={active ? "page" : undefined}><Icon name={item.icon} size={19} /><span>{tc(item.label)}</span></Link>;
          })}
        </nav>
        <AccountControls user={user} compact homeHref={homeHref} homeLabel={role === "admin" ? "回到管理台" : "回到教师台"} />
      </aside>
      <div className="workspace-surface">
        <header className="workspace-mobile-header">
          <BrandLockup compact />
          <div className="workspace-mobile-title"><span>{tc(roleTitle)}</span><small>{tc("工作区")}</small></div>
          <AccountControls user={user} homeHref={homeHref} homeLabel={role === "admin" ? "回到管理台" : "回到教师台"} />
        </header>
        <nav className="workspace-mobile-nav" aria-label={tc("工作区导航") as string}>
          {items.map((item) => {
            const active = isActivePath(item.href);
            return <Link key={item.href} href={item.href} className={active ? "workspace-mobile-nav-link is-active" : "workspace-mobile-nav-link"} aria-current={active ? "page" : undefined}>{tc(item.label)}</Link>;
          })}
        </nav>
        <main id="workspace-main" className="workspace-main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
