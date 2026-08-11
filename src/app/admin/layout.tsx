import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";
import { getCurrentUser } from "@/lib/session";
import { ROLES, homePathFor } from "@/lib/roles";

/** Server-side role guard remains the source of truth for the admin workspace. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/admin");
  if (user.role !== ROLES.ADMIN) redirect(homePathFor(user.role));
  return <WorkspaceShell role="admin" user={user}>{children}</WorkspaceShell>;
}
