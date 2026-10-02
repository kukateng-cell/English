"use client";

import Link from "next/link";
import MetricDefinitionsHelp from "@/components/analytics/MetricDefinitionsHelp";
import { CLASS_LABELS, GRADE_LABELS } from "@/lib/roster-domain";
import type { ClassCode, StudentGrade } from "@/generated/prisma";

export type TeacherProgressItem = {
  id: string;
  accountName: string;
  studentNumber: number | null;
  legalName: string;
  nickname: string;
  grade: StudentGrade | null;
  classCode: ClassCode | null;
  masteredWords: number;
  totalWords: number;
  masteryPercent: number | null;
  effectiveObjectiveProbeCount: number;
  effectiveReviewEventCount: number;
  todayLearningEncounterCount: number;
  lastActivityAt: string | null;
  dueReviewCount: number;
};

type TeacherProgressTableProps = {
  items: TeacherProgressItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  tc: (text: string) => string;
};

function classLabel(item: TeacherProgressItem, tc: TeacherProgressTableProps["tc"]) {
  if (!item.grade) return tc("未分配");
  return `${tc(GRADE_LABELS[item.grade])}${item.classCode ? tc(CLASS_LABELS[item.classCode]) : tc("未分班")}`;
}

function EvaluationCell({ item, tc }: { item: TeacherProgressItem; tc: TeacherProgressTableProps["tc"] }) {
  return (
    <div className="grid gap-1 text-xs leading-tight">
      <span><span className="text-[var(--muted)]">{tc("測驗")}</span> {item.effectiveObjectiveProbeCount}</span>
      <span><span className="text-[var(--muted)]">{tc("已計入")}</span> {item.effectiveReviewEventCount}</span>
    </div>
  );
}

export default function TeacherProgressTable({ items, selectedIds, onToggle, tc }: TeacherProgressTableProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <div>
          <p className="text-sm font-bold text-[var(--primary)]">{tc("學生進度")}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{tc("按學號排列；可選取學生比較學習表現。")}</p>
        </div>
        <MetricDefinitionsHelp context="progress" />
      </div>

      <p className="teacher-table-hint">{tc("欄位較多；桌面版可左右滑動查看完整資料。")}</p>

      <div className="hidden overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] lg:block">
        <table className="w-full min-w-[820px] table-fixed text-left text-sm xl:min-w-0">
          <colgroup>
            <col className="w-[6%]" />
            <col className="w-[20%]" />
            <col className="w-[6%]" />
            <col className="w-[8%]" />
            <col className="w-[9%]" />
            <col className="w-[11%]" />
            <col className="w-[9%]" />
            <col className="w-[6%]" />
            <col className="w-[13%]" />
            <col className="w-[12%]" />
          </colgroup>
          <caption className="sr-only">{tc("學生進度")}</caption>
          <thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]">
            <tr>
              <th className="whitespace-nowrap px-3 py-3 text-center">{tc("比較")}</th>
              <th className="px-1.5 py-3">{tc("學生")}</th>
              <th className="whitespace-nowrap px-1.5 py-3">{tc("學號")}</th>
              <th className="whitespace-nowrap px-1.5 py-3">{tc("班別")}</th>
              <th className="whitespace-nowrap px-1.5 py-3">{tc("掌握")}</th>
              <th className="whitespace-nowrap px-1.5 py-3">{tc("測驗次數")}</th>
              <th className="whitespace-nowrap px-1.5 py-3">{tc("今日認字")}</th>
              <th className="whitespace-nowrap px-1.5 py-3">{tc("待複習")}</th>
              <th className="whitespace-nowrap px-1.5 py-3">{tc("最近活動")}</th>
              <th className="whitespace-nowrap px-1.5 py-3">{tc("詳情")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-[var(--border)] last:border-0">
                <td className="px-3 py-4 text-center align-top">
                  <input
                    type="checkbox"
                    aria-label={`${tc("選取比較")} ${item.nickname || item.legalName}`}
                    checked={selectedIds.includes(item.id)}
                    disabled={!selectedIds.includes(item.id) && selectedIds.length >= 8}
                    onChange={() => onToggle(item.id)}
                    className="mx-auto block h-4 w-4 accent-[var(--primary)]"
                  />
                </td>
                <td className="min-w-0 px-1.5 py-4 align-top">
                  <p className="break-words font-bold leading-tight text-[var(--text)]">{item.nickname || item.legalName}</p>
                  <p className="mt-1 break-words text-xs leading-tight text-[var(--muted)]">{item.accountName} · {item.legalName}</p>
                </td>
                <td className="whitespace-nowrap px-1.5 py-4 align-top tabular-nums text-[var(--muted)]">{item.studentNumber ?? tc("未設定")}</td>
                <td className="whitespace-nowrap px-1.5 py-4 align-top text-[var(--muted)]">{classLabel(item, tc)}</td>
                <td className="px-1.5 py-4 align-top">
                  <strong className="block whitespace-nowrap text-[var(--primary)]">{item.masteryPercent === null ? "—" : `${item.masteryPercent}%`}</strong>
                  <span className="mt-1 block whitespace-nowrap text-xs text-[var(--muted)]">{item.masteredWords}/{item.totalWords}</span>
                </td>
                <td className="px-1.5 py-4 align-top text-[var(--text)]"><EvaluationCell item={item} tc={tc} /></td>
                <td className="whitespace-nowrap px-1.5 py-4 align-top font-semibold tabular-nums text-[var(--primary)]">{item.todayLearningEncounterCount}{tc("次")}</td>
                <td className="whitespace-nowrap px-1.5 py-4 align-top tabular-nums text-[var(--muted)]">{item.dueReviewCount}</td>
                <td className="whitespace-nowrap px-1.5 py-4 align-top text-xs tabular-nums text-[var(--muted)]">{item.lastActivityAt ? new Date(item.lastActivityAt).toLocaleDateString() : "—"}</td>
                <td className="px-1.5 py-4 align-top">
                  <Link href={`/teacher/students/${item.id}?from=progress`} className="ui-button ui-button-secondary ui-button-small whitespace-nowrap">{tc("查看")}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 lg:hidden">
        {items.map((item) => (
          <article key={item.id} className="ui-card ui-card-padding">
            <div className="flex items-start justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <input
                  type="checkbox"
                  aria-label={`${tc("選取比較")} ${item.nickname || item.legalName}`}
                  checked={selectedIds.includes(item.id)}
                  disabled={!selectedIds.includes(item.id) && selectedIds.length >= 8}
                  onChange={() => onToggle(item.id)}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                {tc("比較")}
              </label>
              <strong className="text-xl text-[var(--primary)]">{item.masteryPercent === null ? "—" : `${item.masteryPercent}%`}</strong>
            </div>
            <div className="mt-2 min-w-0">
              <p className="break-words font-bold text-[var(--text)]">{item.nickname || item.legalName}</p>
              <p className="mt-1 break-words text-xs text-[var(--muted)]">{item.accountName} · {item.legalName}</p>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
              <div><dt className="text-[var(--muted)]">{tc("學號")}</dt><dd className="mt-1 font-semibold text-[var(--text)]">{item.studentNumber ?? tc("未設定")}</dd></div>
              <div><dt className="text-[var(--muted)]">{tc("班別")}</dt><dd className="mt-1 font-semibold text-[var(--text)]">{classLabel(item, tc)}</dd></div>
              <div><dt className="text-[var(--muted)]">{tc("掌握")}</dt><dd className="mt-1 font-semibold text-[var(--text)]">{item.masteredWords}/{item.totalWords}</dd></div>
              <div><dt className="text-[var(--muted)]">{tc("今日認字")}</dt><dd className="mt-1 font-semibold text-[var(--primary)]">{item.todayLearningEncounterCount}{tc("次")}</dd></div>
              <div><dt className="text-[var(--muted)]">{tc("測驗次數")}</dt><dd className="mt-1 text-[var(--text)]"><EvaluationCell item={item} tc={tc} /></dd></div>
              <div><dt className="text-[var(--muted)]">{tc("待複習")}</dt><dd className="mt-1 font-semibold text-[var(--text)]">{item.dueReviewCount}</dd></div>
              <div className="col-span-2"><dt className="text-[var(--muted)]">{tc("最近活動")}</dt><dd className="mt-1 font-semibold text-[var(--text)]">{item.lastActivityAt ? new Date(item.lastActivityAt).toLocaleDateString() : "—"}</dd></div>
            </dl>
            <Link href={`/teacher/students/${item.id}?from=progress`} className="ui-button ui-button-secondary ui-button-small mt-4 w-full">{tc("查看學生詳情")}</Link>
          </article>
        ))}
      </div>
    </section>
  );
}
