import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const userIds: string[] = [];
  const yearIds: string[] = [];
  const classIds: string[] = [];
  let immediateYearCreated = false;
  try {
    const testYearStart = 2400 + (Number.parseInt(suffix.slice(0, 1), 16) % 8);
    const planned = await prisma.academicYear.create({
      data: {
        label: `${testYearStart}-${testYearStart + 1}`,
        startsOn: new Date(`${testYearStart}-09-01T00:00:00.000Z`),
        endsOn: new Date(`${testYearStart + 1}-08-31T00:00:00.000Z`),
        status: "PLANNED",
        isCurrent: false,
      },
    });
    yearIds.push(planned.id);
    const current = await prisma.academicYear.findFirstOrThrow({ where: { status: "CURRENT" } });
    const existingImmediate = await prisma.academicYear.findFirst({
      where: { status: "PLANNED", startsOn: { gt: current.endsOn } },
      orderBy: [{ startsOn: "asc" }, { id: "asc" }],
    });
    const immediate = existingImmediate ?? await prisma.academicYear.create({
      data: {
        label: `${current.endsOn.getUTCFullYear()}-${current.endsOn.getUTCFullYear() + 1}`,
        startsOn: new Date(current.endsOn.getTime() + 24 * 60 * 60 * 1_000),
        endsOn: new Date(current.endsOn.getTime() + 366 * 24 * 60 * 60 * 1_000),
        status: "PLANNED",
        isCurrent: false,
      },
    });
    immediateYearCreated = !existingImmediate;
    if (immediateYearCreated) yearIds.push(immediate.id);

    const currentClasses: Record<"A" | "B", { id: string }> = {} as Record<"A" | "B", { id: string }>;
    for (const classCode of ["A", "B"] as const) {
      const existingClass = await prisma.schoolClass.findFirst({ where: { academicYearId: current.id, grade: "JUNIOR_1", classCode } });
      currentClasses[classCode] = existingClass ?? await prisma.schoolClass.create({
        data: { academicYearId: current.id, grade: "JUNIOR_1", classCode, active: true },
        select: { id: true },
      });
      if (!existingClass) classIds.push(currentClasses[classCode].id);
    }
    const user = await prisma.user.create({
      data: {
        accountName: `invariant-${suffix}`,
        accountNameCanonical: `invariant-${suffix}`,
        passwordHash: "not-a-login-account",
        credentialRevision: 1,
        mustChangePassword: false,
        studentProfile: {
          create: { legalName: "Invariant Student", nickname: "測試同學", nicknameNormalized: "測試同學" },
        },
      },
      select: { id: true },
    });
    userIds.push(user.id);

    await assert.rejects(
      prisma.studentEnrollment.create({
        data: {
          studentId: user.id,
          academicYearId: planned.id,
          grade: "JUNIOR_1",
          isCurrent: false,
          status: "ACTIVE",
          origin: "MANUAL",
          startedAt: new Date(),
        },
      }),
      "ACTIVE enrollment in PLANNED year must fail",
    );

    await assert.rejects(
      prisma.studentEnrollment.create({
        data: {
          studentId: user.id,
          academicYearId: current.id,
          grade: "JUNIOR_1",
          isCurrent: true,
          status: "ENDED",
          origin: "MANUAL",
          startedAt: new Date(Date.now() - 1_000),
          endedAt: new Date(),
        },
      }),
      "raw ENDED enrollment in CURRENT year must fail",
    );

    let assignedNumber = 900000;
    while (await prisma.studentEnrollment.findFirst({ where: { academicYearId: current.id, studentNumber: assignedNumber } })) assignedNumber += 1;
    const activeEnrollment = await prisma.studentEnrollment.create({
      data: {
        studentId: user.id,
        academicYearId: current.id,
        grade: "JUNIOR_1",
        classId: currentClasses.A.id,
        studentNumber: assignedNumber,
        isCurrent: true,
        status: "ACTIVE",
        origin: "MANUAL",
        startedAt: new Date(Date.now() - 1_000),
      },
    });

    // The application parser also validates this field, but these checks
    // deliberately bypass Prisma so the database constraint itself is
    // exercised for zero, negative, decimal, and text values.
    await assert.rejects(
      prisma.$executeRaw`UPDATE "StudentEnrollment" SET "studentNumber" = 0 WHERE "id" = ${activeEnrollment.id}`,
      "database must reject student number 0",
    );
    await assert.rejects(
      prisma.$executeRaw`UPDATE "StudentEnrollment" SET "studentNumber" = -1 WHERE "id" = ${activeEnrollment.id}`,
      "database must reject negative student numbers",
    );
    await assert.rejects(
      prisma.$executeRaw`UPDATE "StudentEnrollment" SET "studentNumber" = '1.5' WHERE "id" = ${activeEnrollment.id}`,
      "database must reject decimal student numbers",
    );
    await assert.rejects(
      prisma.$executeRaw`UPDATE "StudentEnrollment" SET "studentNumber" = 'not-a-number' WHERE "id" = ${activeEnrollment.id}`,
      "database must reject text student numbers",
    );

    const makeStudent = async (label: string) => {
      const created = await prisma.user.create({
        data: {
          accountName: `invariant-${label}-${suffix}`,
          accountNameCanonical: `invariant-${label}-${suffix}`,
          passwordHash: "not-a-login-account",
          credentialRevision: 1,
          mustChangePassword: false,
          studentProfile: { create: { legalName: `Invariant ${label}`, nickname: `測試${label}`, nicknameNormalized: `測試${label}` } },
        },
        select: { id: true },
      });
      userIds.push(created.id);
      return created.id;
    };
    const crossClassStudent = await makeStudent("CrossClass");
    await prisma.studentEnrollment.create({
      data: {
        studentId: crossClassStudent,
        academicYearId: current.id,
        grade: "JUNIOR_1",
        classId: currentClasses.B.id,
        studentNumber: assignedNumber,
        isCurrent: true,
        status: "ACTIVE",
        origin: "MANUAL",
        startedAt: new Date(),
      },
    });

    const sameClassDuplicate = await makeStudent("SameClassDuplicate");
    await assert.rejects(
      prisma.studentEnrollment.create({
        data: {
          studentId: sameClassDuplicate,
          academicYearId: current.id,
          grade: "JUNIOR_1",
          classId: currentClasses.A.id,
          studentNumber: assignedNumber,
          isCurrent: true,
          status: "ACTIVE",
          origin: "MANUAL",
          startedAt: new Date(),
        },
      }),
      "same academic year and class must reject duplicate student numbers",
    );

    let unassignedNumber = assignedNumber + 1;
    while (await prisma.studentEnrollment.findFirst({ where: { academicYearId: current.id, classId: null, studentNumber: unassignedNumber } })) unassignedNumber += 1;
    const firstUnassigned = await makeStudent("UnassignedOne");
    await prisma.studentEnrollment.create({
      data: {
        studentId: firstUnassigned,
        academicYearId: current.id,
        grade: "JUNIOR_1",
        studentNumber: unassignedNumber,
        isCurrent: true,
        status: "ACTIVE",
        origin: "MANUAL",
        startedAt: new Date(),
      },
    });
    const secondUnassigned = await makeStudent("UnassignedTwo");
    await assert.rejects(
      prisma.studentEnrollment.create({
        data: {
          studentId: secondUnassigned,
          academicYearId: current.id,
          grade: "JUNIOR_2",
          studentNumber: unassignedNumber,
          isCurrent: true,
          status: "ACTIVE",
          origin: "MANUAL",
          startedAt: new Date(),
        },
      }),
      "unassigned students in one academic year must reject duplicate student numbers",
    );
    await assert.rejects(
      prisma.studentEnrollment.update({ where: { id: activeEnrollment.id }, data: { status: "ENDED", endedAt: new Date() } }),
      "ordinary writer cannot end an active current enrollment",
    );

    await assert.rejects(
      prisma.academicYear.update({ where: { id: planned.id }, data: { status: "CURRENT" } }),
      "ordinary writer cannot change academic year lifecycle",
    );

    await assert.rejects(
      prisma.studentEnrollment.create({
        data: { studentId: user.id, academicYearId: planned.id, grade: "JUNIOR_1", isCurrent: false, status: "PLANNED", origin: "MANUAL" },
      }),
      "planned enrollment in a non-successor future year must fail",
    );

    const inactiveClass = await prisma.schoolClass.create({
      data: { academicYearId: planned.id, grade: "JUNIOR_1", classCode: "H", active: false },
    });
    classIds.push(inactiveClass.id);
    const teacher = await prisma.user.create({
      data: {
        accountName: `invariant-teacher-${suffix}`,
        accountNameCanonical: `invariant-teacher-${suffix}`,
        passwordHash: "not-a-login-account",
        credentialRevision: 1,
        mustChangePassword: false,
        role: "TEACHER",
        teacherProfile: { create: { legalName: "Invariant Teacher" } },
      },
      select: { id: true },
    });
    userIds.push(teacher.id);
    await assert.rejects(
      prisma.studentProfile.create({ data: { userId: teacher.id, legalName: "Wrong Role", nickname: "錯誤角色", nicknameNormalized: "錯誤角色" } }),
      "student profile for a teacher role must fail",
    );
    await assert.rejects(
      prisma.teacherProfile.create({ data: { userId: user.id, legalName: "Wrong Role Teacher" } }),
      "teacher profile for a student role must fail",
    );
    await assert.rejects(
      prisma.teacherClassAccess.create({
        data: { teacherId: teacher.id, classId: inactiveClass.id, canViewProgress: true },
      }),
      "teacher access to inactive class must fail",
    );

    // Planned-first incoming students are allowed while they have no current
    // source, but adding the current enrollment later must be atomic with its
    // matching transition.  This exercises the reverse completeness invariant
    // used by the manual and import writers.
    const plannedFirst = await prisma.user.create({
      data: {
        accountName: `planned-first-${suffix}`,
        accountNameCanonical: `planned-first-${suffix}`,
        passwordHash: "not-a-login-account",
        credentialRevision: 1,
        mustChangePassword: false,
        studentProfile: { create: { legalName: "Planned First", nickname: "先入学生", nicknameNormalized: "先入学生" } },
      },
      select: { id: true },
    });
    userIds.push(plannedFirst.id);
    const plannedFirstEnrollment = await prisma.studentEnrollment.create({
      data: { studentId: plannedFirst.id, academicYearId: immediate.id, grade: "JUNIOR_2", isCurrent: false, status: "PLANNED", origin: "IMPORT" },
      select: { id: true },
    });
    await assert.rejects(
      prisma.studentEnrollment.create({
        data: { studentId: plannedFirst.id, academicYearId: current.id, grade: "JUNIOR_1", isCurrent: true, status: "ACTIVE", origin: "IMPORT", startedAt: new Date() },
      }),
      "planned-first current enrollment without a transition must fail",
    );
    await prisma.$transaction(async (tx) => {
      const sourceEnrollment = await tx.studentEnrollment.create({
        data: { studentId: plannedFirst.id, academicYearId: current.id, grade: "JUNIOR_1", isCurrent: true, status: "ACTIVE", origin: "IMPORT", startedAt: new Date() },
      });
      await tx.studentYearTransition.create({
        data: {
          studentId: plannedFirst.id,
          sourceEnrollmentId: sourceEnrollment.id,
          sourceAcademicYearId: current.id,
          targetAcademicYearId: immediate.id,
          disposition: "PROMOTE",
          targetEnrollmentId: plannedFirstEnrollment.id,
        },
      });
    });

    const closed = await prisma.academicYear.create({
      data: {
        label: `${testYearStart + 20}-${testYearStart + 21}`,
        startsOn: new Date(`${testYearStart + 20}-09-01T00:00:00.000Z`),
        endsOn: new Date(`${testYearStart + 21}-08-31T00:00:00.000Z`),
        status: "CLOSED",
        isCurrent: false,
      },
    });
    yearIds.push(closed.id);
    const closedClass = await prisma.schoolClass.create({
      data: { academicYearId: closed.id, grade: "JUNIOR_1", classCode: "A", active: true },
    });
    classIds.push(closedClass.id);
    await assert.rejects(
      prisma.academicYear.update({ where: { id: closed.id }, data: { label: "2301-2302" } }),
      "closed academic year dates must be immutable",
    );
    await assert.rejects(
      prisma.schoolClass.update({ where: { id: closedClass.id }, data: { active: false } }),
      "closed year class must be immutable",
    );
    await assert.rejects(
      prisma.teacherClassAccess.create({ data: { teacherId: teacher.id, classId: closedClass.id, canViewProgress: true } }),
      "teacher access into a closed year must fail",
    );

    console.log("Roster raw DB invariant checks passed");
  } finally {
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.roster_hard_delete', 'on', true)`;
      await tx.$executeRaw`SELECT set_config('app.roster_activation', 'on', true)`;
      if (classIds.length) await tx.schoolClass.deleteMany({ where: { id: { in: classIds } } });
      if (yearIds.length) await tx.academicYear.deleteMany({ where: { id: { in: yearIds } } });
    }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
