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
import RewardIcon from "@/components/ui/RewardIcon";
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
        if (!response.ok) throw new Error(payload?.error || "暫時無法載入學習概覽");
        setData(payload as StudentDashboardResponse);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "暫時無法載入學習概覽");
      }
    })();
    return () => controller.abort();
  }, [reloadKey]);

  if (error && !data) {
    return <div className="student-content-narrow"><StudentPageStack><StudentSectionStack><StatusBanner variant="error" message={tc(error)} action={<Button variant="quiet" size="small" onClick={() => setReloadKey((key) => key + 1)}>{tc("重試")}</Button>} /></StudentSectionStack></StudentPageStack></div>;
  }
  if (!data) {
    return <div className="student-content-narrow"><StudentPageStack><PageHeader title={tc("今天繼續學習")} description={tc("正在讀取你的學習概覽")} /><StudentSectionStack><div className="dashboard-skeleton-grid"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div><Skeleton className="h-56" label={tc("正在讀取學習概覽")} /></StudentSectionStack></StudentPageStack></div>;
  }

  const next = data.nextSession;
  return (
    <div className="student-content-narrow">
      <StudentPageStack>
        <PageHeader eyebrow={tc("今日")} title={tc("今天繼續學習")} description={tc("下一輪學習會按今天要複習的字和可學的新字安排。") } action={<Link className="ui-button ui-button-secondary ui-button-small" href="/stats"><Icon name="bar-chart" size={17} />{tc("查看統計")}</Link>} />

        <StudentSectionStack>
          {hasCheckpoint ? <StatusBanner variant="info" live={false} message={<><strong>{tc("有一項未完成的學習記錄")}</strong><p>{tc("繼續學習時，系統會重新確認你的進度。")} </p></>} action={<Link className="ui-button ui-button-quiet ui-button-small" href="/study">{tc("繼續學習")}</Link>} /> : null}

          <Card className="next-session-card" padded>
        <div className="next-session-copy">
          <span className="ui-eyebrow">{tc("下一輪學習")}</span>
          <h2>{next.total > 0 ? tc("準備好開始學習嗎？") : tc("這一輪暫時沒有待學習內容")}</h2>
          <p>{next.total > 0 ? tc("先完成需要複習的字，再認識新字。") : tc("可以到詞表查看已解鎖詞，或查看單元進度。")}</p>
        </div>
        <div className="next-session-count" aria-label={tc("下一輪學習詞數") as string}><strong>{next.total}</strong><span>{tc("個詞")}</span></div>
        <div className="next-session-breakdown"><span><b>{next.dueCount}</b>{tc("個待複習")}</span><span><b>{next.newCount}</b>{tc("個新詞")}</span><span className="next-session-backlog">{tc("待複習總量")} {next.dueBacklogCount} · {tc("可學新詞")} {next.availableNewCount}</span></div>
        <Link className="ui-button ui-button-primary ui-button-large" href="/study">{next.total > 0 ? tc("開始下一輪") : tc("瀏覽詞表")}<Icon name="arrow-right" size={18} /></Link>
          </Card>

          <div className="dashboard-stats-grid dashboard-stats-grid--four">
        <StatCard className="dashboard-encounter-stat" label={tc("今日認字")} value={data.today.selfRatedEncounterCount} note={tc("完成認字卡回想")} />
        <StatCard label={tc("今日新學")} value={data.today.newWordCount} note={tc("首次複習的詞")} />
        <StatCard label={tc("今日複習")} value={data.today.reviewedWordCount} note={tc("已記錄的詞")} />
        <StatCard label={tc("連續學習")} value={data.streak.count} note={data.streak.studiedToday ? tc("今天已打卡") : tc("今天完成學習即可打卡")} />
          </div>
          <div className="dashboard-lower-grid">
          <Card className="dashboard-library-card" padded>
        <div className="dashboard-section-heading"><div><span className="ui-eyebrow">{tc("詞庫進度")}</span><h2>{tc("已解鎖內容進度")}</h2></div><div className="dashboard-section-actions"><Link className="ui-button ui-button-quiet ui-button-small" href="/stats"><Icon name="bar-chart" size={16} />{tc("詳細統計")}</Link><Link className="ui-button ui-button-quiet ui-button-small" href="/words">{tc("打開詞表")}<Icon name="arrow-right" size={16} /></Link></div></div>
        <div className="dashboard-progress-grid">
          <ProgressBar label={tc("已學進度")} value={data.library.learnedCount} max={data.library.totalWords} showValue />
          <ProgressBar label={tc("長期掌握")} value={data.library.masteredCount} max={data.library.totalWords} showValue className="ui-progress-success" />
        </div>
          </Card>

          <div className="dashboard-links-grid">
        <Link className="dashboard-link-card" href="/units"><Icon name="route" size={22} /><span><strong>{tc("單元闖關")}</strong><small>{tc("查看解鎖與認字進度")}</small></span><Icon name="arrow-right" size={18} /></Link>
        <Link className="dashboard-link-card" href="/stats"><Icon name="bar-chart" size={22} /><span><strong>{tc("統計與成就")}</strong><small>{tc("查看活動、排行榜及成就")}</small></span><Icon name="arrow-right" size={18} /></Link>
        <Link className="dashboard-link-card" href="/leaderboard"><RewardIcon name="trophy" size={22} /><span><strong>{tc("排行榜")}</strong><small>{tc("查看學習排行")}</small></span><Icon name="arrow-right" size={18} /></Link>
        <Link className="dashboard-link-card" href="/achievements"><RewardIcon name="star" size={22} /><span><strong>{tc("成就")}</strong><small>{tc("查看已解鎖成就")}</small></span><Icon name="arrow-right" size={18} /></Link>
          </div>
          </div>

          {data.today.reviewEventCount === 0 && data.today.reviewedWordCount === 0 && data.today.selfRatedEncounterCount === 0 ? <EmptyState title={tc("今天還沒有學習記錄")} description={tc("完成第一輪複習後，這裡的今日資料會自動更新。") } action={<Link className="ui-button ui-button-secondary ui-button-small" href="/study">{tc("開始學習")}</Link>} /> : null}
        </StudentSectionStack>
      </StudentPageStack>
    </div>
  );
}
