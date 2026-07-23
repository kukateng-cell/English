import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-3 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          英语单词认读
        </h1>
        <p className="mb-2 text-sm text-zinc-500 dark:text-zinc-400">
          基于 SM-2 间隔重复算法 · 中学生专属
        </p>
        <p className="mb-10 text-sm text-zinc-400 dark:text-zinc-500">
          看到英文能认字 · 随时随地 · 科学记忆
        </p>

        <Link
          href="/study"
          className="mb-4 flex h-14 items-center justify-center rounded-2xl bg-blue-600 text-lg font-medium text-white shadow-lg shadow-blue-200/50 transition hover:bg-blue-700 active:scale-[0.98] dark:shadow-blue-950/50"
        >
          开始学习
        </Link>
        <Link
          href="/units"
          className="mb-4 flex h-12 items-center justify-center rounded-2xl bg-white text-sm font-medium text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-50 active:scale-[0.98] dark:bg-zinc-900 dark:text-blue-400 dark:ring-blue-900 dark:hover:bg-zinc-800"
        >
          单元闯关 · 按主题学习
        </Link>
        <Link
          href="/login"
          className="flex h-10 items-center justify-center text-sm text-zinc-400 transition hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          已有账号？登录
        </Link>
      </div>
    </div>
  );
}

