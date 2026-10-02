export type NewWordSortRecord = {
  id: string;
  term: string;
};

/**
 * 以資料庫查出的 contacted／untouched 分區作為排序依據。
 * contactTimes 只載入有上限的歷史窗口；沒有時間的已接觸詞不可重新變成 new。
 */
export function compareNewWordCandidates(
  left: NewWordSortRecord,
  right: NewWordSortRecord,
  contactedWordIds: ReadonlySet<string>,
  contactTimes: ReadonlyMap<string, number>,
): number {
  const leftContacted = contactedWordIds.has(left.id);
  const rightContacted = contactedWordIds.has(right.id);
  if (leftContacted !== rightContacted) return leftContacted ? 1 : -1;

  const leftContact = contactTimes.get(left.id);
  const rightContact = contactTimes.get(right.id);
  if (leftContacted && rightContacted) {
    if (leftContact === undefined && rightContact !== undefined) return 1;
    if (leftContact !== undefined && rightContact === undefined) return -1;
    if (leftContact !== undefined && rightContact !== undefined && leftContact !== rightContact) {
      return leftContact - rightContact;
    }
  }
  return left.term.localeCompare(right.term, "en", { sensitivity: "base" }) || left.id.localeCompare(right.id);
}

export function newWordSelectionReason(
  wordId: string,
  contactedWordIds: ReadonlySet<string>,
): "unverified-contact" | "new-word" {
  return contactedWordIds.has(wordId) ? "unverified-contact" : "new-word";
}

export type RecentStreamRow = {
  itemKind: string;
  usedAt: Date | null;
  feedbackAcknowledgedAt: Date | null;
};

export type RecentStreamShape = {
  consecutiveProbes: number;
  acknowledgedItemsSinceProbe: number;
  hasPreviousProbe: boolean;
};

/**
 * 從 newest-first history 計算最近一段已確認 probe，以及其後的已確認 item 數量。
 * 未確認 feedback 的 probe 不應影響 scheduler gap。
 */
export function recentStreamShape(rows: RecentStreamRow[]): RecentStreamShape {
  let consecutiveProbes = 0;
  let acknowledgedItemsSinceProbe = 0;
  let hasPreviousProbe = false;
  let started = false;
  for (const row of rows) {
    const acknowledged = row.usedAt !== null && (
      row.itemKind !== "OBJECTIVE_PROBE" || row.feedbackAcknowledgedAt !== null
    );
    if (!acknowledged) continue;
    if (!started) {
      started = true;
      if (row.itemKind === "OBJECTIVE_PROBE") {
        consecutiveProbes = 1;
        hasPreviousProbe = true;
      }
      else acknowledgedItemsSinceProbe = 1;
      continue;
    }
    if (consecutiveProbes > 0) {
      // rows 是 newest-first；遇到較舊的非 probe 就離開目前連續段。
      if (row.itemKind !== "OBJECTIVE_PROBE") break;
      consecutiveProbes += 1;
      hasPreviousProbe = true;
      continue;
    }
    if (row.itemKind === "OBJECTIVE_PROBE") {
      hasPreviousProbe = true;
      break;
    }
    acknowledgedItemsSinceProbe += 1;
  }
  return { consecutiveProbes, acknowledgedItemsSinceProbe, hasPreviousProbe };
}
