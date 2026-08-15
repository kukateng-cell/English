"use client";

import { useEffect, useState } from "react";
import ErrorBanner from "@/components/ErrorBanner";
import { useLocale } from "@/components/LocaleProvider";
import {
  CLASS_LABELS,
  GRADE_LABELS,
} from "@/lib/roster-domain";
import type { ClassCode, StudentGrade } from "@/generated/prisma";
import { useRouter } from "next/navigation";
import { rosterFetch } from "@/lib/roster-client";

type Profile = {
  accountName: string;
  contactEmail: string | null;
  legalName: string;
  nickname: string;
  profileRevision: number;
  academicYear: string | null;
  grade: StudentGrade | null;
  classCode: ClassCode | null;
};

export default function StudentProfilePage() {
  const { tc } = useLocale();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/student/profile");
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.code ?? payload?.error ?? "PROFILE_LOAD_FAILED");
        return;
      }
      setProfile(payload);
      setNickname(payload.nickname);
    })();
  }, []);

  async function saveNickname(event: React.FormEvent) {
    event.preventDefault();
    if (!profile) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await rosterFetch("/api/student/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname,
          profileRevision: profile.profileRevision,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.code ?? payload?.error ?? "PROFILE_SAVE_FAILED");
      setProfile(payload);
      setNickname(payload.nickname);
      setMessage("昵称已更新；排行榜只会显示这个昵称。");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (error && !profile) return <ErrorBanner message={error} />;
  if (!profile) {
    return <div className="py-16 text-center text-[var(--muted)]">{tc("载入中...")}</div>;
  }

  const rows = [
    ["学生证／登录账号", profile.accountName],
    ["真实姓名", profile.legalName],
    ["联络 Email", profile.contactEmail ?? "未提供"],
    ["学年", profile.academicYear ?? "未分配"],
    ["年级", profile.grade ? GRADE_LABELS[profile.grade] : "未分配"],
    ["班别", profile.classCode ? CLASS_LABELS[profile.classCode] : "未分班"],
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">{tc("账户与私隐")}</p>
        <h1 className="mt-2 text-[26px] font-bold text-[var(--text)]">{tc("我的资料")}</h1>
        <p className="mt-2 text-[14px] leading-6 text-[var(--muted)]">{tc("真实姓名及学生证只供学校管理；排行榜不会显示这些资料。")}</p>
      </div>

      <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <dl className="divide-y divide-[var(--border)]">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[160px_1fr]">
              <dt className="text-[13px] text-[var(--muted)]">{tc(label)}</dt>
              <dd className="text-[14px] font-medium text-[var(--text)]">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <form onSubmit={saveNickname} className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <label htmlFor="nickname" className="text-[15px] font-semibold text-[var(--text)]">{tc("公开昵称")}</label>
        <p className="mt-1 text-[13px] leading-5 text-[var(--muted)]">{tc("排行榜及其他学生可见位置只会显示昵称。昵称须为 2–24 个文字或数字，不可包含联络资料、粗言或冒充学校人员。")}</p>
        <input
          id="nickname"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          maxLength={48}
          className="mt-4 h-12 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 text-[15px] text-[var(--text)] outline-none focus:border-[var(--primary)]"
        />
        {error ? <p className="mt-3 text-[13px] text-[var(--danger)]">{tc(error)}</p> : null}
        {message ? <p className="mt-3 text-[13px] text-[var(--primary)]">{tc(message)}</p> : null}
        <button disabled={saving || nickname === profile.nickname} className="mt-4 rounded-2xl bg-[var(--primary)] px-5 py-3 text-[14px] font-semibold text-white disabled:opacity-50">
          {tc(saving ? "保存中..." : "保存昵称")}
        </button>
      </form>
    </div>
  );
}
