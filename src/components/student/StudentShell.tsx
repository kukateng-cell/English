"use client";

import type { ReactNode } from "react";
import StudentNav from "./StudentNav";
import AccountControls from "./AccountControls";
import {
  StudentNavigationProvider,
  useStudentNavigation,
} from "./StudentNavigationContext";
import BrandLockup from "@/components/brand/BrandLockup";
import type { Role } from "@/lib/roles";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useLocale } from "@/components/LocaleProvider";

export default function StudentShell({
  children,
  user,
}: {
  children: ReactNode;
  user: { name: string | null; email: string; role: Role };
}) {
  const pathname = usePathname();
  const isStudyRoute = pathname.startsWith("/study");
  return (
    <StudentNavigationProvider>
      <StudentShellFrame isStudyRoute={isStudyRoute} user={user}>
        {children}
      </StudentShellFrame>
    </StudentNavigationProvider>
  );
}

function StudentShellFrame({
  children,
  isStudyRoute,
  user,
}: {
  children: ReactNode;
  isStudyRoute: boolean;
  user: { name: string | null; email: string; role: Role };
}) {
  const { tc } = useLocale();
  const {
    state: navigationState,
    resetStudyNavigationState,
  } = useStudentNavigation();

  useEffect(() => {
    if (!isStudyRoute) resetStudyNavigationState();
  }, [isStudyRoute, resetStudyNavigationState]);

  const backgroundInert = navigationState.dialogOpen;
  return (
    <div
      className={isStudyRoute ? "student-shell is-study" : "student-shell"}
      data-study-navigation-phase={navigationState.active ? navigationState.phase ?? undefined : undefined}
      data-study-navigation-blocked={navigationState.navigationBlocked ? "true" : undefined}
    >
      <a className="skip-link" href="#main-content">{tc("跳到主要內容")}</a>
      <aside className="student-rail" aria-label={tc("學生導航")} inert={backgroundInert || undefined}>
        <div className="student-rail-top">
          <BrandLockup />
          <StudentNav mode="rail" />
        </div>
        <AccountControls user={user} compact />
      </aside>
      <div className="student-surface">
        {!isStudyRoute ? <header className="student-mobile-header"><BrandLockup compact /><AccountControls user={user} /></header> : null}
        <main id="main-content" className="student-main" tabIndex={-1}>{children}</main>
        <div className="student-nav-bottom-layer" data-testid="student-nav-bottom-layer" inert={backgroundInert || undefined}>
          <StudentNav mode="bottom" />
        </div>
      </div>
    </div>
  );
}
