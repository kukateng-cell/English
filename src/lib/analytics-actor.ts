import type { Prisma, Role } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

type ReportingDb = typeof prisma | Prisma.TransactionClient;

export type ReportingActor = {
  role: Role;
  status: "ACTIVE" | "SUSPENDED";
  tokenVersion: number;
  credentialRevision: number;
  accessRevision: number | null;
};

/** Read the authorization snapshot shared by teacher analytics and reward reports. */
export async function readReportingActor(
  db: ReportingDb,
  input: { userId: string; role: Role },
): Promise<ReportingActor> {
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: {
      role: true,
      status: true,
      tokenVersion: true,
      credentialRevision: true,
      teacherProfile: { select: { accessRevision: true } },
    },
  });
  if (!user || user.role !== input.role) throw new Error("ROLE_FORBIDDEN");
  if (user.status !== "ACTIVE") throw new Error("AUTH_REQUIRED");
  return {
    role: user.role,
    status: user.status,
    tokenVersion: user.tokenVersion,
    credentialRevision: user.credentialRevision,
    accessRevision: user.teacherProfile?.accessRevision ?? null,
  };
}
