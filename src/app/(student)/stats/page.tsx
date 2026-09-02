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
import RewardIcon from "@/components/ui/RewardIcon";
import { EmptyState, RetryState, Skeleton } from "@/components/ui/Feedback";
import { StudentPageStack, StudentSectionStack } from "@/components/student/StudentPageStack";
import { buildActivityHeatmap } from "@/lib/activity-heatmap";

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

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
        if (!response.ok) throw new Error(payload?.error || "暫時無法載入統計");
        if (!controller.signal.aborted) setData(payload as Insights);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "暫時無法載入統計");
      }
    })();
    return () => controller.abort();
  }, [days, reloadKey]);

  if (error && !data) return <div className="student-content-wide"><StudentPageStack><StudentSectionStack><RetryState message={tc(error)} onRetry={() => setReloadKey((key) => key + 1)} /></StudentSectionStack></StudentPageStack></div>;
  if (!data) return <div className="student-content-wide"><StudentPageStack><PageHeader title={tc("學習統計")} description={tc("正在讀取你的活動資料")} /><StudentSectionStack><div className="dashboard-skeleton-grid"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div><Skeleton className="h-64" label={tc("正在載入統計")}/></StudentSectionStack></StudentPageStack></div>;

  const showActivityHeatmap = data.activity.length > 7;
  const activityHeatmap = buildActivityHeatmap(data.activity);
  const maxActivity = Math.max(1, ...data.activity.map((day) => day.count));
  const formatDay = (day: string) => new Intl.DateTimeFormat(locale === "zh-Hans" ? "zh-CN" : "zh-TW", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(new Date(`${day}T00:00:00+08:00`));
  const formatDateTime = (value: string) => new Intl.DateTimeFormat(locale === "zh-Hans" ? "zh-CN" : "zh-TW", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

  return (
    <div className="student-content-wide">
      <StudentPageStack>
        <PageHeader eyebrow={tc("資料") } title={tc("學習統計") } action={<div className="stats-secondary-links"><Link href="/leaderboard"><RewardIcon name="trophy" size={16}/>{tc("排行榜")}</Link><Link href="/achievements"><RewardIcon name="star" size={16}/>{tc("成就")}</Link></div>} />
        <StudentSectionStack>
          <div className="stats-range-row"><SegmentedControl label={tc("統計範圍")} items={[{ value: "7", label: tc("近 7 天") }, { value: "30", label: tc("近 30 天") }]} value={days} onChange={setDays} /></div>

          <div className="dashboard-stats-grid stats-top-grid">
        <StatCard label={tc("今日新學")} value={data.today.newWordCount} note={tc("首次複習")}/>
        <StatCard label={tc("今日複習詞數")} value={data.today.reviewedWordCount} note={`${data.today.reviewEventCount} ${tc("次學習記錄")}`}/>
        <StatCard label={tc("連續學習")} value={data.streak.count} note={data.streak.studiedToday ? tc("今天已打卡") : tc("截至最近一天")}/>
          </div>
          <div className="stats-two-column">
        <Card padded>
          <div className="dashboard-section-heading"><div><span className="ui-eyebrow">{tc("活動")}</span><h2>{tc("最近學習活動")}</h2></div></div>
          {data.activity.every((day) => day.count === 0) ? <EmptyState title={tc("還沒有活動記錄")} description={tc("完成學習後，活動圖會顯示每天的學習活動。")}/> : <>
            {showActivityHeatmap ? <div className="activity-heatmap is-month" aria-label={tc("最近學習活動熱力圖") as string}>
              <div className="activity-heatmap-grid-wrap">
                <div className="activity-heatmap-weekdays" aria-hidden="true">{WEEKDAY_LABELS.map((label) => <span key={label}>{tc(label)}</span>)}</div>
                <div className="activity-heatmap-grid" role="group" aria-label={tc("按星期顯示的學習活動") as string}>
                  {activityHeatmap.cells.map((cell) => {
                    if (cell.placeholder) return <span className="activity-heatmap-cell is-placeholder" key={cell.key} aria-hidden="true" />;
                    const label = `${formatDay(cell.day)}：${cell.count} ${tc("次複習事件")}`;
                    return <span className="activity-heatmap-cell" data-level={cell.level} key={cell.key} role="img" aria-label={label} title={label} />;
                  })}
                </div>
              </div>
              <div className="activity-heatmap-legend" aria-label={tc("活動強度圖例") as string}><span>{tc("少")}</span><div className="activity-heatmap-legend-swatches" aria-hidden="true">{[0, 1, 2, 3, 4].map((level) => <span className="activity-heatmap-cell" data-level={level} key={level} />)}</div><span>{tc("多")}</span></div>
            </div> : <div className="activity-chart" role="img" aria-label={tc("最近學習活動柱狀圖") as string}>{data.activity.map((day) => <div className="activity-bar-column" key={day.day}><span className="activity-bar-value">{day.count || ""}</span><div className="activity-bar-track"><span className="activity-bar" style={{ height: `${Math.max(4, (day.count / maxActivity) * 100)}%` }} /></div><span className="activity-bar-label">{formatDay(day.day)}</span></div>)}</div>}
            <table className="sr-only"><caption>{tc("最近學習活動資料")}</caption><thead><tr><th>{tc("日期")}</th><th>{tc("複習事件")}</th></tr></thead><tbody>{data.activity.map((day) => <tr key={day.day}><td>{formatDay(day.day)}</td><td>{day.count}</td></tr>)}</tbody></table>
          </>}
        </Card>
        <Card padded>
          <div className="dashboard-section-heading"><div><span className="ui-eyebrow">{tc("詞庫")}</span><h2>{tc("已解鎖內容總覽")}</h2></div><Link href="/words" className="ui-button ui-button-quiet ui-button-small">{tc("詞表")}</Link></div>
          <div className="stats-progress-stack"><ProgressBar label={tc("已學進度")} value={data.library.learnedCount} max={data.library.totalWords} showValue/><ProgressBar label={tc("長期掌握")} value={data.library.masteredCount} max={data.library.totalWords} showValue className="ui-progress-success"/></div>
          <div className="stats-progress-numbers"><span>{data.library.learnedCount} / {data.library.totalWords} {tc("已學")}</span><span>{data.library.masteredCount} / {data.library.totalWords} {tc("長期掌握")}</span></div>
        </Card>
          </div>

          <Card className="stats-level-card" padded>
        <div className="dashboard-section-heading"><div><span className="ui-eyebrow">{tc("分級")}</span><h2>{tc("各級別進度")}</h2></div></div>
        <div className="stats-level-list">
          {data.libraryByLevel.map((level) => <div className="stats-level-row" key={level.level}>
            <div className="stats-level-heading"><div className="stats-level-title"><strong>{level.level}</strong><span className={level.unlocked ? "stats-level-status is-unlocked" : "stats-level-status"}>{tc(level.unlocked ? "已解鎖" : "未解鎖")}</span></div><span className="ui-field-helper">{level.totalWords} {tc("個詞")} · {level.learnedCount} / {level.totalWords} {tc("已學")} · {level.masteredCount} / {level.totalWords} {tc("長期掌握")}</span></div>
            <div className="stats-level-progress"><ProgressBar label={tc("已學進度")} value={level.learnedCount} max={level.totalWords} showValue/><ProgressBar label={tc("長期掌握")} value={level.masteredCount} max={level.totalWords} showValue className="ui-progress-success"/></div>
          </div>)}
        </div>
          </Card>

          <Card className="recent-learning-card" padded>
        <div className="dashboard-section-heading"><div><span className="ui-eyebrow">{tc("記錄")}</span><h2>{tc("最近學習的詞")}</h2></div></div>
        {data.recent.length === 0 ? <p className="ui-field-helper">{tc("完成第一次複習後，這裡會顯示最近記錄。")}</p> : <div className="recent-learning-list">{data.recent.map((item) => <div key={item.id} className="recent-learning-row"><span><strong>{item.term}</strong><small>{formatDateTime(item.reviewedAt)}</small></span><span>{item.nextReviewAt ? `${tc("下一次")} ${formatDateTime(item.nextReviewAt)}` : tc("等待下一次複習")}</span></div>)}</div>}
          </Card>

          <Card className="stats-calendar-card" padded><div className="dashboard-section-heading"><div><span className="ui-eyebrow">{tc("打卡")}</span><h2>{tc("最近學習日")}</h2></div></div><div className="study-day-grid" aria-label={tc("最近學習日") as string}>{data.studyDays.map((day) => <span key={day} className="study-day-dot" title={formatDay(day)}>{formatDay(day)}</span>)}</div></Card>
          {error ? <StatusBanner variant="warning" live={false} message={tc(error)} action={<Button variant="quiet" size="small" onClick={() => setReloadKey((key) => key + 1)}>{tc("重試")}</Button>}/> : null}
        </StudentSectionStack>
      </StudentPageStack>
    </div>
  );
}
