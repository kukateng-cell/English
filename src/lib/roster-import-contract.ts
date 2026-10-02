import type { ClassCode, StudentGrade } from "@/generated/prisma";

export type StagedStudentRow = {
  entityType: "STUDENT";
  rowNumber: number;
  action: "CREATE" | "UPDATE" | "UNCHANGED" | "ERROR";
  accountName: string;
  legalName: string;
  nickname: string;
  nicknameNormalized: string;
  contactEmail: string | null;
  contactEmailAction?: "SET" | "PRESERVE" | "CLEAR";
  grade: StudentGrade | null;
  classCode: ClassCode | null;
  studentNumber: number | null;
  studentNumberAction?: "SET" | "PRESERVE" | "CLEAR";
  errors: string[];
  diff?: Record<string, { before: string | null; after: string | null }>;
};

export type StagedTeacherRow = {
  entityType: "TEACHER";
  rowNumber: number;
  action: "CREATE" | "UPDATE" | "UNCHANGED" | "ERROR";
  accountName: string;
  legalName: string;
  contactEmail: string | null;
  contactEmailAction?: "SET" | "PRESERVE" | "CLEAR";
  accessAction?: "REPLACE" | "PRESERVE";
  templateVersion?: "teacher-roster-v2" | "v1";
  canResetStudentPassword?: boolean;
  access: Array<{
    grade: StudentGrade;
    classCode: ClassCode;
  }>;
  errors: string[];
  diff?: Record<string, { before: string | null; after: string | null }>;
};

export type StagedRosterRow = StagedStudentRow | StagedTeacherRow;

export function isStagedRosterRows(value: unknown): value is StagedRosterRow[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        (Reflect.get(row, "entityType") === "STUDENT" ||
          Reflect.get(row, "entityType") === "TEACHER") &&
        typeof Reflect.get(row, "accountName") === "string" &&
        Array.isArray(Reflect.get(row, "errors")),
    )
  );
}
