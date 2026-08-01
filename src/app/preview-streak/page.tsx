/**
 * ⚠️ 临时预览页：仅用于离线查看 StreakBadge / StreakCalendar 组件的视觉效果，
 * 不依赖数据库。确认效果后应删除本文件。
 */
import StreakBadge from "@/components/StreakBadge";
import StreakCalendar from "@/components/StreakCalendar";

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

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 px-5 py-12">
      <div className="text-center">
        <h1 className="mb-2 text-xl font-bold text-[#17213C] dark:text-[#E2E8F0]">
          🔥 连续学习天数（StreakBadge）预览
        </h1>
        <p className="text-[14px] text-[#7C89A5] dark:text-[#64748B]">
          临时离线预览页，不依赖数据库
        </p>
      </div>

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

        {/* 完成画面的激励样式示意 */}
        <div className="flex items-center gap-2 rounded-2xl bg-[#FFF7E6] px-5 py-3 text-[14px] font-semibold text-[#F59E0B] dark:bg-[#2A1E00] dark:text-[#FBBF24]">
          🔥 已连续学习 12 天，继续加油！
        </div>
      </div>

      {/* 打卡日历预览（mock 当月打卡数据） */}
      <div className="w-full max-w-sm">
        <div className="mb-3 text-center text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
          打卡日历（当月视图）预览
        </div>
        <StreakCalendar
          previewData={{
            streak: { count: 6, studiedToday: true, lastDate: "2026-08-02" },
            days: ["2026-08-01", "2026-08-02"],
          }}
        />
      </div>
    </div>
  );
}
