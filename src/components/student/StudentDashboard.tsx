"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { loadCheckpoint } from "@/lib/checkpoint";
import Button from "@/components/ui/Button";
import Card, { StatCard } from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import ProgressBar from "@/components/ui/ProgressBar";
import StatusBanner from "@/components/ui/StatusBanner";
import { EmptyState, Skeleton } from "@/components/ui/Feedback";
import Icon from "@/components/ui/Icon";
import type { StudentDashboardResponse } from "@/lib/student-metrics";
import { StudentPageStack, StudentSectionStack } from "./StudentPageStack";

export default function StudentDashboard({ userId }: { userId: string }) {
  const { tc } = useLocale();
  const [data, setData] = useState<StudentDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasCheckpoint, setHasCheckpoint] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    queueMicrotask(() => setHasCheckpoint(loadCheckpoint(userId, "global")?.phase !== "done"));
  }, [userId]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setError(null);
      try {
        const response = await fetch("/api/student/dashboard", { cache: "no-store", signal: controller.signal });
        const payload = (await response.json().catch(() => null)) as (StudentDashboardResponse & { error?: string }) | null;
        if (!response.ok) throw new Error(payload?.error || "暂时无法加载学习概览");
        setData(payload as StudentDashboardResponse);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "暂时无法加载学习概览");
      }
    })();
    return () => controller.abort();
  }, [reloadKey]);

  if (error && !data) {
    return <div className="student-content-narrow"><StudentPageStack><StudentSectionStack><StatusBanner variant="error" message={tc(error)} action={<Button variant="quiet" size="small" onClick={() => setReloadKey((key) => key + 1)}>{tc("重试")}</Button>} /></StudentSectionStack></StudentPageStack></div>;
  }
  if (!data) {
    return <div className="student-content-narrow"><StudentPageStack><PageHeader title={tc("今天继续学习")} description={tc("正在读取你的学习概览")} /><StudentSectionStack><div className="dashboard-skeleton-grid"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div><Skeleton className="h-56" label={tc("正在加载学习概览")} /></StudentSectionStack></StudentPageStack></div>;
  }

  const next = data.nextSession;
  return (
    <div className="student-content-narrow">
      <StudentPageStack>
        <PageHeader eyebrow={tc("今日")} title={tc("今天继续学习")} description={tc("下一轮学习会根据当前到期复习和已解锁新词动态生成。")} action={<Link className="ui-button ui-button-secondary ui-button-small" href="/stats"><Icon name="bar-chart" size={17} />{tc("查看统计")}</Link>} />

        <StudentSectionStack>
          {hasCheckpoint ? <StatusBanner variant="info" live={false} message={<><strong>{tc("有一项未完成的学习记录")}</strong><p>{tc("继续学习会由学习页重新验证进度和 session。")} </p></>} action={<Link className="ui-button ui-button-quiet ui-button-small" href="/study">{tc("继续学习")}</Link>} /> : null}

          <Card className="next-session-card" padded>
        <div className="next-session-copy">
          <span className="ui-eyebrow">{tc("下一轮学习")}</span>
          <h2>{next.total > 0 ? tc("准备好学习了吗？") : tc("这一轮暂时没有待学习内容")}</h2>
          <p>{next.total > 0 ? tc("先完成到期复习，再认识已解锁的新词。") : tc("可以去词表浏览已解锁词，或查看单元进度。")}</p>
        </div>
        <div className="next-session-count" aria-label={tc("下一轮学习词数") as string}><strong>{next.total}</strong><span>{tc("个词")}</span></div>
        <div className="next-session-breakdown"><span><b>{next.dueCount}</b>{tc("个待复习")}</span><span><b>{next.newCount}</b>{tc("个新词")}</span><span className="next-session-backlog">{tc("待复习总量")} {next.dueBacklogCount} · {tc("可学新词")} {next.availableNewCount}</span></div>
        <Link className="ui-button ui-button-primary ui-button-large" href="/study">{next.total > 0 ? tc("开始下一轮") : tc("浏览词表")}<Icon name="arrow-right" size={18} /></Link>
          </Card>

          <div className="dashboard-stats-grid">
        <StatCard label={tc("今日新学")} value={data.today.newWordCount} note={tc("首次复习的词")} />
        <StatCard label={tc("今日复习")} value={data.today.reviewedWordCount} note={tc("已记录的词")} />
        <StatCard label={tc("连续学习")} value={data.streak.count} note={data.streak.studiedToday ? tc("今天已打卡") : tc("今天完成学习即可打卡")} />
          </div>
          <Card className="dashboard-library-card" padded>
        <div className="dashboard-section-heading"><div><span className="ui-eyebrow">{tc("词库进度")}</span><h2>{tc("已解锁内容进度")}</h2></div><div className="dashboard-section-actions"><Link className="ui-button ui-button-quiet ui-button-small" href="/stats"><Icon name="bar-chart" size={16} />{tc("详细统计")}</Link><Link className="ui-button ui-button-quiet ui-button-small" href="/words">{tc("打开词表")}<Icon name="arrow-right" size={16} /></Link></div></div>
        <div className="dashboard-progress-grid">
          <ProgressBar label={tc("已学进度")} value={data.library.learnedCount} max={data.library.totalWords} showValue />
          <ProgressBar label={tc("长期掌握")} value={data.library.masteredCount} max={data.library.totalWords} showValue className="ui-progress-success" />
        </div>
          </Card>

          <div className="dashboard-links-grid">
        <Link className="dashboard-link-card" href="/units"><Icon name="spark" size={22} /><span><strong>{tc("单元闯关")}</strong><small>{tc("查看解锁与认字进度")}</small></span><Icon name="arrow-right" size={18} /></Link>
        <Link className="dashboard-link-card" href="/stats"><Icon name="bar-chart" size={22} /><span><strong>{tc("统计与成就")}</strong><small>{tc("查看活动、排行榜及成就")}</small></span><Icon name="arrow-right" size={18} /></Link>
          </div>

          {data.today.reviewEventCount === 0 && data.today.reviewedWordCount === 0 ? <EmptyState title={tc("今天还没有学习记录")} description={tc("完成第一轮复习后，这里的今日数据会自动更新。") } action={<Link className="ui-button ui-button-secondary ui-button-small" href="/study">{tc("开始学习")}</Link>} /> : null}
        </StudentSectionStack>
      </StudentPageStack>
    </div>
  );
}
