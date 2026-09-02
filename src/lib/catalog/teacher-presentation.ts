import {
  CATALOG_CATEGORIES,
  type CatalogPartOfSpeech,
} from "./taxonomy";
import { CATALOG_UNSUPPORTED_STRUCTURED_ISSUE_CODE } from "./validation-issue-contract";

export type CatalogLifecycleState = "ACTIVE" | "DRAFT" | "RETIRED";
export type CatalogWorkflowState = "NONE" | "PENDING";
export type CatalogReadinessState =
  | "BOTH"
  | "EN_TO_ZH_ONLY"
  | "ZH_TO_EN_ONLY"
  | "UNAVAILABLE";
export type CatalogContentScope =
  | "CURRENT_CONTENT"
  | "PENDING_DRAFT"
  | "IMPORT_DRAFT";
export type CatalogIssueDirection = "EN_TO_ZH" | "ZH_TO_EN" | null;

export type CatalogStructuredIssue = {
  code: string;
  field: string | null;
  direction: CatalogIssueDirection;
  severity: "ERROR" | "WARNING";
};

export type CatalogIssuePresentation = CatalogStructuredIssue & {
  fieldLabel: string;
  directionLabel: string | null;
  reason: string;
  fix: string;
};

const POS_LABELS: Record<CatalogPartOfSpeech, string> = {
  noun: "名詞",
  verb: "動詞",
  adjective: "形容詞",
  adverb: "副詞",
  pronoun: "代詞",
  preposition: "介詞",
  conjunction: "連詞",
  determiner: "限定詞",
  interjection: "感嘆詞",
  numeral: "數詞",
  phrase: "短語",
  phrasal_verb: "短語動詞",
  proper_noun: "專有名詞",
  abbreviation: "縮寫",
  auxiliary: "助動詞",
  modal: "情態動詞",
  particle: "助詞",
  other: "其他詞性",
} as const;

const LEGACY_POS_ALIASES: Record<string, CatalogPartOfSpeech> = {
  "phrasal verb": "phrasal_verb",
  "proper noun": "proper_noun",
  "modal verb": "modal",
  "auxiliary verb": "auxiliary",
};

const CATEGORY_LABELS: Record<(typeof CATALOG_CATEGORIES)[number], string> = {
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

const FIELD_LABELS: Record<string, string> = {
  term: "英文詞",
  lemma: "詞頭",
  partOfSpeech: "詞性",
  level: "程度",
  category: "主題",
  definitionZh: "中文釋義",
  acceptedAnswersZh: "其他可接受中文譯法",
  acceptedFormsEn: "其他可接受英文形式",
  exampleEn: "英文例句",
  exampleZh: "中文例句",
  enableEnToZh: "英譯中設定",
  enableZhToEn: "中譯英設定",
  distractorZh: "英譯中干擾項",
  distractorEn: "中譯英干擾項",
  synonymsEn: "英文近義詞",
  antonymsEn: "英文反義詞",
};

const ISSUE_COPY: Record<string, { reason: string; fix: string }> = {
  [CATALOG_UNSUPPORTED_STRUCTURED_ISSUE_CODE]: {
    reason: "內容使用了未支援的檢查結果版本。",
    fix: "請重新匯入或重新儲存內容；如持續出現，請通知詞庫管理員。",
  },
  CATALOG_CONTENT_REQUIRES_REVIEW: {
    reason: "內容未符合目前詞庫要求。",
    fix: "請打開「查看／修改」，按欄位提示補充或更正內容。",
  },
  CATALOG_PARSE_INVALID: {
    reason: "欄位格式無法安全讀取。",
    fix: "請重新輸入欄位，並移除不支援的格式或字元。",
  },
  CATALOG_SCHEMA_UNSUPPORTED: {
    reason: "內容使用了不支援的詞庫格式版本。",
    fix: "請以目前老師範本重新建立內容。",
  },
  CATALOG_TERM_REQUIRED: {
    reason: "尚未填寫英文詞。",
    fix: "請填寫學生會看到的英文詞。",
  },
  CATALOG_LEMMA_REQUIRED: {
    reason: "尚未填寫詞頭。",
    fix: "請填寫這個詞義所屬的英文詞頭。",
  },
  CATALOG_POS_REQUIRED: {
    reason: "尚未選擇詞性。",
    fix: "請選擇最符合這個詞義的詞性。",
  },
  CATALOG_POS_UNKNOWN: {
    reason: "詞性不是目前詞庫支援的分類。",
    fix: "請從詞性選單重新選擇最合適的分類。",
  },
  CATALOG_LEVEL_INVALID: {
    reason: "程度不是目前支援的 A1 至 B2。",
    fix: "請重新選擇 A1、A2、B1 或 B2。",
  },
  CATALOG_CATEGORY_REQUIRED: {
    reason: "尚未選擇主題。",
    fix: "請從主題選單選擇最合適的分類。",
  },
  CATALOG_CATEGORY_UNKNOWN: {
    reason: "主題不在目前詞庫分類內。",
    fix: "請從主題選單重新選擇。",
  },
  CATALOG_DEFINITION_REQUIRED: {
    reason: "尚未填寫中文釋義。",
    fix: "請填寫簡潔、無歧義的中文主要釋義。",
  },
  CATALOG_PROMPT_NOT_EMPTY: {
    reason: "題幹由系統建立，不能另填自訂提示。",
    fix: "請清除自訂題幹內容。",
  },
  CATALOG_BOOTSTRAP_STATUS_INVALID: {
    reason: "匯入草稿包含不適用的正式狀態。",
    fix: "請清除狀態欄，或只使用匯入範本容許的草稿值。",
  },
  CATALOG_BOOTSTRAP_ACTION_INVALID: {
    reason: "匯入草稿使用了不適用的操作類型。",
    fix: "請以目前匯入範本的新增草稿操作重新提交。",
  },
  CATALOG_GOVERNANCE_ACTION_INVALID: {
    reason: "修改內容使用了不支援的提交操作。",
    fix: "請重新開啟詞條，並使用新增或修改流程提交。",
  },
  CATALOG_RETIREMENT_REASON_INVALID: {
    reason: "新增或修改內容不應包含停用原因。",
    fix: "請清除停用原因；如需停用詞義，請使用停用操作。",
  },
  CATALOG_SOURCE_METADATA_REQUIRED: {
    reason: "提交記錄欠缺必要的來源資料。",
    fix: "請重新載入詞條後再次提交。",
  },
  CATALOG_CREATE_IDENTITY_INVALID: {
    reason: "新增詞義包含只適用於現有詞條的系統資料。",
    fix: "請重新建立新增草稿，不要沿用舊詞條識別資料。",
  },
  CATALOG_UPDATE_IDENTITY_REQUIRED: {
    reason: "修改詞義欠缺原詞條識別資料。",
    fix: "請由完整詞庫重新開啟該詞條後提交。",
  },
  CATALOG_UPDATE_REVISION_REQUIRED: {
    reason: "修改詞義欠缺要比對的版本。",
    fix: "請重新載入最新版本，再次提交修改。",
  },
  CATALOG_UPDATE_STATUS_INVALID: {
    reason: "修改內容帶有未能識別的詞條狀態。",
    fix: "請重新載入詞條，確認狀態後再提交。",
  },
  CATALOG_EXAMPLE_ZH_REQUIRED: {
    reason: "已有英文例句，但欠缺中文例句。",
    fix: "請補上對應中文例句，或同時清除兩個例句。",
  },
  CATALOG_EXAMPLE_EN_REQUIRED: {
    reason: "已有中文例句，但欠缺英文例句。",
    fix: "請補上對應英文例句，或同時清除兩個例句。",
  },
  CATALOG_DISTRACTOR_COUNT: {
    reason: "有效干擾項數量不足或過多；每個啟用方向需要 5 至 6 個。",
    fix: "請補充或刪減至 5 至 6 個不重複干擾項。",
  },
  CATALOG_DISTRACTOR_DUPLICATE: {
    reason: "干擾項內有重複答案。",
    fix: "請移除重複項，並以意思不同的答案補足。",
  },
  CATALOG_DISTRACTOR_CANONICAL_COLLISION: {
    reason: "干擾項包含目前正確答案。",
    fix: "請換成不是正確答案的干擾項。",
  },
  CATALOG_DISTRACTOR_ACCEPTED_COLLISION: {
    reason: "干擾項與可接受答案、近義詞或反義詞重疊。",
    fix: "請換成不會被學生合理視為正確的答案。",
  },
  CATALOG_DISTRACTOR_SIBLING_COLLISION: {
    reason: "干擾項撞到同一英文詞的另一個正確詞義。",
    fix: "請換成不屬於同一英文詞其他詞義的答案。",
  },
  CATALOG_DIRECTIONS_DISABLED: {
    reason: "兩種題型都未啟用。",
    fix: "請完成至少一個方向的內容，再啟用該題型。",
  },
};

export function catalogLifecycleLabel(value: CatalogLifecycleState): string {
  if (value === "ACTIVE") return "已啟用";
  if (value === "RETIRED") return "已停用";
  return "草稿（未供學生使用）";
}

export function catalogWorkflowLabel(value: CatalogWorkflowState): string {
  return value === "PENDING" ? "有修改等待審核" : "無待審修改";
}

export function catalogReadinessLabel(value: CatalogReadinessState): string {
  if (value === "BOTH") return "兩種題型可用";
  if (value === "EN_TO_ZH_ONLY") return "只可英譯中";
  if (value === "ZH_TO_EN_ONLY") return "只可中譯英";
  return "暫不可出題";
}

export function catalogContentScopeLabel(value: CatalogContentScope): string {
  if (value === "CURRENT_CONTENT") return "目前正式版本";
  if (value === "PENDING_DRAFT") return "待審版本";
  return "匯入草稿";
}

export function catalogPartOfSpeechLabel(
  value: string | null | undefined,
): string {
  const normalized =
    value?.normalize("NFKC").trim().toLocaleLowerCase("en-US") ?? "";
  if (!normalized) return "未分類";
  const canonical =
    normalized in POS_LABELS
      ? (normalized as CatalogPartOfSpeech)
      : LEGACY_POS_ALIASES[normalized];
  return canonical ? POS_LABELS[canonical] : "其他詞性";
}

export function catalogCategoryLabel(value: string | null | undefined): string {
  const normalized = value?.normalize("NFKC").trim() ?? "";
  if (!normalized) return "未分類";
  return (
    CATEGORY_LABELS[normalized as keyof typeof CATEGORY_LABELS] ?? "其他主題"
  );
}

export function catalogFieldLabel(value: string | null | undefined): string {
  return value ? (FIELD_LABELS[value] ?? "詞庫內容") : "詞庫內容";
}

export function catalogDirectionLabel(
  value: CatalogIssueDirection,
): string | null {
  if (value === "EN_TO_ZH") return "英譯中";
  if (value === "ZH_TO_EN") return "中譯英";
  return null;
}

export function catalogIssuePresentation(
  issue: CatalogStructuredIssue,
): CatalogIssuePresentation {
  const copy = ISSUE_COPY[issue.code] ?? {
    reason: "內容出現未能識別的檢查結果。",
    fix: "請重新載入後再試；如持續出現，請通知詞庫管理員。",
  };
  return {
    ...issue,
    fieldLabel: catalogFieldLabel(issue.field),
    directionLabel: catalogDirectionLabel(issue.direction),
    reason: copy.reason,
    fix: copy.fix,
  };
}

export function catalogRequestKindLabel(value: string): string {
  if (value === "CREATE") return "新增詞義";
  if (value === "UPDATE") return "修改詞義";
  if (value === "RETIRE") return "停用詞義";
  if (value === "REACTIVATE") return "重新啟用詞義";
  return "未能識別的修改類型";
}

export function catalogRequestStatusLabel(value: string): string {
  if (value === "PENDING") return "等待審核";
  if (value === "APPROVED") return "已批准";
  if (value === "REJECTED") return "已拒絕";
  if (value === "CANCELLED") return "已取消";
  if (value === "STALE") return "需要重新比對";
  if (value === "EXPIRED") return "已過期";
  return "未能識別的記錄狀態";
}

export function catalogBatchStatusLabel(value: string): string {
  if (value === "PREVIEW") return "預覽中";
  if (value === "SUBMITTED") return "已提交";
  if (value === "REVIEWING") return "審核中";
  if (value === "REVIEWED") return "已完成審核";
  if (value === "COMMITTING") return "正在正式套用";
  if (value === "COMMITTED") return "已正式套用";
  if (value === "REJECTED") return "已拒絕";
  if (value === "EXPIRED") return "已過期";
  if (value === "SUPERSEDED") return "已有修正版取代";
  return "未能識別的批次狀態";
}

export function catalogHistorySourceLabel(value: string): string {
  if (value === "STANDALONE_REQUEST") return "逐條修改";
  if (value === "BATCH") return "CSV 批量修改";
  if (value === "INITIAL_BASELINE") return "最初匯入";
  return "未能識別的記錄來源";
}

export function catalogSourceSummary(
  sourceFile: string | null,
  sourceRow: number | null,
): string {
  if (!sourceFile || sourceFile === "governance") return "老師詞庫修改";
  const level = sourceFile
    .match(/(?:^|[/_-])(a1|a2|b1|b2)(?:[/_.-]|$)/iu)?.[1]
    ?.toUpperCase();
  const row = sourceRow && sourceRow > 0 ? `，第 ${sourceRow} 行` : "";
  return level ? `初始詞表 ${level}${row}` : `詞庫匯入${row}`;
}
