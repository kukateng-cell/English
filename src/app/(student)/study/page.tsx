import { redirect } from "next/navigation";
import { authServiceUnavailableLocation } from "@/lib/auth-service-unavailable";
import { getCurrentUser } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import StudyStreamV2 from "@/components/study-stream/StudyStreamV2";

/**
 * The student study entry point is intentionally server-gated and V2-only.
 * Authentication and role checks happen before the interactive stream mounts;
 * the stream then owns its V2 session, action and recovery lifecycle.
 */
export default async function StudyPage() {
  const result = await getCurrentUser();
  if (!result.ok) {
    if (result.status === 401) redirect("/login?callbackUrl=/study");
    redirect(authServiceUnavailableLocation("/study"));
  }
  const { user } = result;
  if (user.role !== ROLES.STUDENT) {
    redirect(user.role === ROLES.ADMIN ? "/admin" : "/teacher");
  }
  return <StudyStreamV2 userId={user.id} />;
}
