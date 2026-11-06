/** Shared client/server limits for the learning-analytics comparison contract. */
// A school may have more than six classes in one grade.  Keep the comparison
// contract generous enough for a full-grade view while retaining a bounded
// request/response size for the scrollable comparison table.
export const MAX_ANALYTICS_CLASS_SELECTION = 200;

// Student exports may carry up to 500 opaque IDs.  Keep the query parser's
// 16 KiB cap, but give the export DTO enough room for its documented maximum
// (including IDs at the 128-byte validation limit).
export const MAX_ANALYTICS_EXPORT_BODY_BYTES = 96 * 1024;

/** Asia/Shanghai 沒有夏令時間，固定 UTC+8，可直接用位移計算本日界線。 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 距離下一個 Asia/Shanghai 00:00 的毫秒數。
 *
 * 活躍率按本地曆日結算，分析頁需要在每日 00:00 之後自動重新抓取，讓剛結束的
 * 一日計入。「今日」以 Asia/Shanghai 為準（見 `todayKey()`），因此日界亦用
 * 固定 UTC+8 計算；額外加 `bufferMs`，避免計時器與伺服器時鐘邊界競爭。
 */
export function millisecondsUntilNextShanghaiMidnight(
  now: Date = new Date(),
  bufferMs = 5_000,
): number {
  const localTime = now.getTime() + SHANGHAI_OFFSET_MS;
  const nextLocalMidnight = Math.floor(localTime / DAY_MS) * DAY_MS + DAY_MS;
  return Math.max(0, nextLocalMidnight - SHANGHAI_OFFSET_MS + bufferMs - now.getTime());
}
