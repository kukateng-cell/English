"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
  const [level, setLevel] = useState<string>("A1");
  const [levels, setLevels] = useState<string[]>(["A1", "A2", "B1"]);
  const [levelStatus, setLevelStatus] = useState<LevelStatus[]>([]);
  const [levelUnlocked, setLevelUnlocked] = useState(true);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);

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
      try {
        const res = await fetch(`/api/units?level=${encodeURIComponent(level)}`);
        if (cancelled || !res.ok) return;
        const data = await res.json();
        setUnits(data.units ?? []);
        setLevelUnlocked(data.levelUnlocked !== false);
        if (Array.isArray(data.levelStatus) && data.levelStatus.length > 0) {
          setLevelStatus(data.levelStatus);
        }
        if (Array.isArray(data.levels) && data.levels.length > 0) {
          setLevels(data.levels);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, level]);

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent dark:border-blue-400" />
      </div>
    );
  }

  if (status === "unauthenticated") return null;

  // 整个级别的汇总进度
  const grandTotal = units.reduce((s, u) => s + u.total, 0);
  const grandMastered = units.reduce((s, u) => s + u.mastered, 0);
  const grandDue = units.reduce((s, u) => s + u.due, 0);
  const grandProgress =
    grandTotal > 0 ? Math.round((grandMastered / grandTotal) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-8 pb-24">
      {/* 顶部导航 */}
      <div className="mb-6 flex items-center justify-between">
        <Link
          href="/"
          className="text-sm text-zinc-400 transition hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          ← 首页
        </Link>
        <Link
          href="/study"
          className="text-sm font-medium text-blue-600 transition hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          今日学习 →
        </Link>
      </div>

      <h1 className="mb-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        单元闯关
      </h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        按主题单元逐个攻克，认字后通过测试才算掌握并记录到 SM-2 复习计划。
      </p>

      {/* 级别切换 */}
      <div className="mb-4 flex flex-wrap gap-2">
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
                    ? `${lvl} 已全部完成`
                    : `${lvl} 进度 ${st?.progress ?? 0}%`
                    : "请先完成上一个级别"
              }
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                isActive
                  ? "bg-blue-600 text-white shadow-sm dark:bg-blue-500"
                  : unlocked
                    ? "bg-white text-zinc-500 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800"
                    : "cursor-not-allowed bg-zinc-50 text-zinc-300 ring-1 ring-zinc-100 dark:bg-zinc-900 dark:text-zinc-600 dark:ring-zinc-800"
              }`}
            >
              {!unlocked && <span className="mr-1">🔒</span>}
              {lvl}
              {unlocked && st?.completed && <span className="ml-1">✓</span>}
            </button>
          );
        })}
      </div>

      {/* 当前级别被锁提示 */}
      {!levelUnlocked && (
        <div className="mb-6 rounded-2xl bg-amber-50 p-5 text-sm text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
          <p className="font-semibold">🔒 {level} 级别尚未解锁</p>
          <p className="mt-1 text-amber-600 dark:text-amber-400">
            请先回到上一个级别，把所有单元的认字率都练到 80% 以上，即可解锁{" "}
            {level} 级别。
          </p>
        </div>
      )}

      {/* 级别总览卡片 */}
      <div className="mb-8 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 p-5 text-white shadow-lg shadow-blue-200 dark:shadow-blue-950/50">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-sm/none opacity-80">{level} 级别总进度</p>
            <p className="mt-1 text-3xl font-bold">{grandProgress}%</p>
          </div>
          <div className="text-right text-xs opacity-90">
            <p>已掌握 {grandMastered} / {grandTotal} 词</p>
            <p className="mt-0.5">
              {grandDue > 0 ? `待复习 ${grandDue} 词` : "无到期复习"}
            </p>
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/25">
          <div
            className="h-full rounded-full bg-white transition-all duration-500"
            style={{ width: `${grandProgress}%` }}
          />
        </div>
      </div>

      {/* 单元列表 */}
      {units.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center text-sm text-zinc-400 ring-1 ring-zinc-100 dark:bg-zinc-900 dark:text-zinc-500 dark:ring-zinc-800">
          该级别暂无单词数据
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
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
  const completed = unit.completed;
  const started = unit.learned > 0;
  const locked = !unit.unlocked;

  const go = () => {
    if (locked) return;
    const params = new URLSearchParams({ level, category: unit.name });
    router.push(`/study?${params.toString()}`);
  };

  return (
    <button
      onClick={go}
      disabled={locked}
      aria-disabled={locked}
      className={`group relative flex flex-col rounded-2xl bg-white p-4 text-left ring-1 transition ${
        locked
          ? "cursor-not-allowed opacity-60 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
          : "ring-zinc-200 hover:-translate-y-0.5 hover:shadow-md hover:ring-blue-300 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:shadow-black/30 dark:hover:ring-blue-700"
      }`}
    >
      {/* 完成徽章 / 锁定徽章 */}
      {completed ? (
        <span className="absolute right-3 top-3 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-600 dark:bg-green-950 dark:text-green-400">
          ✓ 已完成
        </span>
      ) : locked ? (
        <span className="absolute right-3 top-3 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
          🔒 未解锁
        </span>
      ) : null}

      <div className="mb-2 flex items-center gap-2">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            locked
              ? "bg-zinc-100 text-zinc-300 dark:bg-zinc-800 dark:text-zinc-600"
              : "bg-zinc-100 text-zinc-500 group-hover:bg-blue-100 group-hover:text-blue-600 dark:bg-zinc-800 dark:text-zinc-300 dark:group-hover:bg-blue-950 dark:group-hover:text-blue-400"
          }`}
        >
          {index}
        </span>
        <h3
          className={`line-clamp-1 text-sm font-semibold ${
            locked
              ? "text-zinc-400 dark:text-zinc-500"
              : "text-zinc-800 group-hover:text-blue-700 dark:text-zinc-100 dark:group-hover:text-blue-400"
          }`}
        >
          {unit.name}
        </h3>
      </div>

      {/* 进度条 */}
      <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            completed
              ? "bg-green-500"
              : started
                ? "bg-blue-500"
                : "bg-zinc-300 dark:bg-zinc-600"
          }`}
          style={{ width: `${unit.progress}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-400 dark:text-zinc-500">
        <span>
          {unit.mastered}/{unit.total} 词
          <span className="ml-1 text-zinc-300 dark:text-zinc-600">
            （需 {Math.ceil(unit.total * 0.8)} 词解锁下一单元）
          </span>
        </span>
        <span>
          {locked
            ? "完成上一单元解锁"
            : completed
              ? "巩固复习"
              : started
                ? unit.due > 0
                  ? `${unit.due} 词待复习`
                  : "继续练习"
                : "开始学习"}
          {!locked && " →"}
        </span>
      </div>
    </button>
  );
}
