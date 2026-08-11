"use client";

import type { ReactNode } from "react";
import StudentNav from "./StudentNav";
import AccountControls from "./AccountControls";
import BrandLockup from "@/components/brand/BrandLockup";
import type { Role } from "@/lib/roles";
import { usePathname } from "next/navigation";
import { useLocale } from "@/components/LocaleProvider";

export default function StudentShell({
  children,
  user,
}: {
  children: ReactNode;
  user: { name: string | null; email: string; role: Role };
}) {
  const pathname = usePathname();
  const { tc } = useLocale();
  const immersive = pathname.startsWith("/study");
  return (
    <div className={immersive ? "student-shell is-immersive" : "student-shell"}>
      <a className="skip-link" href="#main-content">{tc("跳到主要内容")}</a>
      <aside className="student-rail" aria-label={tc("学生导航")}>
        <div className="student-rail-top">
          <BrandLockup />
          {immersive ? null : <StudentNav mode="rail" />}
        </div>
        <AccountControls user={user} compact />
      </aside>
      <div className="student-surface">
        {immersive ? null : <header className="student-mobile-header"><BrandLockup compact /><AccountControls user={user} /></header>}
        <main id="main-content" className="student-main" tabIndex={-1}>{children}</main>
        {immersive ? null : <StudentNav mode="bottom" />}
      </div>
    </div>
  );
}
