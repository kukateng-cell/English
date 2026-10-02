/**
 * Catalog workspace 會在瀏覽器使用的純文字 helper。
 *
 * 這些函式不讀取 React state、瀏覽器 API 或資料庫，方便表單、重試提示及 unit test
 * 共用；產品 contract 仍由 server-side catalog parser／validator 決定。
 */

export function normalizeCatalogClientText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

export function parseList(value: string): string[] {
  return value
    .split("|")
    .map((item) => item.normalize("NFKC").trim())
    .filter(Boolean);
}

export function listText(value: readonly string[] | null | undefined): string {
  return (value ?? []).join(" | ");
}

export function retryConflictValueText(
  value: unknown,
  tc: (value: string) => string,
): string {
  if (value === null || value === undefined || value === "")
    return tc("（空白）");
  if (Array.isArray(value))
    return value.length ? value.join(" | ") : tc("（空白）");
  if (typeof value === "boolean") return value ? tc("啟用") : tc("停用");
  return String(value);
}
