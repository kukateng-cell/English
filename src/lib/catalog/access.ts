import { Prisma, prisma } from "@/lib/prisma";
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

export async function requireCatalogReviewerInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  // Keep the authority read and catalog decision in one transaction so a
  // concurrent suspension or capability revoke cannot race the mutation.
  if (!await catalogReviewerHasAuthorityInTransaction(tx, userId)) {
    throw new Error("CATALOG_REVIEW_FORBIDDEN");
  }
}

export async function catalogReviewerHasAuthorityInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const actor = await tx.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      status: true,
      teacherProfile: { select: { canManageWordCatalog: true } },
    },
  });
  if (!actor || actor.status !== "ACTIVE") return false;
  return actor.role === ROLES.ADMIN
    || (actor.role === ROLES.TEACHER && actor.teacherProfile?.canManageWordCatalog === true);
}
