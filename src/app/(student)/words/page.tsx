"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import BottomSheet from "@/components/ui/BottomSheet";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import FilterChip from "@/components/ui/FilterChip";
import Icon from "@/components/ui/Icon";
import PageHeader from "@/components/ui/PageHeader";
import { EmptyState, RetryState, Skeleton } from "@/components/ui/Feedback";
import SegmentedControl from "@/components/ui/SegmentedControl";
import { StudentPageStack, StudentSectionStack } from "@/components/student/StudentPageStack";
import type { StudentWordStatus } from "@/lib/student-metrics";

interface WordItem {
  id: string;
  term: string;
  phonetic: string | null;
  pos: string | null;
  definition: string;
  level: string;
  category: string | null;
  learned: boolean;
  mastered: boolean;
  status: StudentWordStatus;
  nextReviewAt: string | null;
}

interface WordResponse {
  items: WordItem[];
  nextCursor: string | null;
  total: number;
  availableLevels: string[];
  availableCategories: string[];
}

const STATUS_OPTIONS: Array<{ value: "all" | StudentWordStatus; label: string }> = [
  { value: "all", label: "全部" },
  { value: "unseen", label: "未学习" },
  { value: "learning", label: "学习中" },
  { value: "due", label: "待复习" },
  { value: "mastered", label: "长期掌握" },
];

export default function WordsPage() {
  const { tc, locale } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const latestQueryRef = useRef(query);
  const level = searchParams.get("level") ?? "";
  const category = searchParams.get("category") ?? "";
  const requestedStatus = searchParams.get("status") ?? "all";
  const status = STATUS_OPTIONS.some((option) => option.value === requestedStatus)
    ? (requestedStatus as "all" | StudentWordStatus)
    : "all";
  const [data, setData] = useState<WordResponse | null>(null);
  const [items, setItems] = useState<WordItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<WordItem | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const updateFilters = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(latestQueryRef.current);
    Object.entries(changes).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    const nextQuery = next.toString();
    latestQueryRef.current = nextQuery;
    router.push(nextQuery ? `/words?${nextQuery}` : "/words", { scroll: false });
  };

  useEffect(() => {
    latestQueryRef.current = query;
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ limit: "24" });
      if (level) params.set("level", level);
      if (category) params.set("category", category);
      if (status !== "all") params.set("status", status);
      try {
        const response = await fetch(`/api/words?${params}`, { cache: "no-store", signal: controller.signal });
        const payload = (await response.json().catch(() => null)) as (WordResponse & { error?: string }) | null;
        if (!response.ok) throw new Error(payload?.error || "暂时无法加载词表");
        if (!controller.signal.aborted && payload) {
          setData(payload);
          setItems(payload.items);
          setCursor(payload.nextCursor);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "暂时无法加载词表");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [category, level, query, reloadKey, status]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: "24", cursor });
      if (level) params.set("level", level);
      if (category) params.set("category", category);
      if (status !== "all") params.set("status", status);
      const response = await fetch(`/api/words?${params}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as (WordResponse & { error?: string }) | null;
      if (!response.ok || !payload) throw new Error(payload?.error || "暂时无法加载更多词汇");
      setItems((current) => [...current, ...payload.items]);
      setCursor(payload.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法加载更多词汇");
    } finally {
      setLoadingMore(false);
    }
  }

  const statusText = (value: WordItem["status"]) => tc(STATUS_OPTIONS.find((option) => option.value === value)?.label ?? "未学习");
  const nextReviewText = (value: string | null) => value ? new Intl.DateTimeFormat(locale === "zh-Hans" ? "zh-CN" : "zh-TW", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(new Date(value)) : null;

  return (
    <div className="student-content-wide">
      <StudentPageStack>
        <PageHeader eyebrow={tc("詞庫") } title={tc("詞表") } description={tc("只顯示已解鎖的詞；查看內容不會改變學習記錄。") } action={<div className="words-ia-switch"><Link className="is-active" href="/words">{tc("詞表")}</Link><Link href="/units">{tc("單元闖關")}</Link></div>} />
        <StudentSectionStack>
          <Card className="words-filter-card" padded>
        <div className="words-filter-row">
          <div className="ui-field words-filter-field">
            <span>{tc("级别")}</span>
            <SegmentedControl
              className="words-level-control"
              label={tc("按级别筛选") as string}
              value={level}
              onChange={(value) => updateFilters({ level: value || null, category: null })}
              items={[
                { value: "", label: tc("全部") },
                ...(data?.availableLevels ?? ["A1", "A2", "B1", "B2"]).map((item) => ({ value: item, label: item })),
              ]}
            />
            <div className="words-status-filter" role="group" aria-label={tc("按状态筛选") as string}>{STATUS_OPTIONS.map((option) => <FilterChip key={option.value} selected={status === option.value} onClick={() => updateFilters({ status: option.value === "all" ? null : option.value })}>{tc(option.label)}</FilterChip>)}</div>
          </div>
          <div className="ui-field words-filter-field"><span>{tc("单元")}</span><div className="words-category-chips" role="group" aria-label={tc("按单元筛选") as string}><FilterChip selected={!category} onClick={() => updateFilters({ category: null })}>{tc("全部单元")}</FilterChip>{(data?.availableCategories ?? []).map((item) => <FilterChip key={item} selected={category === item} onClick={() => updateFilters({ category: item })}>{item === "未分类" ? tc("未分类") : tc(item)}</FilterChip>)}</div></div>
        </div>
          </Card>

          {error && items.length === 0 ? <RetryState message={tc(error)} onRetry={() => setReloadKey((key) => key + 1)} /> : null}
          {loading ? <Card className="word-list-card" padded><div className="word-list-skeletons"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div></Card> : null}
          {!loading && !error && items.length === 0 ? <EmptyState title={tc("没有符合条件的已解锁词") } description={tc("可以先去单元闯关查看下一项可解锁内容。") } action={<Link className="ui-button ui-button-secondary ui-button-small" href="/units">{tc("查看单元")}</Link>} /> : null}
          {!loading && items.length > 0 ? <Card className="word-list-card" padded={false}>
        <div className="word-list-heading"><div><strong>{tc("已解鎖詞")}</strong><p className="word-list-heading-hint">{tc("點擊詞語查看中文意思及學習狀態。")}</p></div><span>{data?.total ?? items.length} {tc("個詞")}</span></div>
        <div className="word-list" aria-label={tc("已解锁词列表") as string}>{items.map((item) => <button key={item.id} ref={selected?.id === item.id ? triggerRef : undefined} type="button" className="word-list-row" onClick={() => setSelected(item)}><span className="word-list-term"><strong>{item.term}</strong><small>{item.phonetic || item.pos || item.level}</small></span><span className="word-list-definition">{tc(item.definition)}</span><span className={`word-status word-status-${item.status}`}>{statusText(item.status)}</span><Icon name="chevron-right" size={18} /></button>)}</div>
        <div className="word-list-footer">{error && items.length > 0 ? <StatusInline message={tc(error)} /> : null}{cursor ? <Button variant="secondary" loading={loadingMore} onClick={loadMore}>{tc("加载更多")}</Button> : <span className="ui-field-helper">{tc("已经显示全部符合条件的词")}</span>}</div>
          </Card> : null}
        </StudentSectionStack>
      </StudentPageStack>

      <BottomSheet open={selected !== null} onClose={() => setSelected(null)} title={selected?.term ?? ""} description={selected ? [selected.level, selected.category ? (selected.category === "未分类" ? tc("未分类") : selected.category) : null, selected.pos].filter(Boolean).join(" · ") : undefined} returnFocusRef={triggerRef}>
        {selected ? <div className="word-detail"><div className="word-detail-phonetic">{selected.phonetic || tc("暫無音標")}</div><p>{tc(selected.definition)}</p><div className="word-detail-state"><span>{tc("狀態")}</span><strong>{statusText(selected.status)}</strong></div>{selected.nextReviewAt ? <div className="word-detail-state"><span>{tc("下一次複習")}</span><strong>{nextReviewText(selected.nextReviewAt)}</strong></div> : null}<p className="ui-field-helper">{tc("詞表只供查閱，不會直接計入學習進度；認字卡完成小測後，進度才會更新。")} </p></div> : null}
      </BottomSheet>
    </div>
  );
}

function StatusInline({ message }: { message: string }) {
  return <span className="word-list-inline-error" role="alert">{message}</span>;
}
