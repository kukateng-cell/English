"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/components/LocaleProvider";
import Icon, { type IconName } from "@/components/ui/Icon";

const ITEMS: Array<{ href: string; label: string; icon: IconName; matches: string[] }> = [
  { href: "/", label: "今日", icon: "home", matches: ["/"] },
  { href: "/study", label: "学习", icon: "spark", matches: ["/study", "/units"] },
  { href: "/words", label: "词表", icon: "book", matches: ["/words"] },
  { href: "/stats", label: "统计", icon: "bar-chart", matches: ["/stats", "/leaderboard", "/achievements"] },
];

export default function StudentNav({ mode }: { mode: "rail" | "bottom" }) {
  const pathname = usePathname();
  const { tc } = useLocale();
  return (
    <nav className={mode === "rail" ? "student-nav student-nav-rail" : "student-nav student-nav-bottom"} aria-label={tc("学生主导航")}>
      {ITEMS.map((item) => {
        const active = item.matches.includes(pathname) || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
        return (
          <Link key={item.href} href={item.href} className={active ? "student-nav-link is-active" : "student-nav-link"} aria-current={active ? "page" : undefined}>
            <Icon name={item.icon} size={mode === "rail" ? 20 : 21} />
            <span>{tc(item.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
