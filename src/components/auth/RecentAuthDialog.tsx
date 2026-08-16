"use client";

import { useCallback, useState, type FormEvent } from "react";
import Modal from "@/components/admin/Modal";
import { useLocale } from "@/components/LocaleProvider";
import { responseErrorMessage } from "@/lib/api-error";
import { rosterFetch } from "@/lib/roster-client";
import Icon from "@/components/ui/Icon";

interface RecentAuthDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Re-authenticates the current session without signing the user out.
 * Sensitive admin/teacher actions use a short recent-auth grant; its expiry
 * must not be presented as a full session expiry.
 */
export default function RecentAuthDialog({ open, onClose, onSuccess }: RecentAuthDialogProps) {
  const { tc } = useLocale();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => {
    if (busy) return;
    setPassword("");
    setShowPassword(false);
    setError(null);
    onClose();
  }, [busy, onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await rosterFetch("/api/auth/reauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setError(await responseErrorMessage(response, tc));
        return;
      }
      setPassword("");
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc("重新驗證失敗，請稍後再試"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} title={tc("重新驗證身份")}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          {tc("登入狀態仍然有效；為保護敏感操作，請再次輸入目前帳號密碼。")}
        </p>
        <label className="block text-sm font-semibold text-[var(--text)]">
          {tc("密碼")}
          <div className="password-input-wrap mt-2">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              autoFocus
              className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--primary)]"
            />
            <button
              type="button"
              className="password-visibility-toggle"
              aria-label={tc(showPassword ? "隱藏密碼" : "顯示密碼")}
              aria-pressed={showPassword}
              title={tc(showPassword ? "隱藏密碼" : "顯示密碼")}
              onClick={() => setShowPassword((visible) => !visible)}
              disabled={busy}
            >
              <Icon name={showPassword ? "eye-off" : "eye"} size={20} />
            </button>
          </div>
        </label>
        {error ? <p className="rounded-xl bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]" role="alert">{error}</p> : null}
        <div className="flex gap-2">
          <button type="button" className="ui-button ui-button-secondary flex-1" disabled={busy} onClick={close}>{tc("取消")}</button>
          <button type="submit" className="ui-button ui-button-primary flex-1" disabled={busy || !password}>{busy ? tc("驗證中…") : tc("重新驗證")}</button>
        </div>
      </form>
    </Modal>
  );
}
