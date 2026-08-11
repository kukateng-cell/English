import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import StudentDashboard from "@/components/student/StudentDashboard";

export default async function StudentHomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/");
  if (user.role !== ROLES.STUDENT) redirect(user.role === ROLES.ADMIN ? "/admin" : "/teacher");
  return <StudentDashboard userId={user.id} />;
}
