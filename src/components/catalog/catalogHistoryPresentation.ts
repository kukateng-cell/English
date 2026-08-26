export type CatalogHistoryTranslate = (value: string) => string;

export function catalogHistoryDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-HK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export function catalogHistoryComparable(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(
      [...value].map(String).sort((left, right) => left.localeCompare(right, "en")),
    );
  }
  return JSON.stringify(value ?? null);
}

export function catalogHistoryValueText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length ? value.map(String).join("、") : "—";
  }
  if (typeof value === "boolean") return value ? "啟用" : "停用";
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value);
}

export function catalogHistoryArrayChangeText(
  before: unknown,
  after: unknown,
  tc: CatalogHistoryTranslate,
): string | null {
  if (!Array.isArray(before) && !Array.isArray(after)) return null;
  const previous = new Set((Array.isArray(before) ? before : []).map(String));
  const current = new Set((Array.isArray(after) ? after : []).map(String));
  const added = [...current].filter((value) => !previous.has(value));
  const removed = [...previous].filter((value) => !current.has(value));
  const parts = [
    added.length ? `${tc("新增")}：${added.join("、")}` : "",
    removed.length ? `${tc("移除")}：${removed.join("、")}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("；") : tc("內容次序已調整");
}
