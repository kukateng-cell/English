import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { convertForServer } from "@/lib/i18n/convert";

export default async function Home() {
  // 已登录用户直接跳转到对应入口，免去再看落地页 / 登录页
  const session = await getServerSession(authOptions);
  if (session?.user) {
    const role = (session.user as { role?: string }).role;
    redirect(
      role === "ADMIN" ? "/admin" : role === "TEACHER" ? "/teacher" : "/study",
    );
  }

  const cookieStore = await cookies();
  const tc = (s: string) => convertForServer(s, cookieStore.toString());

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-5 py-8">
      <div className="w-full max-w-[420px] animate-fade-in-up">
        {/* 顶部图标 */}
        <div className="mb-8 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2563EB] to-[#5B6FEF] shadow-[0_8px_24px_rgba(37,99,235,0.2)]">
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M4 8h12l3-3h9v18H4V8z"
                fill="rgba(255,255,255,0.25)"
                stroke="white"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="M4 10h12l3-3h9"
                fill="none"
                stroke="white"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <circle cx="22" cy="22" r="3" fill="white" opacity="0.9" />
              <path d="M21 22l0.7 0.7 1.8-1.8" stroke="#2563EB" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {/* 标题 */}
        <h1
          className="mb-4 text-center leading-[1.1] tracking-[-0.05em] text-[#17213C] dark:text-[#E2E8F0]"
          style={{ fontSize: "34px", fontWeight: 750, letterSpacing: "-0.06em" }}
        >
          {tc("英语单词")}
          <br />
          {tc("认读")}
        </h1>

        <p className="mb-1 text-center text-[15px] leading-relaxed text-[#7C89A5] dark:text-[#64748B]">
          {tc("科学记忆 · 随时进步")}
        </p>
        <p className="mb-10 text-center text-[15px] text-[#7C89A5] dark:text-[#64748B]">
          {tc("看到英文能认字")}
        </p>

        {/* 插画区域 —— 纯 CSS 抽象学习场景 */}
        <div className="relative mb-10 flex h-40 items-center justify-center">
          {/* 装饰圆形背景 */}
          <div className="absolute h-32 w-32 rounded-full bg-[#E0EAFF] dark:bg-[#1E2A4A] opacity-70" />
          <div className="absolute translate-x-20 translate-y-4 h-20 w-20 rounded-full bg-[#EDE9FE] dark:bg-[#251E3E] opacity-70" />
          <div className="absolute -translate-x-16 translate-y-2 h-16 w-16 rounded-full bg-[#DBEAFE] dark:bg-[#1A3A5C] opacity-50" />

          {/* 模拟单词卡片 */}
          <div className="relative z-10 flex h-[88px] w-[200px] flex-col items-center justify-center rounded-2xl bg-white shadow-[0_8px_24px_rgba(38,65,140,0.08)] dark:bg-[#1E293B] dark:shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
            <span className="text-lg font-bold tracking-tight text-[#17213C] dark:text-[#E2E8F0]">
              Hello!
            </span>
            <span className="mt-0.5 text-xs text-[#7C89A5] dark:text-[#64748B]">/həˈloʊ/</span>
            <div className="absolute -bottom-2 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-[#EFF6FF] dark:bg-[#1E3A5F]">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 5.5L8 2l5 3.5v5L8 14l-5-3.5v-5z" stroke="#2563EB" strokeWidth="1.2" strokeLinejoin="round" />
                <circle cx="8" cy="8" r="1.8" fill="#2563EB" />
              </svg>
            </div>
          </div>
        </div>

        {/* 按钮组 */}
        <Link
          href="/study"
          className="mb-3 flex h-[48px] w-full items-center justify-center rounded-2xl bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] text-[16px] font-semibold text-white shadow-[0_12px_30px_rgba(37,99,235,0.18)] transition-all hover:shadow-[0_16px_36px_rgba(37,99,235,0.25)] active:scale-[0.98]"
        >
          {tc("开始学习")}
          <svg className="ml-1.5 h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
          </svg>
        </Link>

        <Link
          href="/units"
          className="mb-4 flex h-[48px] w-full items-center justify-center rounded-2xl border border-[#E7EDF8] bg-white text-[16px] font-medium text-[#2563EB] shadow-sm transition-all hover:border-[#2563EB]/30 hover:bg-[#F8FAFF] active:scale-[0.98] dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#60A5FA] dark:hover:border-[#1E3A5F] dark:hover:bg-[#1A2332]"
        >
          {tc("单元闯关")}
        </Link>

        {/* 排行榜 / 成就入口 */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Link
            href="/leaderboard"
            className="flex h-[44px] items-center justify-center gap-1.5 rounded-2xl border border-[#E7EDF8] bg-white text-[14px] font-medium text-[#2563EB] shadow-sm transition-all hover:border-[#2563EB]/30 hover:bg-[#F8FAFF] active:scale-[0.98] dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#60A5FA] dark:hover:border-[#1E3A5F] dark:hover:bg-[#1A2332]"
          >
            🏆 {tc("排行榜")}
          </Link>
          <Link
            href="/achievements"
            className="flex h-[44px] items-center justify-center gap-1.5 rounded-2xl border border-[#E7EDF8] bg-white text-[14px] font-medium text-[#F59E0B] shadow-sm transition-all hover:border-[#F59E0B]/30 hover:bg-[#FFFBEB] active:scale-[0.98] dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#FBBF24] dark:hover:border-[#7A4A00] dark:hover:bg-[#2A1E00]"
          >
            🎖 {tc("成就")}
          </Link>
        </div>

        {/* 底部登录入口 */}
        <div className="text-center text-sm text-[#7C89A5] dark:text-[#64748B]">
          {tc("已有账号？")}{" "}
          <Link
            href="/login"
            className="font-medium text-[#2563EB] transition hover:text-[#1D4ED8] dark:text-[#60A5FA] dark:hover:text-[#93BBFD]"
          >
            {tc("登录")}
          </Link>
        </div>
      </div>
    </div>
  );
}

