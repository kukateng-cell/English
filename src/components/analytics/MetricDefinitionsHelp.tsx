"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import Icon from "@/components/ui/Icon";

type MetricDefinitionsHelpProps = {
  context: "progress" | "trend" | "analytics" | "class-summary";
};

export default function MetricDefinitionsHelp({ context }: MetricDefinitionsHelpProps) {
  const { tc } = useLocale();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const definitions = context === "class-summary"
    ? [
        ["近七日使用率", "最近七日內完成過認字卡回想或客觀測驗的學生比例；登入或查看詞表不會計入。"],
        ["今日有學習", "今天完成過認字卡回想或客觀測驗的學生人數。"],
        ["需複習學生", "至少有一個詞語已到複習時間的學生人數。"],
        ["累計平均掌握", "截至目前，班內每位學生已達掌握標準的詞語比例平均值；日期範圍不會直接限制此數值。"],
        ["各程度累計平均掌握", "按 A1、A2、B1、B2 分開顯示班級目前的掌握比例。"],
      ]
    : context === "progress"
    ? [
        ["比較", "選取學生後，可以在下方比較他們的學習表現。"],
        ["學生／學號／班別", "顯示學生暱稱、登入帳號、班內學號及目前班別。"],
        ["掌握", "目前已達到掌握標準的詞數，以及佔整個詞庫的比例。"],
        ["測驗次數", "客觀測驗是完成的測驗次數；已計入測驗是已真正更新學習進度的次數。"],
        ["今日認字", "當日完成認字卡回想的次數；只查看詞表不會計入。"],
        ["待複習／最近活動", "目前需要複習的詞數，以及最近一次學習活動日期。"],
      ]
    : context === "trend"
      ? [
          ["練習", "當日完成認字卡回想的次數。"],
          ["已計入測驗", "當日已計入學習進度的測驗次數。"],
          ["客觀測驗", "當日客觀測驗答對次數／作答次數。"],
          ["正確率", "客觀測驗中答對的比例；沒有有效作答時顯示「—」。"],
        ]
      : [
          ["活躍率", "所選期間內有學習記錄的學生比例。"],
          ["測驗答對率", "客觀測驗中答對的比例；沒有作答時顯示「—」。"],
          ["平均掌握", "所選學生目前已掌握詞語的平均比例。"],
          ["待複習學生", "目前有詞語需要複習的學生人數。"],
          ["今日認字", "當日完成認字卡回想的總次數。"],
        ];

  return (
    <div
      ref={containerRef}
      className="metric-definitions-help"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="metric-definitions-button"
        aria-label={tc("查看欄位說明")}
        aria-expanded={open}
        aria-controls={panelId}
        title={tc("查看欄位說明")}
        onClick={() => setOpen((value) => !value)}
        onFocus={() => setOpen(true)}
      >
        <Icon name="info" size={17} />
        <span className="sr-only">{tc("欄位說明")}</span>
      </button>
      {open ? (
        <div id={panelId} role="tooltip" className="metric-definitions-popover">
          <p className="metric-definitions-title">{tc("欄位說明")}</p>
          <dl>
            {definitions.map(([label, description]) => (
              <div key={label}>
                <dt>{tc(label)}</dt>
                <dd>{tc(description)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
