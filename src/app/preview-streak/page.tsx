/**
 * ⚠️ 临时预览页：仅用于离线查看留存功能（Streak / 日历 / 成就 / 排行榜）的视觉效果，
 * 不依赖数据库。确认效果后应删除本文件。
 */
import StreakBadge from "@/components/StreakBadge";
import StreakCalendar from "@/components/StreakCalendar";
import { AchievementCard } from "@/app/achievements/page";
import type { AchievementStatus } from "@/lib/achievements";

const mockAchievements: AchievementStatus[] = [
  { key: "first_study", icon: "🌱", title: "初次学习", description: "完成第一次学习", type: "reviews", target: 1, unlocked: true, unlockedAt: "2026-08-01T00:00:00.000Z", progress: 1 },
  { key: "review_10", icon: "📖", title: "小试牛刀", description: "累计复习 10 个词", type: "reviews", target: 10, unlocked: true, unlockedAt: "2026-08-02T00:00:00.000Z", progress: 12 },
  { key: "review_50", icon: "📚", title: "渐入佳境", description: "累计复习 50 个词", type: "reviews", target: 50, unlocked: false, unlockedAt: null, progress: 12 },
  { key: "streak_3", icon: "🔥", title: "连学 3 天", description: "连续学习 3 天", type: "streak", target: 3, unlocked: true, unlockedAt: "2026-08-02T00:00:00.000Z", progress: 6 },
  { key: "streak_7", icon: "⚡", title: "连学 7 天", description: "连续学习 7 天", type: "streak", target: 7, unlocked: false, unlockedAt: null, progress: 6 },
  { key: "study_7", icon: "🗓️", title: "坚持一周", description: "累计打卡 7 天", type: "studyDays", target: 7, unlocked: false, unlockedAt: null, progress: 2 },
];

const mockLeaderboard: { rank: number; name: string; value: number; me: boolean }[] = [
  { rank: 1, name: "李华", value: 30, me: false },
  { rank: 2, name: "王芳", value: 28, me: false },
  { rank: 3, name: "student01", value: 24, me: false },
  { rank: 4, name: "张伟", value: 21, me: true },
  { rank: 5, name: "student05", value: 18, me: false },
];

// 老师端·学生进度预览数据（连续天数 / 今日打卡 / 流失预警）
const mockStudents = [
  { name: "李华", email: "student01", streak: 6, studiedToday: true, cumulativeDays: 12, achievementCount: 3, progress: 45, masteredWords: 120, totalWords: 400 },
  { name: "王芳", email: "student02", streak: 3, studiedToday: false, cumulativeDays: 8, achievementCount: 2, progress: 32, masteredWords: 85, totalWords: 400 },
  { name: "张伟", email: "student03", streak: 0, studiedToday: false, cumulativeDays: 2, achievementCount: 0, progress: 12, masteredWords: 30, totalWords: 400, atRisk: true },
];

export default function PreviewStreakPage() {
  const samples = [
    {
      label: "今天已打卡（🔥 高亮）",
      streak: { count: 12, studiedToday: true, lastDate: "2026-08-02" },
    },
    {
      label: "今天未打卡，但昨天连续（提示续签）",
      streak: { count: 5, studiedToday: false, lastDate: "2026-08-01" },
    },
    {
      label: "断签（灰色）",
      streak: { count: 0, studiedToday: false, lastDate: null },
    },
  ];

  const medal = (rank: number) =>
    rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 px-5 py-12">
      <div className="text-center">
        <h1 className="mb-2 text-xl font-bold text-[#17213C] dark:text-[#E2E8F0]">
          🎮 留存功能预览
        </h1>
        <p className="text-[14px] text-[#7C89A5] dark:text-[#64748B]">
          临时离线预览页，不依赖数据库
        </p>
      </div>

      {/* ── StreakBadge 三态 ── */}
      <div className="flex w-full max-w-sm flex-col gap-6">
        {samples.map((s) => (
          <div
            key={s.label}
            className="flex items-center justify-between rounded-2xl border border-[#E7EDF8] bg-white px-5 py-4 dark:border-[#1E293B] dark:bg-[#0F172A]"
          >
            <span className="text-[13px] text-[#7C89A5] dark:text-[#64748B]">
              {s.label}
            </span>
            <StreakBadge streak={s.streak} />
          </div>
        ))}

        <div className="flex items-center gap-2 rounded-2xl bg-[#FFF7E6] px-5 py-3 text-[14px] font-semibold text-[#F59E0B] dark:bg-[#2A1E00] dark:text-[#FBBF24]">
          🔥 已连续学习 12 天，继续加油！
        </div>
      </div>

      {/* ── 打卡日历 ── */}
      <div className="w-full max-w-sm">
        <div className="mb-3 text-center text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
          打卡日历（当月视图）
        </div>
        <StreakCalendar
          data={{
            streak: { count: 6, studiedToday: true, lastDate: "2026-08-02" },
            days: ["2026-08-01", "2026-08-02"],
          }}
        />
      </div>

      {/* ── 成就 ── */}
      <div className="w-full max-w-sm">
        <div className="mb-3 text-center text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
          成就徽章（解锁 / 未解锁）
        </div>
        <div className="grid grid-cols-2 gap-3">
          {mockAchievements.map((a) => (
            <AchievementCard key={a.key} a={a} />
          ))}
        </div>
      </div>

      {/* ── 排行榜 ── */}
      <div className="w-full max-w-sm">
        <div className="mb-3 text-center text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
          排行榜（连续天数榜）
        </div>
        <div className="overflow-hidden rounded-3xl border border-[#E7EDF8] bg-white dark:border-[#1E293B] dark:bg-[#0F172A]">
          {mockLeaderboard.map((e, i) => (
            <div
              key={e.name}
              className={`flex items-center gap-3 px-4 py-3 ${
                e.me
                  ? "bg-[#FFF7E6] dark:bg-[#2A1E00]"
                  : i !== mockLeaderboard.length - 1
                    ? "border-b border-[#F1F5F9] dark:border-[#1E293B]"
                    : ""
              }`}
            >
              <div className="w-8 text-center text-[15px] font-bold tabular-nums text-[#17213C] dark:text-[#E2E8F0]">
                {medal(e.rank) ?? e.rank}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-[14px] font-medium ${
                    e.me
                      ? "text-[#F59E0B] dark:text-[#FBBF24]"
                      : "text-[#17213C] dark:text-[#E2E8F0]"
                  }`}
                >
                  {e.name}
                  {e.me && (
                    <span className="ml-1.5 rounded-full bg-[#F59E0B]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#F59E0B] dark:text-[#FBBF24]">
                      我
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 text-[14px] font-semibold tabular-nums text-[#2563EB] dark:text-[#60A5FA]">
                🔥 <span>{e.value}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 老师端·学生进度（连续天数 / 今日打卡 / 流失预警） ── */}
      <div className="w-full max-w-sm">
        <div className="mb-3 text-center text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
          老师端·学生进度（连续天数 / 今日打卡 / 流失预警）
        </div>
        <div className="space-y-3">
          {mockStudents.map((s) => (
            <div
              key={s.email}
              className={`rounded-2xl border bg-white p-4 dark:bg-[#111827] ${
                s.atRisk
                  ? "border-[#FECACA] dark:border-[#7F1D1D]"
                  : "border-[#E7EDF8] dark:border-[#1E293B]"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF4FF] text-[15px] font-bold text-[#2563EB] dark:bg-[#1E3A5F] dark:text-[#60A5FA]">
                    {s.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-[15px] font-semibold text-[#17213C] dark:text-[#E2E8F0]">
                        {s.name}
                      </p>
                      {s.atRisk && (
                        <span className="rounded-full bg-[#FEF2F2] px-1.5 py-0.5 text-[10px] font-semibold text-[#EF4444] dark:bg-[#2D0B0B] dark:text-[#F87171]">
                          ⚠️ 需关注
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <StreakBadge
                        streak={{
                          count: s.streak,
                          studiedToday: s.studiedToday,
                          lastDate: "2026-08-02",
                        }}
                      />
                      {s.studiedToday && (
                        <span className="flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[11px] font-semibold text-[#15803D] dark:bg-[#052E16] dark:text-[#4ADE80]">
                          ● 今日已学
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[18px] font-bold text-[#2563EB] dark:text-[#60A5FA]">{s.progress}%</p>
                  <p className="text-[12px] text-[#7C89A5] dark:text-[#64748B]">
                    {s.masteredWords}/{s.totalWords} 词
                  </p>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#7C89A5] dark:text-[#64748B]">
                <span>🗓️ 累计 {s.cumulativeDays} 天</span>
                <span>🎖 {s.achievementCount} 个成就</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
