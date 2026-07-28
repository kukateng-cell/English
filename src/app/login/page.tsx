"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ROLES, DEFAULT_ROLE } from "@/lib/roles";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // 登录限流的锁定状态：lockUntil 为锁定到期时间戳（epoch ms），
  // 非 null 时禁用登录按钮并显示倒计时，到 0 自动解除。
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [remainingSec, setRemainingSec] = useState(0);
  const router = useRouter();

  // 锁定倒计时：每秒刷新剩余秒数，到 0 自动清除锁定状态。
  useEffect(() => {
    if (lockUntil === null) return;
    const tick = () => {
      const remain = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
      setRemainingSec(remain);
      if (remain <= 0) setLockUntil(null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [lockUntil]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email: email.trim(),
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      // NextAuth v4 CredentialsProvider 不透传具体错误原因（密码错 / 被锁），
      // 这里再查一次限流状态：被锁则显示倒计时并禁用按钮，避免用户无意义重试。
      try {
        const status = await fetch(
          `/api/auth/login-status?account=${encodeURIComponent(email.trim().toLowerCase())}`,
        ).then((r) => r.json());
        if (status?.locked) {
          setLockUntil(Date.now() + (status.retryAfterSec ?? 0) * 1000);
          setError(status.message ?? "登录尝试过多，已临时锁定");
          return;
        }
      } catch {
        // 查询失败时回退到通用提示，不阻断主流程
      }
      setError("账号或密码错误，请重试");
    } else {
      // 登录成功后：优先回到來時的 callbackUrl（proxy 帶上的），
      // 否則按角色跳轉到對應入口。
      const callbackUrl = new URLSearchParams(window.location.search).get(
        "callbackUrl",
      );
      // 安全檢查：只允許站內相對路徑，防止開放重導向（協議相對 URL //evil.com）
      const safeCallback =
        callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
          ? callbackUrl
          : null;
      try {
        const me = await fetch("/api/auth/session").then((r) => r.json());
        const role = (me?.user?.role as string) ?? DEFAULT_ROLE;
        const mustChangePassword = me?.user?.mustChangePassword === true;
        // 首次登入強制改密碼：优先引导到重设页（覆盖默认的角色跳转与 callbackUrl，
        // 避免用户带着预设密码进入系统）。
        if (mustChangePassword) {
          router.push("/reset-password");
        } else if (safeCallback) {
          router.push(safeCallback);
        } else if (role === ROLES.ADMIN) {
          router.push("/admin");
        } else if (role === ROLES.TEACHER) {
          router.push("/teacher");
        } else {
          router.push("/study");
        }
      } catch {
        router.push(safeCallback ?? "/study");
      }
      router.refresh();
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-[420px] animate-fade-in-up">
        {/* 顶部图标 */}
        <div className="mb-6 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2563EB] to-[#5B6FEF] shadow-[0_8px_24px_rgba(37,99,235,0.18)]">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M4 8h12l3-3h9v18H4V8z"
                fill="rgba(255,255,255,0.25)"
                stroke="white"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <circle cx="22" cy="22" r="3" fill="white" opacity="0.9" />
              <path d="M21 22l0.7 0.7 1.8-1.8" stroke="#2563EB" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        <h1 className="mb-1 text-center text-[26px] font-bold tracking-[-0.03em] text-[#17213C] dark:text-[#E2E8F0]">
          英语单词认读
        </h1>
        <p className="mb-8 text-center text-[15px] text-[#7C89A5] dark:text-[#64748B]">
          登录以继续学习
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <input
              type="text"
              placeholder="账号 (如 student01)"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                // 换了账号：清掉旧账号的锁定提示与错误（账号维度锁只针对旧账号）。
                setLockUntil(null);
                setError("");
              }}
              autoComplete="username"
              required
              className="h-[48px] w-full rounded-2xl border border-[#E7EDF8] bg-white px-4 text-[15px] text-[#17213C] outline-none transition placeholder:text-[#BFCBE3] focus:border-[#2563EB] focus:ring-[3px] focus:ring-[#2563EB]/8 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#E2E8F0] dark:placeholder:text-[#475569] dark:focus:border-[#60A5FA] dark:focus:ring-[#60A5FA]/10"
            />
          </div>
          <div>
            <input
              type="password"
              placeholder="密码"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              required
              minLength={6}
              className="h-[48px] w-full rounded-2xl border border-[#E7EDF8] bg-white px-4 text-[15px] text-[#17213C] outline-none transition placeholder:text-[#BFCBE3] focus:border-[#2563EB] focus:ring-[3px] focus:ring-[#2563EB]/8 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#E2E8F0] dark:placeholder:text-[#475569] dark:focus:border-[#60A5FA] dark:focus:ring-[#60A5FA]/10"
            />
          </div>

          <button
            type="submit"
            disabled={loading || lockUntil !== null}
            className="mt-1 flex h-[48px] w-full items-center justify-center rounded-2xl bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] text-[16px] font-semibold text-white shadow-[0_8px_24px_rgba(37,99,235,0.18)] transition-all hover:shadow-[0_12px_30px_rgba(37,99,235,0.25)] active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                登录中...
              </span>
            ) : (
              "登录"
            )}
          </button>
        </form>

        {error && (
          <div className="mt-4 rounded-2xl bg-[#FEF2F2] px-4 py-3 text-center text-[14px] text-[#EF6B6B] dark:bg-[#2D0B0B] dark:text-[#F87171]">
            {error}
            {lockUntil !== null && remainingSec > 0 && (
              <span className="ml-1 font-semibold">
                （剩余 {Math.floor(remainingSec / 60)} 分 {remainingSec % 60} 秒）
              </span>
            )}
          </div>
        )}

        <p className="mt-8 text-center text-[13px] text-[#BFCBE3] dark:text-[#475569]">
          账号由老师统一发放，如忘记请联系老师
        </p>

        <div className="mt-6 text-center">
          <Link
            href="/"
            className="text-[14px] text-[#7C89A5] transition hover:text-[#17213C] dark:text-[#64748B] dark:hover:text-[#E2E8F0]"
          >
            ← 返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
