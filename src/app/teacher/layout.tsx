import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";
import { getCurrentUser } from "@/lib/session";
import { ROLES, homePathFor } from "@/lib/roles";

/** Server-side role guard remains the source of truth for the teacher workspace. */
export default async function TeacherLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/teacher");
  if (user.role !== ROLES.TEACHER && user.role !== ROLES.ADMIN) redirect(homePathFor(user.role));
  return <WorkspaceShell role="teacher" user={user}>{children}</WorkspaceShell>;
}
