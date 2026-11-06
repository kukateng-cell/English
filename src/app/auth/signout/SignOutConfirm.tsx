"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { getCsrfToken } from "next-auth/react";
import { useLocale } from "@/components/LocaleProvider";
import Button, { buttonClass } from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import StatusBanner from "@/components/ui/StatusBanner";

/**
 * 登出確認表單。
 *
 * 以原生 `<form method="POST">` 提交到 NextAuth 的登出端點，保留其 CSRF
 * 驗證。token 一般由伺服器從 NextAuth CSRF cookie 直接帶入；只有 cookie
 * 尚未建立（例如首次直接開啟此頁）時，才在提交前向 `/api/auth/csrf`
 * 取得，避免與 SessionProvider 的 session 請求競爭而出現不一致的 token。
 */
export default function SignOutConfirm({
  callbackUrl,
  initialCsrfToken,
}: {
  callbackUrl: string;
  initialCsrfToken: string | null;
}) {
  const { tc } = useLocale();
  const formRef = useRef<HTMLFormElement>(null);
  const csrfInputRef = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [csrfError, setCsrfError] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    // 已有有效 token（正常情況）：交由瀏覽器原生提交，不繞過 CSRF。
    if (csrfInputRef.current?.value) return;
    event.preventDefault();
    setPreparing(true);
    setCsrfError(false);
    try {
      const token = await getCsrfToken();
      if (!token || !csrfInputRef.current) {
        setCsrfError(true);
        return;
      }
      csrfInputRef.current.value = token;
      // 重新觸發 submit；此時 hidden input 已有 token，會走原生提交。
      formRef.current?.requestSubmit();
    } catch {
      setCsrfError(true);
    } finally {
      setPreparing(false);
    }
  }

  return (
    <section className="auth-panel" aria-labelledby="signout-title">
      <div className="auth-panel-header">
        <span className="auth-panel-icon">
          <Icon name="logout" size={28} />
        </span>
        <h1 id="signout-title">{tc("確定要登出嗎？")}</h1>
        <p>{tc("登出後需要重新登入，才能繼續學習。")}</p>
      </div>
      <form
        ref={formRef}
        className="auth-form"
        method="POST"
        action="/api/auth/signout"
        onSubmit={handleSubmit}
      >
        <input
          ref={csrfInputRef}
          type="hidden"
          name="csrfToken"
          defaultValue={initialCsrfToken ?? ""}
        />
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <Button
          className="auth-form-submit"
          size="large"
          type="submit"
          loading={preparing}
        >
          {tc("登出")}
        </Button>
      </form>
      {csrfError ? (
        <div className="auth-error">
          <StatusBanner
            variant="error"
            message={tc("未能完成安全驗證，請重新載入頁面後再試。")}
          />
        </div>
      ) : null}
      <p className="auth-footer-note">
        <Link className={buttonClass("quiet", "small")} href={callbackUrl}>
          {tc("取消")}
        </Link>
      </p>
    </section>
  );
}
