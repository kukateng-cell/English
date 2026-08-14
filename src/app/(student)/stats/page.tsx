"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import Button from "@/components/ui/Button";
import Card, { StatCard } from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import ProgressBar from "@/components/ui/ProgressBar";
import SegmentedControl from "@/components/ui/SegmentedControl";
import StatusBanner from "@/components/ui/StatusBanner";
import Icon from "@/components/ui/Icon";
import { EmptyState, RetryState, Skeleton } from "@/components/ui/Feedback";
import { StudentPageStack, StudentSectionStack } from "@/components/student/StudentPageStack";

interface Insights {
  days: number;
  today: {
    reviewedWordCount: number;
    newWordCount: number;
    reviewEventCount: number;
    objectiveRecognitionCount: number;
    selfRatedEncounterCount: number;
    legacyUnknownEventCount: number;
  };
  library: { totalWords: number; learnedCount: number; learnedRate: number; masteredCount: number; mastery: number };
  libraryByLevel: Array<{ level: "A1" | "A2" | "B1" | "B2"; unlocked: boolean; totalWords: number; learnedCount: number; learnedRate: number; masteredCount: number; mastery: number }>;
  streak: { count: number; studiedToday: boolean };
  activity: Array<{ day: string; count: number }>;
  studyDays: string[];
  recent: Array<{ id: string; term: string; reviewedAt: string; nextReviewAt: string | null }>;
}

export default function StatsPage() {
  const { tc, locale } = useLocale();
  const [days, setDays] = useState<"7" | "30">("7");
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setError(null);
      try {
        const response = await fetch(`/api/study/insights?days=${days}`, { cache: "no-store", signal: controller.signal });
        const payload = (await response.json().catch(() => null)) as (Insights & { error?: string }) | null;
        if (!response.ok) throw new Error(payload?.error || "暂时无法加载统计");
        if (!controller.signal.aborted) setData(payload as Insights);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "暂时无法加载统计");
      }
    })();
    return () => controller.abort();
  }, [days, reloadKey]);

  if (error && !data) return <div className="student-content-wide"><StudentPageStack><StudentSectionStack><RetryState message={tc(error)} onRetry={() => setReloadKey((key) => key + 1)} /></StudentSectionStack></StudentPageStack></div>;
  if (!data) return <div className="student-content-wide"><StudentPageStack><PageHeader title={tc("学习统计")} description={tc("正在读取你的活动数据")} /><StudentSectionStack><div className="dashboard-skeleton-grid"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div><Skeleton className="h-64" label={tc("正在加载统计")}/></StudentSectionStack></StudentPageStack></div>;

  const maxActivity = Math.max(1, ...data.activity.map((day) => day.count));
  const formatDay = (day: string) => new Intl.DateTimeFormat(locale === "zh-Hans" ? "zh-CN" : "zh-TW", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(new Date(`${day}T00:00:00+08:00`));
  const formatDateTime = (value: string) => new Intl.DateTimeFormat(locale === "zh-Hans" ? "zh-CN" : "zh-TW", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

  return (
    <div className="student-content-wide">
      <StudentPageStack>
        <PageHeader eyebrow={tc("数据") } title={tc("学习统计") } description={tc("已学进度、长期掌握和活动记录使用与学习页一致的真实数据口径。") } action={<div className="stats-secondary-links"><Link href="/leaderboard"><Icon name="bar-chart" size={16}/>{tc("排行榜")}</Link><Link href="/achievements"><Icon name="spark" size={16}/>{tc("成就")}</Link></div>} />
        <StudentSectionStack>
          <div className="stats-range-row"><SegmentedControl label={tc("统计范围")} items={[{ value: "7", label: tc("近 7 天") }, { value: "30", label: tc("近 30 天") }]} value={days} onChange={setDays} /><span className="ui-field-helper">{tc("活动图只计真实 REVIEW 事件")}</span></div>

          <div className="dashboard-stats-grid stats-top-grid">
        <StatCard label={tc("今日新学")} value={data.today.newWordCount} note={tc("首次复习")}/>
        <StatCard label={tc("今日复习词数")} value={data.today.reviewedWordCount} note={`${data.today.reviewEventCount} ${tc("次记录")}`}/>
        <StatCard label={tc("连续学习")} value={data.streak.count} note={data.streak.studiedToday ? tc("今天已打卡") : tc("截至最近一天")}/>
          </div>
          <p className="ui-field-helper">{tc("统计口径")}：{tc("客观认读")} {data.today.objectiveRecognitionCount} · {tc("自评记录")} {data.today.selfRatedEncounterCount} · {tc("legacy unknown")} {data.today.legacyUnknownEventCount}。</p>

          <div className="stats-two-column">
        <Card padded>
          <div className="dashboard-section-heading"><div><span className="ui-eyebrow">{tc("活动")}</span><h2>{tc("最近学习活动")}</h2></div><span className="ui-field-helper">{tc("Asia/Shanghai")}</span></div>
          {data.activity.every((day) => day.count === 0) ? <EmptyState title={tc("还没有活动记录")} description={tc("完成复习后，活动图会显示每天的 REVIEW 事件。")}/> : <>
            <div className="activity-chart" role="img" aria-label={tc("最近学习活动柱状图") as string}>{data.activity.map((day) => <div className="activity-bar-column" key={day.day}><span className="activity-bar-value">{day.count || ""}</span><div className="activity-bar-track"><span className="activity-bar" style={{ height: `${Math.max(4, (day.count / maxActivity) * 100)}%` }} /></div><span className="activity-bar-label">{formatDay(day.day)}</span></div>)}</div>
            <table className="sr-only"><caption>{tc("最近学习活动数据")}</caption><thead><tr><th>{tc("日期")}</th><th>{tc("复习事件")}</th></tr></thead><tbody>{data.activity.map((day) => <tr key={day.day}><td>{formatDay(day.day)}</td><td>{day.count}</td></tr>)}</tbody></table>
          </>}
        </Card>
        <Card padded>
          <div className="dashboard-section-heading"><div><span className="ui-eyebrow">{tc("词库")}</span><h2>{tc("已解锁内容总览")}</h2></div><Link href="/words" className="ui-button ui-button-quiet ui-button-small">{tc("词表")}</Link></div>
          <div className="stats-progress-stack"><ProgressBar label={tc("已学进度")} value={data.library.learnedCount} max={data.library.totalWords} showValue/><ProgressBar label={tc("长期掌握")} value={data.library.masteredCount} max={data.library.totalWords} showValue className="ui-progress-success"/></div>
          <div className="stats-progress-numbers"><span>{data.library.learnedCount} / {data.library.totalWords} {tc("已学")}</span><span>{data.library.masteredCount} / {data.library.totalWords} {tc("长期掌握")}</span></div>
          <p className="ui-field-helper stats-scope-note">{tc("总览只计算目前已解锁的词；下面再按 A1、A2、B1、B2 显示详细进度。")} </p>
        </Card>
          </div>

          <Card className="stats-level-card" padded>
        <div className="dashboard-section-heading"><div><span className="ui-eyebrow">{tc("分级")}</span><h2>{tc("各级别进度")}</h2></div><span className="ui-field-helper">{tc("按词库级别")}</span></div>
        <div className="stats-level-list">
          {data.libraryByLevel.map((level) => <div className="stats-level-row" key={level.level}>
            <div className="stats-level-heading"><div className="stats-level-title"><strong>{level.level}</strong><span className={level.unlocked ? "stats-level-status is-unlocked" : "stats-level-status"}>{tc(level.unlocked ? "已解锁" : "未解锁")}</span></div><span className="ui-field-helper">{level.totalWords} {tc("个词")} · {level.learnedCount} / {level.totalWords} {tc("已学")} · {level.masteredCount} / {level.totalWords} {tc("长期掌握")}</span></div>
            <div className="stats-level-progress"><ProgressBar label={tc("已学进度")} value={level.learnedCount} max={level.totalWords} showValue/><ProgressBar label={tc("长期掌握")} value={level.masteredCount} max={level.totalWords} showValue className="ui-progress-success"/></div>
          </div>)}
        </div>
        <p className="ui-field-helper stats-scope-note">{tc("未解锁级别仍会列出词库总量，但不会计入首页的已解锁内容总览。")} </p>
          </Card>

          <Card className="recent-learning-card" padded>
        <div className="dashboard-section-heading"><div><span className="ui-eyebrow">{tc("记录")}</span><h2>{tc("最近学习的词")}</h2></div></div>
        {data.recent.length === 0 ? <p className="ui-field-helper">{tc("完成第一次复习后，这里会显示最近记录。")}</p> : <div className="recent-learning-list">{data.recent.map((item) => <div key={item.id} className="recent-learning-row"><span><strong>{item.term}</strong><small>{formatDateTime(item.reviewedAt)}</small></span><span>{item.nextReviewAt ? `${tc("下一次")} ${formatDateTime(item.nextReviewAt)}` : tc("等待下一次复习")}</span></div>)}</div>}
          </Card>

          <Card className="stats-calendar-card" padded><div className="dashboard-section-heading"><div><span className="ui-eyebrow">{tc("打卡")}</span><h2>{tc("最近学习日")}</h2></div></div><div className="study-day-grid" aria-label={tc("最近学习日") as string}>{data.studyDays.map((day) => <span key={day} className="study-day-dot" title={formatDay(day)}>{formatDay(day)}</span>)}</div></Card>
          {error ? <StatusBanner variant="warning" live={false} message={tc(error)} action={<Button variant="quiet" size="small" onClick={() => setReloadKey((key) => key + 1)}>{tc("重试")}</Button>}/> : null}
        </StudentSectionStack>
      </StudentPageStack>
    </div>
  );
}
