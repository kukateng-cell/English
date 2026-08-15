"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import ErrorBanner from "@/components/ErrorBanner";
import Icon from "@/components/ui/Icon";
import { useLocale } from "@/components/LocaleProvider";
import { networkErrorMessage, responseErrorMessage } from "@/lib/api-error";

interface Unit {
  name: string;
  total: number;
  learned: number;
  mastered: number;
  due: number;
  progress: number;
  completed: boolean;
  unlocked: boolean;
}

interface LevelStatus {
  level: string;
  unlocked: boolean;
  completed: boolean;
  progress: number;
}

export default function UnitsPage() {
  const { status } = useSession();
  const router = useRouter();
  const { tc } = useLocale();
  const [level, setLevel] = useState<string>("A1");
  const [levels, setLevels] = useState<string[]>(["A1", "A2", "B1", "B2"]);
  const [levelStatus, setLevelStatus] = useState<LevelStatus[]>([]);
  const [levelUnlocked, setLevelUnlocked] = useState(true);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  // 拉取指定级别的单元进度。用内联 async IIFE 触发，
  // 符合 react-hooks/set-state-in-effect 规则。
  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/units?level=${encodeURIComponent(level)}`);
        if (cancelled) return;
        if (!res.ok) {
          setError(await responseErrorMessage(res));
          return;
        }
        const data = await res.json();
        setUnits(data.units ?? []);
        setLevelUnlocked(data.levelUnlocked !== false);
        if (Array.isArray(data.levelStatus) && data.levelStatus.length > 0) {
          setLevelStatus(data.levelStatus);
        }
        if (Array.isArray(data.levels) && data.levels.length > 0) {
          setLevels(data.levels);
        }
      } catch (e) {
        if (!cancelled) setError(networkErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, level, reloadKey]);

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
          <span className="text-[14px] text-[var(--muted)] dark:text-[var(--muted)]">{tc("加载中...")}</span>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") return null;

  if (error) {
    return (
      <div className="units-page-error">
        <ErrorBanner
          message={error}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      </div>
    );
  }

  // 整个级别的汇总进度
  const grandTotal = units.reduce((s, u) => s + u.total, 0);
  const grandMastered = units.reduce((s, u) => s + u.mastered, 0);
  const grandDue = units.reduce((s, u) => s + u.due, 0);
  const grandProgress =
    grandTotal > 0 ? Math.round((grandMastered / grandTotal) * 100) : 0;

  return (
    <div className="units-page">
      {/* 顶部导航 */}
      <div className="units-page-topbar flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-1 text-[14px] text-[var(--muted)] transition hover:text-[var(--text)] dark:text-[var(--muted)] dark:hover:text-[var(--text)]"
        >
          <Icon name="arrow-left" size={16} />
          {tc("首页")}
        </Link>
        <Link
          href="/study"
          className="flex items-center gap-1 text-[14px] font-medium text-[var(--primary)] transition hover:text-[var(--primary-2)]"
        >
          {tc("今日学习")}
          <Icon name="chevron-right" size={14} />
        </Link>
      </div>

      <h1 className="mb-1 text-[28px] font-bold tracking-[-0.03em] text-[var(--text)] dark:text-[var(--text)]">
        {tc("单元闯关")}
      </h1>
      <p className="mb-6 text-[14px] leading-relaxed text-[var(--muted)] dark:text-[var(--muted)]">
        {tc("按主题逐个攻克，认字后通过测试才算掌握。")}
      </p>

      {/* 级别切换 */}
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {levels.map((lvl) => {
          const st = levelStatus.find((s) => s.level === lvl);
          const unlocked = st ? st.unlocked : true;
          const isActive = level === lvl;
          return (
            <button
              key={lvl}
              disabled={!unlocked}
              onClick={() => unlocked && setLevel(lvl)}
              title={
                unlocked
                  ? st?.completed
                    ? tc(`${lvl} 已全部完成`)
                    : tc(`${lvl} 进度 ${st?.progress ?? 0}%`)
                    : tc("请先完成上一个级别")
              }
              className={`shrink-0 rounded-full px-5 py-2 text-[14px] font-medium transition ${
                isActive
                  ? "bg-[var(--primary)] text-[var(--color-surface)] shadow-sm"
                  : unlocked
                    ? "border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--primary)]/30 hover:text-[var(--primary)] dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--muted)] dark:hover:border-[var(--border-soft)] dark:hover:text-[var(--primary)]"
                    : "cursor-not-allowed border border-[var(--border)] bg-[var(--border-soft)] text-[var(--muted)] dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--muted)]"
              }`}
            >
              {!unlocked && (
                <Icon name="lock" size={14} className="mr-1 inline-block" />
              )}
              {lvl}
              {unlocked && st?.completed && <Icon name="check" size={14} className="ml-1 inline-block" />}
            </button>
          );
        })}
      </div>

      {/* 当前级别被锁提示 */}
      {!levelUnlocked && (
        <div className="mb-6 rounded-2xl bg-[var(--warning-bg)] p-5 shadow-sm dark:bg-[var(--warning-bg)]">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-[var(--warning)] dark:text-[var(--warning)]">
            <Icon name="lock" size={18} />
            {tc(`${level} 级别尚未解锁`)}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--warning)]">
            {tc(`请先回到上一个级别，把所有单元的认字率都练到 80% 以上，即可解锁 ${level} 级别。`)}
          </p>
        </div>
      )}

      {/* 级别总览卡片 */}
      <div className="units-page-summary relative overflow-hidden rounded-[22px] bg-[var(--primary)] p-6 text-[var(--color-surface)] shadow-card">
        {/* 装饰圆形 */}
        <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-[var(--surface)] opacity-[0.06]" />
        <div className="absolute -bottom-4 right-12 h-16 w-16 rounded-full bg-[var(--surface)] opacity-[0.04]" />

        <div className="relative">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="text-[13px] opacity-70">{tc(`${level} 级别总进度`)}</p>
              <p className="mt-1 text-[36px] font-bold leading-none tracking-[-0.02em]">{grandProgress}%</p>
            </div>
            <div className="text-right text-[13px] opacity-80">
              <p>{tc(`已掌握 ${grandMastered} / ${grandTotal} 词`)}</p>
              <p className="mt-0.5">
                {grandDue > 0 ? tc(`待复习 ${grandDue} 词`) : tc("无到期复习")}
              </p>
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--surface)]/20">
            <motion.div
              className="h-full rounded-full bg-[var(--surface)]"
              style={{ width: `${grandProgress}%` }}
              initial={{ width: 0 }}
              animate={{ width: `${grandProgress}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>
        </div>
      </div>

      {/* 单元列表 */}
      {units.length === 0 ? (
        <div className="rounded-2xl bg-[var(--surface)] p-10 text-center text-[14px] text-[var(--muted)] shadow-sm dark:bg-[var(--surface)] dark:text-[var(--muted)]">
          {tc("该级别暂无单词数据")}
        </div>
      ) : (
        <div className="units-grid">
          {units.map((u, idx) => (
            <UnitCard
              key={u.name}
              index={idx + 1}
              unit={u}
              level={level}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UnitCard({
  index,
  unit,
  level,
}: {
  index: number;
  unit: Unit;
  level: string;
}) {
  const router = useRouter();
  const { tc } = useLocale();
  const completed = unit.completed;
  const started = unit.learned > 0;
  const locked = !unit.unlocked;

  const go = () => {
    if (locked) return;
    const params = new URLSearchParams({ level, category: unit.name });
    router.push(`/study?${params.toString()}`);
  };

  return (
    <motion.button
      onClick={go}
      disabled={locked}
      aria-disabled={locked}
      whileTap={locked ? undefined : { scale: 0.98 }}
      className={`unit-card group relative flex flex-col rounded-2xl border bg-[var(--surface)] p-5 text-left transition-all ${
        locked
          ? "cursor-not-allowed border-[var(--border)] opacity-60 dark:border-[var(--border)] dark:bg-[var(--surface)]"
          : "border-[var(--border)] hover:-translate-y-0.5 hover:border-[var(--primary)]/20 hover:shadow-[var(--shadow-card)] dark:border-[var(--border)] dark:bg-[var(--surface)] dark:hover:border-[var(--border-soft)] dark:hover:shadow-[var(--shadow-card)]"
      }`}
    >
      {/* 状态徽章 */}
      {completed ? (
        <span className="absolute right-4 top-4 rounded-full bg-[var(--success-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--success)] dark:bg-[var(--success-bg)] dark:text-[var(--success)]">
          <span className="flex items-center gap-1">
            <Icon name="check" size={13} />
            {tc("已完成")}
          </span>
        </span>
      ) : locked ? (
        <span className="absolute right-4 top-4 flex items-center gap-1 rounded-full bg-[var(--border-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--muted)]">
          <Icon name="lock" size={12} />
          {tc("未解锁")}
        </span>
      ) : null}

      {/* 编号 + 标题 */}
      <div className="mb-3 flex items-center gap-3">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
            locked
              ? "bg-[var(--border-soft)] text-[var(--muted)] dark:bg-[var(--border)] dark:text-[var(--muted)]"
              : "bg-[var(--border-soft)] text-[var(--primary)] group-hover:bg-[var(--border-soft)] dark:bg-[var(--border-soft)] dark:text-[var(--primary)]"
          }`}
        >
          {String(index).padStart(2, "0")}
        </span>
        <h3
          className={`line-clamp-1 text-[15px] font-semibold ${
            locked
              ? "text-[var(--muted)]"
              : "text-[var(--text)] group-hover:text-[var(--primary)] dark:text-[var(--text)] dark:group-hover:text-[var(--primary)]"
          }`}
        >
          {tc(unit.name)}
        </h3>
      </div>

      {/* 进度条 */}
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[var(--border-soft)] dark:bg-[var(--border)]">
        <motion.div
          className={`h-full rounded-full ${
            completed
              ? "bg-[var(--success)]"
              : started
              ? "bg-[var(--primary)]"
                : "bg-[var(--muted)] dark:bg-[var(--muted)]"
          }`}
          style={{ width: `${unit.progress}%` }}
          initial={{ width: 0 }}
          animate={{ width: `${unit.progress}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>

      <div className="flex items-center justify-between text-[12px] text-[var(--muted)] dark:text-[var(--muted)]">
        <span>
          {unit.mastered}/{unit.total} {tc("词")}
        </span>
        <span className={`inline-flex items-center gap-1 font-medium ${locked ? "" : "text-[var(--primary)] dark:text-[var(--primary)]"}`}>
          {locked
            ? tc("完成上一单元解锁")
            : completed
              ? tc("巩固复习")
              : started
                ? unit.due > 0
                  ? tc(`${unit.due} 词待复习`)
                  : tc("继续练习")
                : tc("开始学习")}
          {!locked && <Icon name="arrow-right" size={14} />}
        </span>
      </div>
    </motion.button>
  );
}
