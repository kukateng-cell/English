"use client";

import { useEffect, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { useLocale } from "@/components/LocaleProvider";
import { safeCallbackPath } from "@/lib/safe-callback-url";
import { DEFAULT_ROLE, homePathFor } from "@/lib/roles";
import { clearAllStudyClientState } from "@/lib/study-client-state";
import AuthShell from "@/components/auth/AuthShell";
import Button from "@/components/ui/Button";
import StatusBanner from "@/components/ui/StatusBanner";
import Icon from "@/components/ui/Icon";

function safePostLoginCallback(raw: string | null) {
  if (!raw || typeof window === "undefined") return null;
  const safe = safeCallbackPath(raw, window.location.origin, "") || null;
  if (!safe || safe === "/login" || safe.startsWith("/login?")) return null;
  return safe;
}

export default function LoginPage() {
  const { tc } = useLocale();
  const { status, update } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [remainingSec, setRemainingSec] = useState(0);

  useEffect(() => {
    // Protected-route redirects carry a callback URL. Clear the namespaced
    // study state immediately at that boundary, even while NextAuth is still
    // resolving whether the old JWT remains valid.
    if (new URLSearchParams(window.location.search).has("callbackUrl")) {
      clearAllStudyClientState();
      const delayed = window.setTimeout(clearAllStudyClientState, 250);
      return () => window.clearTimeout(delayed);
    }
    return;
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || loading) {
      if (status === "unauthenticated") {
        clearAllStudyClientState();
        // Study-stream unmount handlers may finish a queued local write in
        // the same navigation turn. Repeat once after that turn so a revoked
        // session cannot leave state that would replay after restore.
        const immediate = window.setTimeout(clearAllStudyClientState, 0);
        const delayed = window.setTimeout(clearAllStudyClientState, 250);
        return () => {
          window.clearTimeout(immediate);
          window.clearTimeout(delayed);
        };
      }
      return;
    }
    let cancelled = false;
    void update()
      .then((freshSession) => {
        if (cancelled) return;
        if (!freshSession?.user) {
          clearAllStudyClientState();
          return;
        }
        const callback = safePostLoginCallback(new URLSearchParams(window.location.search).get("callbackUrl"));
        const role = freshSession.user.role ?? DEFAULT_ROLE;
        const roleHome = homePathFor(role);
        const destination = callback ?? roleHome;
        const target = freshSession.user.mustChangePassword ? `/reset-password?callbackUrl=${encodeURIComponent(destination)}` : destination;
        window.location.replace(target);
      })
      .catch(async () => {
        if (cancelled) return;
        clearAllStudyClientState();
        window.setTimeout(clearAllStudyClientState, 250);
        await signOut({ redirect: false }).catch(() => undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [loading, status, update]);

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    let result;
    try {
      result = await signIn("credentials", { email: email.trim(), password, redirect: false });
    } catch {
      setLoading(false);
      setError("网络连接失败，请检查网络后重试");
      return;
    }
    if (!result || result.error) {
      try {
        const loginStatus = await fetch(`/api/auth/login-status?account=${encodeURIComponent(email.trim().toLowerCase())}`).then((response) => response.json());
        if (loginStatus?.locked) {
          setLockUntil(Date.now() + (loginStatus.retryAfterSec ?? 0) * 1000);
          setError(loginStatus.message ?? "登录尝试过多，已临时锁定");
          setLoading(false);
          return;
        }
      } catch {
        // Keep the generic error when the rate-limit status endpoint is unavailable.
      }
      setLoading(false);
      setError("账号或密码错误，请重试");
      return;
    }
    try {
      await update();
    } catch {
      // A full navigation below still refreshes the authoritative session.
    }
    const callback = safePostLoginCallback(new URLSearchParams(window.location.search).get("callbackUrl"));
    let target = callback ?? "/";
    try {
      const me = await fetch("/api/auth/session").then((response) => response.json());
      const role = me?.user?.role ?? DEFAULT_ROLE;
      const roleHome = homePathFor(role);
      const destination = callback ?? roleHome;
      target = me?.user?.mustChangePassword ? `/reset-password?callbackUrl=${encodeURIComponent(destination)}` : destination;
    } catch {
      // The callback is already safe; fallback remains inside the app.
    }
    window.location.replace(target);
  }

  return (
    <AuthShell>
      <section className="auth-panel" aria-labelledby="login-title">
        <div className="auth-panel-header"><span className="auth-panel-icon"><Icon name="book" size={28} /></span><h1 id="login-title">{tc("英语单词认读")}</h1><p>{tc("登录以继续学习")}</p></div>
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="ui-field"><label htmlFor="login-account">{tc("账号")}</label><input id="login-account" type="text" placeholder={tc("例如 student01")} value={email} onChange={(event) => { setEmail(event.target.value); setLockUntil(null); setError(""); }} autoComplete="username" required /></div>
          <div className="ui-field"><label htmlFor="login-password">{tc("密码")}</label><input id="login-password" type="password" placeholder={tc("输入密码")} value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} autoComplete="current-password" required /></div>
          <Button className="auth-form-submit" size="large" type="submit" loading={loading || lockUntil !== null}>{lockUntil !== null && remainingSec > 0 ? tc("暂时锁定") : tc("登录")}</Button>
        </form>
        {error ? <div className="auth-error" id="login-error"><StatusBanner variant="error" message={<>{tc(error)}{lockUntil !== null && remainingSec > 0 ? <span className="auth-error-countdown">{tc(`（剩余 ${Math.floor(remainingSec / 60)} 分 ${remainingSec % 60} 秒）`)}</span> : null}</>} /></div> : null}
        <p className="auth-footer-note">{tc("账号由老师统一发放，如忘记请联系老师")}</p>
      </section>
    </AuthShell>
  );
}
