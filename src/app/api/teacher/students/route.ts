import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { MASTERED_MIN_INTERVAL } from "@/lib/mastered";
import { authorizedStudentWhere, teacherActorIsActive } from "@/lib/teacher-access";

export async function GET() {
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  if (auth.role === ROLES.TEACHER && !(await teacherActorIsActive(prisma, auth.userId))) return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });

  try {
    const studentWhere = authorizedStudentWhere({
      userId: auth.userId,
      role: auth.role,
    });
    // totalReviews：评测事件数，而不是「有 Review 状态的不同单词数」。
    const students = await prisma.user.findMany({
      where: studentWhere,
      select: {
        id: true,
        accountName: true,
        studentProfile: {
          select: {
            legalName: true,
            nickname: true,
            enrollments: {
              where: { status: "ACTIVE", academicYear: { status: "CURRENT" } },
              take: 1,
              select: {
                grade: true,
                schoolClass: {
                  select: {
                    grade: true,
                    classCode: true,
                    teacherAccess: {
                      where: { teacherId: auth.userId },
                      select: { canResetStudentPassword: true },
                    },
                  },
                },
              },
            },
          },
        },
        _count: { select: { reviewEvents: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const totalWords = await prisma.word.count();
    const wordsByLevel = await prisma.word.groupBy({ by: ["level"], _count: true });
    const levelWordCounts: Record<string, number> = {};
    for (const l of wordsByLevel) levelWordCounts[l.level] = l._count;

    // 只取「已掌握」(interval >= MASTERED_MIN_INTERVAL，与排行榜共用同一判定) 的
    // Review 行，where 下推到 DB；这里只传输满足条件的子集（而非全部 Review），
    // 再在内存按 (学生, 级别) 聚合。
    const masteredRows = await prisma.review.findMany({
      where: { user: studentWhere, interval: { gte: MASTERED_MIN_INTERVAL } },
      select: {
        userId: true,
        word: { select: { level: true } },
      },
    });

    // 按 (userId) 与 (userId, level) 聚合「已掌握」数量
    const masteredByUser = new Map<string, number>();
    const masteredByUserLevel = new Map<string, number>();
    for (const r of masteredRows) {
      masteredByUser.set(r.userId, (masteredByUser.get(r.userId) ?? 0) + 1);
      const lvl = r.word.level as string;
      const key = `${r.userId}::${lvl}`;
      masteredByUserLevel.set(key, (masteredByUserLevel.get(key) ?? 0) + 1);
    }

    return NextResponse.json(
      students.map((s) => {
        const mastered = masteredByUser.get(s.id) ?? 0;

        const byLevel = wordsByLevel.map((l) => {
          const lvlMastered =
            masteredByUserLevel.get(`${s.id}::${l.level as string}`) ?? 0;
          return {
            level: l.level,
            mastered: lvlMastered,
            total: l._count,
            progress: l._count > 0 ? Math.round((lvlMastered / l._count) * 100) : 0,
          };
        });

        return {
          id: s.id,
          name: s.studentProfile?.legalName ?? s.accountName,
          nickname: s.studentProfile?.nickname ?? "",
          email: s.accountName,
          accountName: s.accountName,
          grade: s.studentProfile?.enrollments[0]?.grade ?? null,
          classCode:
            s.studentProfile?.enrollments[0]?.schoolClass?.classCode ?? null,
          canResetStudentPassword:
            auth.role === ROLES.ADMIN ||
            Boolean(s.studentProfile?.enrollments[0]?.schoolClass?.teacherAccess?.some((access) => access.canResetStudentPassword)),
          totalReviews: s._count.reviewEvents,
          masteredWords: mastered,
          totalWords,
          progress: totalWords > 0 ? Math.round((mastered / totalWords) * 100) : 0,
          byLevel,
        };
      })
    );
  } catch {
    return NextResponse.json({ error: "获取学生数据失败" }, { status: 500 });
  }
}
