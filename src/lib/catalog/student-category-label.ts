import type { CatalogCategory } from "./taxonomy";

/**
 * 學生端單元（分類）中文名稱。
 *
 * 與教師端 `catalogCategoryLabel` 的分工：
 * - 教師端在詞庫工作區看到未知代碼時顯示「其他主題」，讓管理員察覺資料異常。
 * - 學生端只會看到已解鎖的正式內容，未知或空白值一律顯示「未分類」，避免內部
 *   英文代碼或其他維運訊號出現在學習畫面；分類本身是 `other` 時仍然顯示
 *   「其他主題」。
 *
 * 回傳值一律是經審定的繁體中文原文；顯示時必須再經 `useLocale().tc()`（或
 * LocaleProvider 的轉換機制），簡體模式才會由同一份繁體原文衍生簡體字。
 */
const STUDENT_CATEGORY_LABELS: Record<CatalogCategory, string> = {
  "people-family": "人物與家庭",
  "time-calendar": "時間與日曆",
  "numbers-quantity": "數字與數量",
  "body-health": "身體與健康",
  "food-drink": "飲食",
  "clothing-appearance": "衣著與外貌",
  "home-household": "家居生活",
  "school-education": "學校與教育",
  "work-business": "工作與商業",
  "places-community": "地點與社區",
  "travel-transport": "旅遊與交通",
  "nature-weather": "自然與天氣",
  "animals-plants": "動植物",
  "sports-leisure": "運動與休閒",
  "arts-culture-media": "藝術、文化與媒體",
  technology: "科技",
  "science-mathematics": "科學與數學",
  "society-law-politics": "社會、法律與政治",
  "emotions-personality": "情緒與性格",
  "communication-language": "溝通與語言",
  "actions-events": "動作與事件",
  "descriptions-qualities": "描述與特質",
  "abstract-concepts": "抽象概念",
  "function-words": "功能詞",
  other: "其他主題",
};

/**
 * 把單元（分類）代碼轉成學生端顯示用中文名稱。
 *
 * 空白、`null`、舊版「未分類」標籤及任何未知代碼都回「未分類」；只有正式
 * taxonomy 中的 `other` 分類回「其他主題」。本檔只負責顯示，不改變或轉換
 * 任何資料，也不影響教師端行為。
 */
export function studentCategoryLabel(value: string | null | undefined): string {
  const normalized = value?.normalize("NFKC").trim() ?? "";
  if (!normalized) return "未分類";
  return STUDENT_CATEGORY_LABELS[normalized as CatalogCategory] ?? "未分類";
}
