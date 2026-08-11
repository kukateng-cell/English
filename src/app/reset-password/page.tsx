"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { useLocale } from "@/components/LocaleProvider";
import { safeCallbackPath } from "@/lib/safe-callback-url";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import AuthShell from "@/components/auth/AuthShell";
import Button from "@/components/ui/Button";
import StatusBanner from "@/components/ui/StatusBanner";
import Icon from "@/components/ui/Icon";

export default function ResetPasswordPage() {
  const { tc } = useLocale();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newPassword.length < MIN_PASSWORD_LENGTH) { setError(`新密码至少 ${MIN_PASSWORD_LENGTH} 个字符`); return; }
    if (newPassword !== confirmPassword) { setError("两次输入的新密码不一致"); return; }
    if (newPassword === currentPassword) { setError("新密码不能与当前密码相同"); return; }
    setLoading(true);
    try {
      const response = await fetch("/api/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) { setError(payload?.error ?? "重设失败，请稍后重试"); setLoading(false); return; }
      setSuccess(true);
      setLoading(false);
      window.setTimeout(() => {
        const rawCallback = new URLSearchParams(window.location.search).get("callbackUrl");
        const safeCallback = safeCallbackPath(rawCallback, window.location.origin);
        void signOut({ callbackUrl: `/login?callbackUrl=${encodeURIComponent(safeCallback)}` });
      }, 900);
    } catch { setError("网络错误，请稍后重试"); setLoading(false); }
  }

  return (
    <AuthShell>
      <section className="auth-panel" aria-labelledby="reset-title">
        <div className="auth-panel-header"><span className="auth-panel-icon"><Icon name="lock" size={28} /></span><h1 id="reset-title">{tc("重设密码")}</h1><p>{tc("首次登录需要设置新密码后才能继续使用")}</p></div>
        {success ? <div className="auth-success" role="status"><span className="auth-success-icon"><Icon name="check" size={28}/></span><strong>{tc("密码已更新，请重新登录")}</strong><p className="ui-field-helper">{tc("正在返回登录页面")}</p></div> : <form className="auth-form" onSubmit={handleSubmit} autoComplete="on" noValidate>
          <div className="ui-field"><label htmlFor="current-password">{tc("当前密码")}</label><input id="current-password" type="password" placeholder={tc("输入当前密码")} value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setError(""); }} autoComplete="current-password" required /></div>
          <div className="ui-field"><label htmlFor="new-password">{tc("新密码")}</label><input id="new-password" type="password" placeholder={tc(`至少 ${MIN_PASSWORD_LENGTH} 个字符`)} value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setError(""); }} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required /><span className="ui-field-helper">{tc(`密码至少 ${MIN_PASSWORD_LENGTH} 个字符`)}</span></div>
          <div className="ui-field"><label htmlFor="confirm-password">{tc("确认新密码")}</label><input id="confirm-password" type="password" placeholder={tc("再次输入新密码")} value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError(""); }} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required /></div>
          <Button className="auth-form-submit" size="large" type="submit" loading={loading}>{tc("设置新密码")}</Button>
        </form>}
        {error ? <div className="auth-error"><StatusBanner variant="error" message={tc(error)} /></div> : null}
        <p className="auth-footer-note"><button type="button" className="ui-button ui-button-quiet ui-button-small" onClick={() => signOut({ callbackUrl: "/login" })}>{tc("退出登录")}</button></p>
      </section>
    </AuthShell>
  );
}
