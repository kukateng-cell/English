import type { ClassCode, StudentGrade } from "@/generated/prisma";

export const STUDENT_GRADES = [
  "JUNIOR_1",
  "JUNIOR_2",
  "JUNIOR_3",
  "SENIOR_1",
  "SENIOR_2",
  "SENIOR_3",
] as const satisfies readonly StudentGrade[];

export const CLASS_CODES = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
] as const satisfies readonly ClassCode[];

/** Maximum number of selected students in one bulk/promotion mutation. */
export const MAX_ROSTER_SELECTION = 500;

/** Academic-year activation is all-or-nothing, so it has its own larger cap. */
export const MAX_YEAR_ACTIVATION_SELECTION = 5_000;

export function assertRosterSelectionCap(count: number): void {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_ROSTER_SELECTION) {
    throw new Error("SELECTION_CAP");
  }
}

export function assertYearActivationSelectionCap(count: number): void {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_YEAR_ACTIVATION_SELECTION) {
    throw new Error("ACTIVATION_SELECTION_CAP");
  }
}

export const GRADE_LABELS: Record<StudentGrade, string> = {
  JUNIOR_1: "初一",
  JUNIOR_2: "初二",
  JUNIOR_3: "初三",
  SENIOR_1: "高一",
  SENIOR_2: "高二",
  SENIOR_3: "高三",
};

export const CLASS_LABELS: Record<ClassCode, string> = {
  A: "甲",
  B: "乙",
  C: "丙",
  D: "丁",
  E: "戊",
  F: "己",
  G: "庚",
  H: "辛",
};

/** Stable, numeric roster ordering shared by every student directory. */
export type StudentNumberSortKey = {
  studentNumber: number | null;
  accountName: string;
  id: string;
};

export function compareStudentNumberSortKey(a: StudentNumberSortKey, b: StudentNumberSortKey) {
  if (a.studentNumber === null && b.studentNumber !== null) return 1;
  if (a.studentNumber !== null && b.studentNumber === null) return -1;
  if (a.studentNumber !== null && b.studentNumber !== null && a.studentNumber !== b.studentNumber) {
    return a.studentNumber - b.studentNumber;
  }
  return a.accountName.localeCompare(b.accountName, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id);
}

const GRADE_ALIASES = new Map<string, StudentGrade>([
  ...STUDENT_GRADES.map((grade) => [grade, grade] as const),
  ["初一", "JUNIOR_1"],
  ["初二", "JUNIOR_2"],
  ["初三", "JUNIOR_3"],
  ["高一", "SENIOR_1"],
  ["高二", "SENIOR_2"],
  ["高三", "SENIOR_3"],
  ["J1", "JUNIOR_1"],
  ["J2", "JUNIOR_2"],
  ["J3", "JUNIOR_3"],
  ["S1", "SENIOR_1"],
  ["S2", "SENIOR_2"],
  ["S3", "SENIOR_3"],
]);

const CLASS_ALIASES = new Map<string, ClassCode>([
  ...CLASS_CODES.map((code) => [code, code] as const),
  ...CLASS_CODES.map((code) => [CLASS_LABELS[code], code] as const),
]);

export function parseStudentGrade(value: unknown): StudentGrade | null {
  if (typeof value !== "string") return null;
  return GRADE_ALIASES.get(value.normalize("NFKC").trim().toUpperCase()) ?? null;
}

export function parseClassCode(value: unknown): ClassCode | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  return CLASS_ALIASES.get(value.normalize("NFKC").trim().toUpperCase()) ?? null;
}

/** Parse the optional numeric school number used by a year/class roster. */
export function parseStudentNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "number" && Number.isInteger(value)
    ? String(value)
    : typeof value === "string"
      ? value.normalize("NFKC").trim()
      : "";
  if (!/^\d{1,6}$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 999999 ? parsed : null;
}

/** Database uniqueness scope for an enrollment student number. */
export function studentNumberConflictKey(classId: string | null, studentNumber: number): string {
  return classId ? `CLASS:${classId}:${studentNumber}` : `UNASSIGNED:${studentNumber}`;
}

export function parseClassReference(value: string): {
  grade: StudentGrade;
  classCode: ClassCode;
} | null {
  const normalized = value.normalize("NFKC").trim();
  const separated = /^(.+?)[-\s]([A-H甲乙丙丁戊己庚辛])$/iu.exec(normalized);
  if (separated) {
    const grade = parseStudentGrade(separated[1]);
    const classCode = parseClassCode(separated[2]);
    return grade && classCode ? { grade, classCode } : null;
  }
  for (const [label, grade] of GRADE_ALIASES) {
    if (normalized.toUpperCase().startsWith(label)) {
      const classCode = parseClassCode(normalized.slice(label.length));
      if (classCode) return { grade, classCode };
    }
  }
  return null;
}

export function nextGrade(grade: StudentGrade): StudentGrade | null {
  const index = STUDENT_GRADES.indexOf(grade);
  return index >= 0 && index < STUDENT_GRADES.length - 1
    ? STUDENT_GRADES[index + 1]
    : null;
}

export type RolloverDisposition =
  | "PROMOTE"
  | "REPEAT"
  | "HOLD_UNASSIGNED"
  | "GRADUATE"
  | "LEAVE";

/**
 * Derive the only non-terminal disposition that can describe a source
 * enrollment and its already-staged target enrollment.  Keeping this rule in
 * one pure helper prevents import, manual restore and promotion writers from
 * assigning conflicting meanings to an unassigned target class.
 */
export function deriveRolloverDisposition(
  sourceGrade: StudentGrade,
  targetGrade: StudentGrade,
  targetClassId: string | null | undefined,
): Exclude<RolloverDisposition, "GRADUATE" | "LEAVE"> | null {
  if (nextGrade(sourceGrade) === targetGrade) return "PROMOTE";
  if (sourceGrade !== targetGrade) return null;
  return targetClassId ? "REPEAT" : "HOLD_UNASSIGNED";
}

export function currentAcademicYearDates(now = new Date()): {
  label: string;
  startsOn: Date;
  endsOn: Date;
} {
  const shanghaiYear = Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
    }).format(now),
  );
  const shanghaiMonth = Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Shanghai",
      month: "numeric",
    }).format(now),
  );
  const startYear = shanghaiMonth >= 9 ? shanghaiYear : shanghaiYear - 1;
  return {
    label: `${startYear}-${startYear + 1}`,
    startsOn: new Date(`${startYear}-09-01T00:00:00.000Z`),
    endsOn: new Date(`${startYear + 1}-08-31T00:00:00.000Z`),
  };
}
