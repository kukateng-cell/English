import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const { prisma, Prisma } = await import("../src/lib/prisma");
  const { issueRecentAuthGrant, revokeRecentAuthGrants, hashSessionJti } = await import("../src/lib/recent-auth");
  const { replacePasswordCredential } = await import("../src/lib/password-credentials");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  let userId = "";
  try {
    const user = await prisma.user.create({
      data: {
        accountName: `auth-lifecycle-${suffix}`,
        accountNameCanonical: `auth-lifecycle-${suffix}`,
        passwordHash: "not-a-login-account",
        credentialRevision: 1,
        mustChangePassword: false,
        role: "TEACHER",
        teacherProfile: { create: { legalName: "Auth Lifecycle Teacher" } },
      },
      select: { id: true, tokenVersion: true, credentialRevision: true },
    });
    userId = user.id;
    const now = new Date("2026-08-15T00:00:00.000Z");
    await prisma.$transaction(async (tx) => {
      await issueRecentAuthGrant(tx, { sessionJti: "device-a", userId, tokenVersion: user.tokenVersion, credentialRevision: user.credentialRevision, now });
      await issueRecentAuthGrant(tx, { sessionJti: "device-b", userId, tokenVersion: user.tokenVersion, credentialRevision: user.credentialRevision, now });
    });
    assert.equal(await prisma.recentAuthGrant.count({ where: { userId } }), 2);
    assert.notEqual(hashSessionJti("device-a"), hashSessionJti("device-b"));
    const expired = await prisma.recentAuthGrant.findUniqueOrThrow({ where: { id: hashSessionJti("device-a") } });
    assert.equal(expired.expiresAt.getTime(), now.getTime() + 15 * 60_000);

    const freshHash = await bcrypt.hash("temporary-password", 4);
    await prisma.$transaction(async (tx) => {
      const ok = await replacePasswordCredential(tx, {
        userId,
        passwordHash: freshHash,
        mustChangePassword: true,
        expectedTokenVersion: user.tokenVersion,
        expectedCredentialRevision: user.credentialRevision,
      });
      assert.equal(ok, true);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const rotated = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenVersion: true, credentialRevision: true, mustChangePassword: true } });
    assert.equal(rotated.tokenVersion, user.tokenVersion + 1);
    assert.equal(rotated.credentialRevision, user.credentialRevision + 1);
    assert.equal(rotated.mustChangePassword, true);
    assert.equal(await prisma.recentAuthGrant.count({ where: { userId } }), 0);

    await prisma.$transaction(async (tx) => {
      await issueRecentAuthGrant(tx, { sessionJti: "device-a", userId, tokenVersion: rotated.tokenVersion, credentialRevision: rotated.credentialRevision, now });
      await issueRecentAuthGrant(tx, { sessionJti: "device-b", userId, tokenVersion: rotated.tokenVersion, credentialRevision: rotated.credentialRevision, now });
      await revokeRecentAuthGrants(tx, userId);
    });
    assert.equal(await prisma.recentAuthGrant.count({ where: { userId } }), 0);
    console.log("Roster session-bound recent-auth check passed");
  } finally {
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "roster-auth-check-failed");
  process.exitCode = 1;
});
