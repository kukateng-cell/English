import { redirect } from "next/navigation";
import { authServiceUnavailableLocation } from "@/lib/auth-service-unavailable";
import { getCurrentUser } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import StudentDashboard from "@/components/student/StudentDashboard";

export default async function StudentHomePage() {
  const result = await getCurrentUser();
  if (!result.ok) {
    if (result.status === 401) redirect("/login?callbackUrl=/");
    redirect(authServiceUnavailableLocation("/"));
  }
  const { user } = result;
  if (user.role !== ROLES.STUDENT) redirect(user.role === ROLES.ADMIN ? "/admin" : "/teacher");
  return <StudentDashboard userId={user.id} />;
}
