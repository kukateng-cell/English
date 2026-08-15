import type { Prisma } from "@/lib/prisma";
import { prisma } from "@/lib/prisma";
import { ROLES, type Role } from "@/lib/roles";

export type TeacherStudentCapability =
  | "VIEW_PROGRESS"
  | "RESET_STUDENT_PASSWORD";

function capabilityWhere(capability?: TeacherStudentCapability) {
  return capability === "RESET_STUDENT_PASSWORD"
    ? {
        canViewProgress: true,
        canResetStudentPassword: true,
      }
    : { canViewProgress: true };
}

/** One object-level scope shared by every teacher student read route. */
export function authorizedStudentWhere(input: {
  userId: string;
  role: Role;
  capability?: TeacherStudentCapability;
  includeSuspended?: boolean;
}): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = {
    role: ROLES.STUDENT,
    ...(input.includeSuspended ? {} : { status: "ACTIVE" }),
  };
  if (input.role === ROLES.ADMIN) return base;

  return {
    ...base,
    studentProfile: {
      is: {
        enrollments: {
          some: {
            status: "ACTIVE",
            academicYear: { status: "CURRENT" },
            classId: { not: null },
            schoolClass: {
              is: {
                active: true,
                academicYear: { status: "CURRENT" },
                teacherAccess: {
                  some: {
                    teacherId: input.userId,
                    ...capabilityWhere(input.capability),
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

export async function teacherCanAccessStudent(
  tx: Prisma.TransactionClient,
  input: {
    teacherId: string;
    studentId: string;
    capability?: TeacherStudentCapability;
    includeSuspended?: boolean;
  },
): Promise<boolean> {
  const student = await tx.user.findFirst({
    where: {
      id: input.studentId,
      ...authorizedStudentWhere({
        userId: input.teacherId,
        role: ROLES.TEACHER,
        capability: input.capability,
        includeSuspended: input.includeSuspended,
      }),
    },
    select: { id: true },
  });
  return Boolean(student);
}

export async function teacherActorIsActive(
  tx: Prisma.TransactionClient | typeof prisma,
  teacherId: string,
): Promise<boolean> {
  const actor = await tx.user.findFirst({ where: { id: teacherId, role: ROLES.TEACHER, status: "ACTIVE", teacherProfile: { isNot: null } }, select: { id: true } });
  return Boolean(actor);
}
