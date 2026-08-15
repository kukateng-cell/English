"use client";

import { useLocale } from "@/components/LocaleProvider";
import Icon from "@/components/ui/Icon";
import { CLASS_LABELS, GRADE_LABELS, STUDENT_GRADES } from "@/lib/roster-domain";
import type { ClassCode, StudentGrade } from "@/generated/prisma";

export type TeacherClassOption = { id: string; grade: StudentGrade; classCode: ClassCode | string };

export default function TeacherFilters({
  classes,
  grade,
  classId,
  search,
  onGradeChange,
  onClassChange,
  onSearchChange,
}: {
  classes: TeacherClassOption[];
  grade: string;
  classId: string;
  search: string;
  onGradeChange: (value: string) => void;
  onClassChange: (value: string) => void;
  onSearchChange: (value: string) => void;
}) {
  const { tc } = useLocale();
  const visibleClasses = classes.filter((item) => !grade || item.grade === grade);
  return (
    <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-[minmax(0,1fr)_180px_220px]">
      <label className="grid gap-1.5 text-sm font-semibold text-[var(--text)]">
        {tc("搜尋學生")}
        <div className="relative">
          <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={tc("學生證、真名或暱稱")} className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-10 text-sm outline-none focus:border-[var(--primary)]" />
          <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-3 text-[var(--muted)]" />
        </div>
      </label>
      <label className="grid gap-1.5 text-sm font-semibold text-[var(--text)]">
        {tc("年級")}
        <select value={grade} onChange={(event) => { onGradeChange(event.target.value); onClassChange(""); }} className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--primary)]">
          <option value="">{tc("全部年級")}</option>
          {STUDENT_GRADES.map((item) => <option key={item} value={item}>{tc(GRADE_LABELS[item])}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm font-semibold text-[var(--text)]">
        {tc("班別")}
        <select value={classId} onChange={(event) => onClassChange(event.target.value)} className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--primary)]">
          <option value="">{tc("全部班別")}</option>
          {visibleClasses.map((item) => <option key={item.id} value={item.id}>{tc(GRADE_LABELS[item.grade])} · {tc(CLASS_LABELS[item.classCode as ClassCode] ?? item.classCode)}</option>)}
        </select>
      </label>
    </div>
  );
}
