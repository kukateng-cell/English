"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { useLocale } from "@/components/LocaleProvider";

/**
 * 首次登入强制重设密码页面。
 *
 * 触发条件：用户的 mustChangePassword=true（seed 学生账号预设值）。
 * proxy.ts 会把这类用户从其他页面重导到这里；只有在此完成重设后才能进入系统。
 *
 * 流程：校验当前密码 → 设置新密码 → 后端把 mustChangePassword 置为 false。
 * auth.ts 的 jwt 回调每次请求都会从 DB 刷新该标记，因此重设成功后的下一次
 * 请求（本 API 内部已触发 getServerSession）即视为「已重设」，闸门解除。
 */
export default function ResetPasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const { tc } = useLocale();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("新密码至少 8 个字符");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    if (newPassword === currentPassword) {
      setError("新密码不能与当前密码相同");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "重设失败，请稍后重试");
        setLoading(false);
        return;
      }
      setSuccess(true);
      setLoading(false);
      // 先打一次 /api/auth/session：NextAuth 在解析 session 时会跑 jwt 回调、
      // 依据 DB 里最新的 mustChangePassword=false 重新签发并写入 session cookie。
      // （reset API 内部的 getServerSession 只在内存里刷新 token，不会回写 cookie；
      //  必须走 session 端点才会 Set-Cookie。）写完 cookie 再整页跳转，
      // proxy 才能读到 mustChangePassword=false 而不再拦截。
      setTimeout(async () => {
        await fetch("/api/auth/session").catch(() => {});
        window.location.assign("/study");
      }, 900);
    } catch {
      setError("网络错误，请稍后重试");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-[420px] animate-fade-in-up">
        {/* 顶部图标 */}
        <div className="mb-6 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2563EB] to-[#5B6FEF] shadow-[0_8px_24px_rgba(37,99,235,0.18)]">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 1.5a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1v-3a5 5 0 0 0-5-5zm3 8H9v-3a3 3 0 0 1 6 0v3z"
                fill="white"
              />
            </svg>
          </div>
        </div>

        <h1 className="mb-1 text-center text-[24px] font-bold text-[#17213C] dark:text-[#E2E8F0]">
          {tc("重设密码")}
        </h1>
        <p className="mb-6 text-center text-[14px] text-[#7C89A5] dark:text-[#94A3B8]">
          {tc("首次登录需要设置新密码后才能继续使用")}
        </p>

        {success ? (
          <div className="rounded-2xl bg-[#ECFDF3] px-4 py-6 text-center text-[15px] text-[#16A34A] dark:bg-[#0B2D1A] dark:text-[#4ADE80]">
            <div className="mb-2 text-[40px] leading-none">✓</div>
            {tc("密码已更新，正在进入系统…")}
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-4"
            autoComplete="on"
          >
            <div>
              <input
                type="password"
                placeholder={tc("当前密码")}
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setError("");
                }}
                autoComplete="current-password"
                required
                className="h-[48px] w-full rounded-2xl border border-[#E7EDF8] bg-white px-4 text-[15px] text-[#17213C] outline-none transition placeholder:text-[#BFCBE3] focus:border-[#2563EB] focus:ring-[3px] focus:ring-[#2563EB]/8 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#E2E8F0] dark:placeholder:text-[#475569] dark:focus:border-[#60A5FA] dark:focus:ring-[#60A5FA]/10"
              />
            </div>
            <div>
              <input
                type="password"
                placeholder={tc("新密码（至少 8 个字符）")}
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setError("");
                }}
                autoComplete="new-password"
                required
                minLength={8}
                className="h-[48px] w-full rounded-2xl border border-[#E7EDF8] bg-white px-4 text-[15px] text-[#17213C] outline-none transition placeholder:text-[#BFCBE3] focus:border-[#2563EB] focus:ring-[3px] focus:ring-[#2563EB]/8 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#E2E8F0] dark:placeholder:text-[#475569] dark:focus:border-[#60A5FA] dark:focus:ring-[#60A5FA]/10"
              />
            </div>
            <div>
              <input
                type="password"
                placeholder={tc("再次输入新密码")}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError("");
                }}
                autoComplete="new-password"
                required
                minLength={8}
                className="h-[48px] w-full rounded-2xl border border-[#E7EDF8] bg-white px-4 text-[15px] text-[#17213C] outline-none transition placeholder:text-[#BFCBE3] focus:border-[#2563EB] focus:ring-[3px] focus:ring-[#2563EB]/8 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#E2E8F0] dark:placeholder:text-[#475569] dark:focus:border-[#60A5FA] dark:focus:ring-[#60A5FA]/10"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-1 flex h-[48px] w-full items-center justify-center rounded-2xl bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] text-[16px] font-semibold text-white shadow-[0_8px_24px_rgba(37,99,235,0.18)] transition-all hover:shadow-[0_12px_30px_rgba(37,99,235,0.25)] active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {tc("提交中...")}
                </span>
              ) : (
                tc("设置新密码")
              )}
            </button>
          </form>
        )}

        {error && (
          <div className="mt-4 rounded-2xl bg-[#FEF2F2] px-4 py-3 text-center text-[14px] text-[#EF6B6B] dark:bg-[#2D0B0B] dark:text-[#F87171]">
            {tc(error)}
          </div>
        )}

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-[14px] text-[#7C89A5] transition hover:text-[#17213C] dark:text-[#64748B] dark:hover:text-[#E2E8F0]"
          >
            {tc("退出登录")}
          </button>
        </div>
      </div>
    </div>
  );
}
