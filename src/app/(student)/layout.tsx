import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import StudentShell from "@/components/student/StudentShell";

export default async function StudentRouteLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/");
  if (user.role !== ROLES.STUDENT) return children;
  return <StudentShell user={user}>{children}</StudentShell>;
}
