import Link from "next/link";

/** 导航标签项。label 由调用方决定是否已翻译（服务端组件可传入 tc() 后的值）。 */
export interface NavTabItem {
  href: string;
  label: string;
}

/**
 * 可复用的导航标签栏（用于管理后台 / 教师工作台等顶部切换）。
 *
 * 这是一个服务端组件（纯展示，无交互），标签文案由父组件传入，
 * 因此父组件可以自由使用 tc() / convertForServer 等 i18n 函数。
 */
export default function NavTabs({ tabs }: { tabs: NavTabItem[] }) {
  return (
    <nav className="mx-auto mb-6 flex w-full max-w-[420px] gap-1 px-5">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className="rounded-full px-4 py-2 text-[13px] font-medium text-[#7C89A5] transition hover:bg-[#EEF4FF] hover:text-[#2563EB] dark:text-[#64748B] dark:hover:bg-[#1E3A5F] dark:hover:text-[#60A5FA]"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
