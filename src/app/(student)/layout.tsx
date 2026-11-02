import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { authServiceUnavailableLocation } from "@/lib/auth-service-unavailable";
import { getCurrentUser } from "@/lib/session";
import { ROLES, homePathFor } from "@/lib/roles";
import StudentShell from "@/components/student/StudentShell";

export default async function StudentRouteLayout({ children }: { children: ReactNode }) {
  const result = await getCurrentUser();
  if (!result.ok) {
    if (result.status === 401) redirect("/login?callbackUrl=/");
    redirect(authServiceUnavailableLocation("/"));
  }
  const { user } = result;
  // 學生頁面只為學生設計；教師／管理員回到各自首頁，不渲染缺少導航的裸頁。
  if (user.role !== ROLES.STUDENT) redirect(homePathFor(user.role));
  return <StudentShell user={user}>{children}</StudentShell>;
}
