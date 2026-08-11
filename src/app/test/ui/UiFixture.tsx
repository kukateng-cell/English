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
        <span className="ui-eyebrow">{tc("组件预览")}</span>
      </div>

      <PageHeader
        eyebrow={tc("Phase 1 · Design foundation")}
        title={tc("共用组件状态预览")}
        description={tc("这是受 ENABLE_TEST_ROUTES 保护的测试页面，用于检查键盘、长文案、主题和响应式布局。")}
        action={<Button onClick={() => setSheetOpen(true)}><Icon name="info" size={18} />{tc("打开详情")}</Button>}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label={tc("今日复习") as string} value="24" note={tc("真实数据页面会显示账户统计")} />
        <StatCard label={tc("长期掌握") as string} value="68%" note={tc("仅作组件状态示例")} />
        <StatCard label={tc("连续学习") as string} value="7" note={tc("天")} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card padded>
          <h2 className="mb-4 font-display text-xl font-bold">{tc("按钮")}</h2>
          <div className="flex flex-wrap gap-2">
            <Button>{tc("主要操作")}</Button>
            <Button variant="secondary">{tc("次要操作")}</Button>
            <Button variant="quiet">{tc("安静操作")}</Button>
            <Button variant="danger">{tc("危险操作")}</Button>
            <Button disabled>{tc("已禁用")}</Button>
            <Button loading>{tc("加载中")}</Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="small">{tc("小尺寸")}</Button>
            <Button size="large">{tc("大尺寸")}</Button>
          </div>
        </Card>

        <Card padded>
          <h2 className="mb-4 font-display text-xl font-bold">{tc("表单与焦点")}</h2>
          <div className="grid gap-3">
            <div className="ui-field">
              <label htmlFor="fixture-term">{tc("单词")}</label>
              <input id="fixture-term" placeholder={tc("输入较长的简体或繁体文案")} />
              <span className="ui-field-helper">{tc("辅助说明会保持可读并参与键盘顺序")}</span>
            </div>
            <div className="ui-field">
              <label htmlFor="fixture-error">{tc("错误状态")}</label>
              <input id="fixture-error" aria-invalid="true" aria-describedby="fixture-error-message" defaultValue="示例" />
              <span id="fixture-error-message" className="ui-field-error" role="alert">{tc("请检查这个字段")}</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card padded>
          <h2 className="mb-4 font-display text-xl font-bold">{tc("进度、切换与筛选")}</h2>
          <div className="grid gap-4">
            <ProgressBar label={tc("学习进度")} value={68} showValue />
            <SegmentedControl
              label={tc("查看范围")}
              items={[{ value: "all", label: tc("全部") }, { value: "due", label: tc("待复习") }, { value: "locked", label: tc("锁定"), disabled: true }]}
              value={segment}
              onChange={setSegment}
            />
            <div className="flex flex-wrap gap-2" aria-label={tc("筛选") as string}>
              <FilterChip selected={chipSelected} onClick={() => setChipSelected((selected) => !selected)}>{tc("只看已掌握")}</FilterChip>
              <FilterChip>{tc("A1")}</FilterChip>
            </div>
          </div>
        </Card>

        <Card padded>
          <h2 className="mb-4 font-display text-xl font-bold">{tc("反馈状态")}</h2>
          <div className="grid gap-3">
            <StatusBanner variant="info" message={<><strong>{tc("提示")}</strong><p>{tc("这里是信息提示")}</p></>} />
            <StatusBanner variant="success" message={<><strong>{tc("已保存")}</strong><p>{tc("成功状态会使用青绿色")}</p></>} />
            <StatusBanner variant="error" message={<><strong>{tc("加载失败")}</strong><p>{tc("错误状态会提供可恢复行动")}</p></>} action={<Button size="small" variant="quiet">{tc("重试")}</Button>} />
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card padded>
          <h2 className="mb-4 font-display text-xl font-bold">{tc("加载状态")}</h2>
          <div className="grid gap-3"><Skeleton className="h-5 w-2/3" label={tc("正在加载标题")} /><Skeleton className="h-4 w-full" /><Skeleton className="h-10 w-1/2" /></div>
        </Card>
        <EmptyState title={tc("没有内容")} description={tc("空状态要说明下一步可以做什么。")} action={<Button size="small">{tc("开始学习")}</Button>} />
        <RetryState message={tc("暂时无法加载，请稍后重试")} onRetry={() => undefined} />
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Card padded>
          <h2 className="mb-4 font-display text-xl font-bold">{tc("图标与提示")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <IconButton icon="menu" label={tc("打开菜单")} />
            <IconButton icon="volume" label={tc("播放发音")} />
            <Toast variant="success" message={tc("提示已经保存")} onDismiss={() => undefined} />
          </div>
        </Card>
      </div>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={tc("组件详情")} description={tc("支持 Escape、焦点循环、返回原控制及安全区。")}
        actions={<><Button variant="secondary" onClick={() => setSheetOpen(false)}>{tc("关闭")}</Button><Button onClick={() => setSheetOpen(false)}>{tc("确认")}</Button></>}
      >
        <p>{tc("这是一个可滚动的 bottom sheet 内容区域。长文案在手机、平板和桌面宽度下都应保持可读，不应被祖先 overflow 裁切。")}</p>
      </BottomSheet>
    </main>
  );
}
