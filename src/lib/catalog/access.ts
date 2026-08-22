import { prisma } from "@/lib/prisma";
import type { AuthResult } from "@/lib/session";
import { ROLES } from "@/lib/roles";

export type CatalogActor = Extract<AuthResult, { ok: true }>;

export async function catalogAccess(actor: CatalogActor): Promise<{
  canRead: true;
  canSubmit: true;
  canReview: boolean;
}> {
  if (actor.role === ROLES.ADMIN) return { canRead: true, canSubmit: true, canReview: true };
  const profile = await prisma.teacherProfile.findUnique({
    where: { userId: actor.userId },
    select: { canManageWordCatalog: true },
  });
  return {
    canRead: true,
    canSubmit: true,
    canReview: profile?.canManageWordCatalog === true,
  };
}
