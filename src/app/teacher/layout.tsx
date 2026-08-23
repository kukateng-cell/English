import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";
import { authServiceUnavailableLocation } from "@/lib/auth-service-unavailable";
import { getCurrentUser } from "@/lib/session";
import { ROLES, homePathFor } from "@/lib/roles";

/** Server-side role guard remains the source of truth for the teacher workspace. */
export default async function TeacherLayout({ children }: { children: ReactNode }) {
  const result = await getCurrentUser();
  if (!result.ok) {
    if (result.status === 401) redirect("/login?callbackUrl=/teacher");
    redirect(authServiceUnavailableLocation("/teacher"));
  }
  const { user } = result;
  if (user.role !== ROLES.TEACHER && user.role !== ROLES.ADMIN) redirect(homePathFor(user.role));
  return <WorkspaceShell role="teacher" user={user}>{children}</WorkspaceShell>;
}
