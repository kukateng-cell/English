"use client";

import { useState } from "react";
import BrandLockup from "@/components/brand/BrandLockup";
import { useLocale } from "@/components/LocaleProvider";
import BottomSheet from "@/components/ui/BottomSheet";
import Button from "@/components/ui/Button";
import Card, { StatCard } from "@/components/ui/Card";
import FilterChip from "@/components/ui/FilterChip";
import Icon from "@/components/ui/Icon";
import IconButton from "@/components/ui/IconButton";
import PageHeader from "@/components/ui/PageHeader";
import ProgressBar from "@/components/ui/ProgressBar";
import { EmptyState, RetryState, Skeleton } from "@/components/ui/Feedback";
import SegmentedControl from "@/components/ui/SegmentedControl";
import StatusBanner from "@/components/ui/StatusBanner";
import Toast from "@/components/ui/Toast";

export default function UiFixture() {
  const { tc } = useLocale();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [segment, setSegment] = useState<"all" | "due" | "locked">("all");
  const [chipSelected, setChipSelected] = useState(false);

  return (
    <main id="main-content" className="mx-auto w-full max-w-[1120px] px-5 py-8 pb-24">
      <div className="mb-8 flex items-center justify-between gap-4">
        <BrandLockup />
        <span className="ui-eyebrow">{tc("元件預覽")}</span>
      </div>

      <PageHeader
        eyebrow={tc("Phase 1 · Design foundation")}
        title={tc("共用元件狀態預覽")}
        description={tc("這是受 ENABLE_TEST_ROUTES 保護的測試頁面，用於檢查鍵盤、長文案、主題和響應式佈局。")}
        action={<Button onClick={() => setSheetOpen(true)}><Icon name="info" size={18} />{tc("打開詳情")}</Button>}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label={tc("今日複習") as string} value="24" note={tc("真實資料頁面會顯示帳戶統計")} />
        <StatCard label={tc("長期掌握") as string} value="68%" note={tc("僅作元件狀態範例")} />
        <StatCard label={tc("連續學習") as string} value="7" note={tc("天")} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card padded>
          <h2 className="mb-4 font-display text-xl font-bold">{tc("按鈕")}</h2>
          <div className="flex flex-wrap gap-2">
            <Button>{tc("主要操作")}</Button>
            <Button variant="secondary">{tc("次要操作")}</Button>
            <Button variant="quiet">{tc("安靜操作")}</Button>
            <Button variant="danger">{tc("危險操作")}</Button>
            <Button disabled>{tc("已停用")}</Button>
            <Button loading>{tc("載入中")}</Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="small">{tc("小尺寸")}</Button>
            <Button size="large">{tc("大尺寸")}</Button>
          </div>
        </Card>

        <Card padded>
          <h2 className="mb-4 font-display text-xl font-bold">{tc("表單與焦點")}</h2>
          <div className="grid gap-3">
            <div className="ui-field">
              <label htmlFor="fixture-term">{tc("單詞")}</label>
              <input id="fixture-term" placeholder={tc("輸入較長的簡體或繁體文案")} />
              <span className="ui-field-helper">{tc("輔助說明會保持可讀並參與鍵盤順序")}</span>
            </div>
            <div className="ui-field">
              <label htmlFor="fixture-error">{tc("錯誤狀態")}</label>
              <input id="fixture-error" aria-invalid="true" aria-describedby="fixture-error-message" defaultValue="範例" />
              <span id="fixture-error-message" className="ui-field-error" role="alert">{tc("請檢查這個欄位")}</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card padded>
          <h2 className="mb-4 font-display text-xl font-bold">{tc("進度、切換與篩選")}</h2>
          <div className="grid gap-4">
            <ProgressBar label={tc("學習進度")} value={68} showValue />
            <SegmentedControl
              label={tc("查看範圍")}
              items={[{ value: "all", label: tc("全部") }, { value: "due", label: tc("待複習") }, { value: "locked", label: tc("鎖定"), disabled: true }]}
              value={segment}
              onChange={setSegment}
            />
            <div className="flex flex-wrap gap-2" aria-label={tc("篩選") as string}>
              <FilterChip selected={chipSelected} onClick={() => setChipSelected((selected) => !selected)}>{tc("只看已掌握")}</FilterChip>
              <FilterChip>{tc("A1")}</FilterChip>
            </div>
          </div>
        </Card>

        <Card padded>
          <h2 className="mb-4 font-display text-xl font-bold">{tc("回饋狀態")}</h2>
          <div className="grid gap-3">
            <StatusBanner variant="info" message={<><strong>{tc("提示")}</strong><p>{tc("這裡是資訊提示")}</p></>} />
            <StatusBanner variant="success" message={<><strong>{tc("已儲存")}</strong><p>{tc("成功狀態會使用青綠色")}</p></>} />
            <StatusBanner variant="error" message={<><strong>{tc("載入失敗")}</strong><p>{tc("錯誤狀態會提供可恢復行動")}</p></>} action={<Button size="small" variant="quiet">{tc("重試")}</Button>} />
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card padded>
          <h2 className="mb-4 font-display text-xl font-bold">{tc("載入狀態")}</h2>
          <div className="grid gap-3"><Skeleton className="h-5 w-2/3" label={tc("正在載入標題")} /><Skeleton className="h-4 w-full" /><Skeleton className="h-10 w-1/2" /></div>
        </Card>
        <EmptyState title={tc("沒有內容")} description={tc("空狀態要說明下一步可以做什麼。")} action={<Button size="small">{tc("開始學習")}</Button>} />
        <RetryState message={tc("暫時無法載入，請稍後重試")} onRetry={() => undefined} />
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Card padded>
          <h2 className="mb-4 font-display text-xl font-bold">{tc("圖標與提示")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <IconButton icon="menu" label={tc("打開選單")} />
            <IconButton icon="volume" label={tc("播放發音")} />
            <Toast variant="success" message={tc("提示已經儲存")} onDismiss={() => undefined} />
          </div>
        </Card>
      </div>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={tc("元件詳情")} description={tc("支援 Escape、焦點循環、返回原控制及安全區。")}
        actions={<><Button variant="secondary" onClick={() => setSheetOpen(false)}>{tc("關閉")}</Button><Button onClick={() => setSheetOpen(false)}>{tc("確認")}</Button></>}
      >
        <p>{tc("這是一個可滾動的 bottom sheet 內容區域。長文案在手機、平板和桌面寬度下都應保持可讀，不應被祖先 overflow 裁切。")}</p>
      </BottomSheet>
    </main>
  );
}
