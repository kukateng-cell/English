"use client";

import { useCallback, useEffect, useState } from "react";

export function useCatalogWorkBadgeCount() {
  const [count, setCount] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/catalog/work-items?summary=1", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as { counts?: { totalActionable?: number } };
      setCount(Math.max(0, body.counts?.totalActionable ?? 0));
    } catch {
      // Navigation remains usable when the optional badge cannot refresh.
    }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(() => void refresh(), 60_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);
  return count;
}

export default function CatalogWorkBadge({ count }: { count: number }) {
  if (!count) return null;
  return <span aria-label={`${count} 項詞庫待辦`} className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--danger)] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{count > 99 ? "99+" : count}</span>;
}
