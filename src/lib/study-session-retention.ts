import { prisma, Prisma } from "@/lib/prisma";

/**
 * 歷史 V1 StudySession row 的保留邊界。
 *
 * V2 session 由 durable stream encounter 負責保存，因此清理只選取已過期、而且沒有
 * V2 stream item 的 V1 row。這是 maintenance reader／cleanup 邊界，不是 session issuance API。
 */
export const STUDY_SESSION_RETENTION_MS = 14 * 24 * 60 * 60_000;

export async function cleanupExpiredStudySessions(
  now = new Date(),
  batchSize = 1_000,
  db: Pick<Prisma.TransactionClient, "studySession"> = prisma,
) {
  const retentionCutoff = new Date(now.getTime() - STUDY_SESSION_RETENTION_MS);
  const where = {
    flowVersion: "v1",
    streamItems: { none: {} },
    expiresAt: { lte: retentionCutoff },
  };
  const expired = await db.studySession.findMany({
    where,
    orderBy: { expiresAt: "asc" },
    take: batchSize,
    select: { id: true },
  });
  if (expired.length === 0) return 0;
  const result = await db.studySession.deleteMany({
    where: { ...where, id: { in: expired.map((session) => session.id) } },
  });
  return result.count;
}
