"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

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
      setError("账号或密码错误，请重试");
    } else {
      router.push("/study");
      router.refresh();
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-center text-2xl font-bold text-zinc-900">
          英语单词认读
        </h1>
        <p className="mb-8 text-center text-sm text-zinc-500">
          登录以继续学习
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            placeholder="账号 (如 student01)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            className="h-12 rounded-xl border border-zinc-200 px-4 text-base outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <input
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="h-12 rounded-xl border border-zinc-200 px-4 text-base outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <button
            type="submit"
            disabled={loading}
            className="h-12 rounded-xl bg-blue-600 font-medium text-white transition hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? "登录中..." : "登录"}
          </button>
        </form>

        {error && (
          <p className="mt-4 text-center text-sm text-red-500">{error}</p>
        )}

        <p className="mt-8 text-center text-xs text-zinc-400">
          账号由老师统一发放，如忘记请联系老师
        </p>
      </div>
    </div>
  );
}
