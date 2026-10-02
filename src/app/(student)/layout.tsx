import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { authServiceUnavailableLocation } from "@/lib/auth-service-unavailable";
import { getCurrentUser } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import StudentShell from "@/components/student/StudentShell";

export default async function StudentRouteLayout({ children }: { children: ReactNode }) {
  const result = await getCurrentUser();
  if (!result.ok) {
    if (result.status === 401) redirect("/login?callbackUrl=/");
    redirect(authServiceUnavailableLocation("/"));
  }
  const { user } = result;
  if (user.role !== ROLES.STUDENT) return children;
  return <StudentShell user={user}>{children}</StudentShell>;
}
