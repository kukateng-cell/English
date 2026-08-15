import type { Prisma } from "@/generated/prisma";
import { revokeRecentAuthGrants } from "@/lib/recent-auth";

export const BCRYPT_COST = 12;

export function passwordCredentialCreateData(input: {
  passwordHash: string;
  mustChangePassword: boolean;
}) {
  return {
    passwordHash: input.passwordHash,
    mustChangePassword: input.mustChangePassword,
    credentialRevision: 1,
  };
}

/**
 * The only password-hash update primitive. Callers hash outside the
 * transaction, then this function conditionally updates the credential and
 * revokes every session-bound recent-auth grant in the same transaction.
 */
export async function replacePasswordCredential(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    passwordHash: string;
    mustChangePassword: boolean;
    expectedCredentialRevision?: number;
    expectedTokenVersion?: number;
  },
): Promise<boolean> {
  const result = await tx.user.updateMany({
    where: {
      id: input.userId,
      ...(input.expectedCredentialRevision === undefined
        ? {}
        : { credentialRevision: input.expectedCredentialRevision }),
      ...(input.expectedTokenVersion === undefined
        ? {}
        : { tokenVersion: input.expectedTokenVersion }),
    },
    data: {
      passwordHash: input.passwordHash,
      mustChangePassword: input.mustChangePassword,
      credentialRevision: { increment: 1 },
      tokenVersion: { increment: 1 },
    },
  });
  if (result.count !== 1) return false;
  await revokeRecentAuthGrants(tx, input.userId);
  return true;
}
