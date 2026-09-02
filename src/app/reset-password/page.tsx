"use client";

import { useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { useLocale } from "@/components/LocaleProvider";
import { safeCallbackPath } from "@/lib/safe-callback-url";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import AuthShell from "@/components/auth/AuthShell";
import Button from "@/components/ui/Button";
import StatusBanner from "@/components/ui/StatusBanner";
import Icon from "@/components/ui/Icon";
import { rosterFetch } from "@/lib/roster-client";

export default function ResetPasswordPage() {
  const { tc } = useLocale();
  const { data: session } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [successMode, setSuccessMode] = useState<"continue" | "login" | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccessMode(null);
    if (newPassword.length < MIN_PASSWORD_LENGTH) { setError(`新密碼至少 ${MIN_PASSWORD_LENGTH} 個字元`); return; }
    if (newPassword !== confirmPassword) { setError("兩次輸入的新密碼不一致"); return; }
    if (newPassword === currentPassword) { setError("新密碼不能與目前密碼相同"); return; }
    // Capture the account before the password writer revokes this JWT. The
    // session provider may observe that revocation while the API call is in
    // flight, but the fresh credentials sign-in still needs the original
    // account identifier.
    const accountName = session?.user?.accountName ?? session?.user?.email ?? "";
    const rawCallback = new URLSearchParams(window.location.search).get("callbackUrl");
    const safeCallback = safeCallbackPath(rawCallback, window.location.origin);
    setLoading(true);
    try {
      const response = await rosterFetch("/api/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) { setError(payload?.error ?? "重設失敗，請稍後重試"); setLoading(false); return; }
      const continuation = accountName
        ? await signIn("credentials", { email: accountName, password: newPassword, redirect: false }).catch(() => null)
        : null;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      if (!continuation?.ok || continuation.error) {
        setSuccessMode("login");
        setLoading(false);
        window.setTimeout(() => {
          void signOut({ callbackUrl: `/login?callbackUrl=${encodeURIComponent(safeCallback)}` });
        }, 900);
        return;
      }
      setSuccessMode("continue");
      setLoading(false);
      window.setTimeout(() => window.location.replace(safeCallback), 500);
    } catch { setError("網絡錯誤，請稍後重試"); setLoading(false); }
  }

  return (
    <AuthShell>
      <section className="auth-panel" aria-labelledby="reset-title">
        <div className="auth-panel-header"><span className="auth-panel-icon"><Icon name="lock" size={28} /></span><h1 id="reset-title">{tc("重設密碼")}</h1><p>{tc("首次登入需要設定新密碼後才能繼續使用")}</p></div>
        {successMode ? <div className="auth-success" role="status"><span className="auth-success-icon"><Icon name="check" size={28}/></span><strong>{tc(successMode === "continue" ? "密碼已更新，正在繼續使用" : "密碼已更新，請重新登入")}</strong><p className="ui-field-helper">{tc(successMode === "continue" ? "正在返回原本頁面" : "正在返回登入頁面")}</p></div> : <form className="auth-form" onSubmit={handleSubmit} autoComplete="on" noValidate>
          <div className="ui-field"><label htmlFor="current-password">{tc("目前密碼")}</label><input id="current-password" type="password" placeholder={tc("輸入目前密碼")} value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setError(""); }} autoComplete="current-password" required /></div>
          <div className="ui-field"><label htmlFor="new-password">{tc("新密碼")}</label><input id="new-password" type="password" placeholder={tc(`至少 ${MIN_PASSWORD_LENGTH} 個字元`)} value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setError(""); }} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required /><span className="ui-field-helper">{tc(`密碼至少 ${MIN_PASSWORD_LENGTH} 個字元`)}</span></div>
          <div className="ui-field"><label htmlFor="confirm-password">{tc("確認新密碼")}</label><input id="confirm-password" type="password" placeholder={tc("再次輸入新密碼")} value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError(""); }} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required /></div>
          <Button className="auth-form-submit" size="large" type="submit" loading={loading}>{tc("設定新密碼")}</Button>
        </form>}
        {error ? <div className="auth-error"><StatusBanner variant="error" message={tc(error)} /></div> : null}
        <p className="auth-footer-note"><button type="button" className="ui-button ui-button-quiet ui-button-small" onClick={() => signOut({ callbackUrl: "/login" })}>{tc("退出登入")}</button></p>
      </section>
    </AuthShell>
  );
}
