export interface ActivityDay {
  day: string;
  count: number;
}

export type ActivityHeatmapCell =
  | { key: string; placeholder: true; day: null; count: 0; level: 0 }
  | { key: string; placeholder: false; day: string; count: number; level: number };

export interface ActivityHeatmap {
  columnCount: number;
  maxCount: number;
  cells: ActivityHeatmapCell[];
}

function weekdayIndex(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(date)
    ? new Date(Date.UTC(year, month - 1, date)).getUTCDay()
    : 0;
}

/** Arrange ascending activity dates into GitHub-style Sunday-to-Saturday columns. */
export function buildActivityHeatmap(activity: readonly ActivityDay[]): ActivityHeatmap {
  if (activity.length === 0) {
    return { columnCount: 1, maxCount: 0, cells: Array.from({ length: 7 }, (_, index) => ({ key: `placeholder-${index}`, placeholder: true as const, day: null, count: 0 as const, level: 0 as const })) };
  }

  const startOffset = weekdayIndex(activity[0].day);
  const columnCount = Math.ceil((startOffset + activity.length) / 7);
  const maxCount = Math.max(0, ...activity.map((item) => item.count));
  const safeMax = Math.max(1, maxCount);
  const cells: ActivityHeatmapCell[] = [];

  for (let index = 0; index < columnCount * 7; index += 1) {
    const activityIndex = index - startOffset;
    if (activityIndex < 0 || activityIndex >= activity.length) {
      cells.push({ key: `placeholder-${index}`, placeholder: true, day: null, count: 0, level: 0 });
      continue;
    }
    const item = activity[activityIndex];
    cells.push({
      key: item.day,
      placeholder: false,
      day: item.day,
      count: item.count,
      level: item.count > 0 ? Math.max(1, Math.ceil((item.count / safeMax) * 4)) : 0,
    });
  }

  return { columnCount, maxCount, cells };
}
