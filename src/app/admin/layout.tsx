import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";
import { authServiceUnavailableLocation } from "@/lib/auth-service-unavailable";
import { getCurrentUser } from "@/lib/session";
import { ROLES, homePathFor } from "@/lib/roles";

/** Server-side role guard remains the source of truth for the admin workspace. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const result = await getCurrentUser();
  if (!result.ok) {
    if (result.status === 401) redirect("/login?callbackUrl=/admin");
    redirect(authServiceUnavailableLocation("/admin"));
  }
  const { user } = result;
  if (user.role !== ROLES.ADMIN) redirect(homePathFor(user.role));
  return <WorkspaceShell role="admin" user={user}>{children}</WorkspaceShell>;
}
