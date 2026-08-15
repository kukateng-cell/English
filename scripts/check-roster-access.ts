import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { authorizedStudentWhere } = await import("../src/lib/teacher-access");
  const suffix = randomUUID();
  const createdUserIds: string[] = [];
  let yearId: string | null = null;
  try {
    const year = await prisma.academicYear.findFirst({ where: { status: "CURRENT" } });
    if (!year) throw new Error("current academic year fixture is required");
    yearId = year.id;
    const [classA, classB] = await Promise.all([
      prisma.schoolClass.create({ data: { academicYearId: year.id, grade: "JUNIOR_1", classCode: "B" } }),
      prisma.schoolClass.create({ data: { academicYearId: year.id, grade: "JUNIOR_1", classCode: "C" } }),
    ]);
    const teacher = await prisma.user.create({
      data: {
        accountName: `access-teacher-${suffix}`,
        accountNameCanonical: `access-teacher-${suffix}`,
        passwordHash: "not-a-login-account",
        credentialRevision: 1,
        role: "TEACHER",
        mustChangePassword: false,
        teacherProfile: { create: { legalName: "權限測試老師" } },
      },
    });
    createdUserIds.push(teacher.id);
    const students = await Promise.all(
      [classA, classB].map((schoolClass, index) =>
        prisma.user.create({
          data: {
            accountName: `access-student-${index}-${suffix}`,
            accountNameCanonical: `access-student-${index}-${suffix}`,
            passwordHash: "not-a-login-account",
            credentialRevision: 1,
            mustChangePassword: false,
            studentProfile: {
              create: {
                legalName: `權限測試學生${index}`,
                nickname: `權限測試生${index}`,
                nicknameNormalized: `權限測試生${index}`,
                enrollments: {
                  create: {
                    academicYearId: year.id,
                    grade: "JUNIOR_1",
                    classId: schoolClass.id,
                    status: "ACTIVE",
                    origin: "SEED",
                    startedAt: new Date(),
                  },
                },
              },
            },
          },
        }),
      ),
    );
    createdUserIds.push(...students.map((student) => student.id));
    await prisma.teacherClassAccess.create({
      data: {
        teacherId: teacher.id,
        classId: classA.id,
        canViewProgress: true,
        canResetStudentPassword: false,
      },
    });

    const visible = await prisma.user.findMany({
      where: authorizedStudentWhere({ userId: teacher.id, role: "TEACHER" }),
      select: { id: true },
    });
    if (visible.length !== 1 || visible[0].id !== students[0].id) {
      throw new Error("teacher class visibility escaped its assigned class");
    }
    const resetDenied = await prisma.user.count({
      where: authorizedStudentWhere({
        userId: teacher.id,
        role: "TEACHER",
        capability: "RESET_STUDENT_PASSWORD",
      }),
    });
    if (resetDenied !== 0) throw new Error("reset capability was inferred from view access");
    await prisma.teacherClassAccess.update({
      where: { teacherId_classId: { teacherId: teacher.id, classId: classA.id } },
      data: { canResetStudentPassword: true },
    });
    const resetAllowed = await prisma.user.count({
      where: authorizedStudentWhere({
        userId: teacher.id,
        role: "TEACHER",
        capability: "RESET_STUDENT_PASSWORD",
      }),
    });
    if (resetAllowed !== 1) throw new Error("explicit reset capability was not applied");
    await prisma.user.update({ where: { id: students[0].id }, data: { status: "SUSPENDED", suspendedAt: new Date(), suspendedReason: "fixture" } });
    const activeVisible = await prisma.user.count({
      where: authorizedStudentWhere({ userId: teacher.id, role: "TEACHER" }),
    });
    if (activeVisible !== 0) throw new Error("suspended student remained visible");
    console.log("Roster class-access isolation check passed");
  } finally {
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (yearId) {
      await prisma.schoolClass.deleteMany({ where: { academicYearId: yearId, classCode: { in: ["B", "C"] } } });
    }
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
