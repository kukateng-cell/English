import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { checkAchievements, getAchievementStatus } from "@/lib/achievements";

/**
 * GET /api/achievements
 * 返回全部成就定义 + 当前用户的解锁状态与进度。
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const userId = auth.userId;

  // 學習流程會在寫入字卡 StudyEncounter 之前呼叫 checkAchievements，所以「只完成
  // 第一次字卡、尚未遇到客觀認讀題」的學生未必已即時寫入解鎖記錄。成就頁讀取前
  // 先在這裡補跑一次冪等檢查，讓已達成的成就如實顯示，避免繼續停在 0 / 1。
  await checkAchievements(userId);
  const achievements = await getAchievementStatus(userId);
  return NextResponse.json({ achievements });
}
