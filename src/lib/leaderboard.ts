/**
 * 學生每週排行榜。
 *
 * 榜單係一個 read-only projection：活動仍由 V2 learning writers 寫入，
 * 本模組只按固定 student-weekly-v1 政策建立本週快照。公開 response 只
 * 返回暱稱、分數及不透明 entry key，唔返回帳號、姓名、學號或內部 ID。
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ClassCode, StudentGrade } from "@/generated/prisma";
import { Prisma, prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/roles";
import { todayKey, offsetDay } from "@/lib/streak";
import { withCurrentCatalogWord } from "@/lib/catalog/runtime";
import {
  buildStudentReward,
  loadRewardActivityForMembers,
  type RewardLoadedActivity,
  type RewardMember,
  type RewardRange,
} from "@/lib/learning-reward-analytics";
import {
  buildWeeklyDateRange,
  daysBetweenKeys,
  gapToNextWeeklyRank,
  nearbyWeeklyEntries,
  rankWeeklyEntries,
  scorePartsForDisplay,
  startOfLeaderboardWeek,
  STUDENT_WEEKLY_CURSOR_TTL_MS,
  STUDENT_WEEKLY_LEADERBOARD_POLICY_VERSION,
  STUDENT_WEEKLY_LEADERBOARD_WEIGHTS,
  STUDENT_WEEKLY_PAGE_SIZE,
  type WeeklyDateRange,
  type WeeklyRankedEntry,
  type WeeklyRankingCandidate,
  type WeeklyRankingState,
  weeklyGoalTargetDays,
} from "@/lib/student-weekly-leaderboard-policy";

export const LEADERBOARD_SCOPES = ["class", "grade", "school"] as const;
export type LeaderboardScope = (typeof LEADERBOARD_SCOPES)[number];
export type LeaderboardView = "summary" | "all";

/** Retained as a small utility for existing streak consumers and unit tests. */
export type LeaderboardType = "streak" | "words" | "studyDays";

export function isLeaderboardScope(value: string): value is LeaderboardScope {
  return (LEADERBOARD_SCOPES as readonly string[]).includes(value);
}

/**
 * 純函數：由今天／昨天開始計算目前連續日數。保留俾現有純邏輯測試；
 * weekly leaderboard 本身按每週活動日計分，唔用此指標排序。
 */
export function countLeaderboardStreak(dates: Set<string>, now = new Date()): number {
  const today = todayKey(now);
  const yesterday = offsetDay(today, -1);
  let cursor: string | null = null;
  if (dates.has(today)) cursor = today;
  else if (dates.has(yesterday)) cursor = yesterday;
  else return 0;
  let count = 0;
  while (cursor && dates.has(cursor)) {
    count += 1;
    cursor = offsetDay(cursor, -1);
  }
  return count;
}

/** 標準競賽排名：相同分值並列名次（1,1,3,...），同分以穩定 ID 排列。 */
export function rankLeaderboardEntries(
  values: { userId: string; name: string; value: number }[],
  me: string,
) {
  const sorted = [...values].sort((a, b) => b.value - a.value || a.userId.localeCompare(b.userId));
  const entries: Array<{ rank: number; userId: string; name: string; value: number; isMe: boolean }> = [];
  let previousValue: number | null = null;
  let previousRank = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const value = sorted[index];
    const rank = value.value === previousValue ? previousRank : index + 1;
    previousValue = value.value;
    previousRank = rank;
    entries.push({ rank, userId: value.userId, name: value.name, value: value.value, isMe: value.userId === me });
  }
  return entries;
}

/** Existing helper retained for callers that still need a compact old-style list. */
export function trimLeaderboardEntries<T extends { isMe: boolean }>(entries: T[], topN = 20): T[] {
  if (entries.length <= topN) return entries;
  const top = entries.slice(0, topN);
  if (top.some((entry) => entry.isMe)) return top;
  const me = entries.find((entry) => entry.isMe);
  return me ? [...top, me] : top;
}

export function chooseDefaultLeaderboardScope(context: { classId: string | null; grade: StudentGrade | null }): LeaderboardScope {
  if (context.classId) return "class";
  if (context.grade) return "grade";
  return "school";
}

export type LeaderboardUnavailableReason = "NO_CURRENT_ENROLLMENT" | "NO_CLASS";

export class LeaderboardScopeUnavailableError extends Error {
  readonly scope: LeaderboardScope;
  readonly reason: LeaderboardUnavailableReason;

  constructor(scope: LeaderboardScope, reason: LeaderboardUnavailableReason) {
    super("LEADERBOARD_SCOPE_UNAVAILABLE");
    this.name = "LeaderboardScopeUnavailableError";
    this.scope = scope;
    this.reason = reason;
  }
}

export class WeeklyLeaderboardForbiddenError extends Error {
  constructor(message = "LEADERBOARD_STUDENT_ONLY") {
    super(message);
    this.name = "WeeklyLeaderboardForbiddenError";
  }
}

export class WeeklyLeaderboardUnavailableError extends Error {
  constructor(message = "LEADERBOARD_WEEK_UNAVAILABLE") {
    super(message);
    this.name = "WeeklyLeaderboardUnavailableError";
  }
}

export class WeeklyLeaderboardCursorError extends Error {
  readonly stale: boolean;

  constructor(message: "LEADERBOARD_CURSOR_INVALID" | "LEADERBOARD_SNAPSHOT_STALE", stale: boolean) {
    super(message);
    this.name = "WeeklyLeaderboardCursorError";
    this.stale = stale;
  }
}

export type WeeklyLeaderboardEntry = {
  entryKey: string;
  nickname: string;
  rank: number | null;
  isTied: boolean;
  scoreMilliPoints: number;
  isMe: boolean;
  rankingState: WeeklyRankingState;
};

export type WeeklyDailyProgress = {
  date: string;
  active: boolean;
  effortActivityCount: number;
  firstCorrectSenseCount: number;
  scoreMilliPoints: number;
};

export type WeeklyLeaderboardData = {
  policyVersion: typeof STUDENT_WEEKLY_LEADERBOARD_POLICY_VERSION;
  scope: LeaderboardScope;
  view: LeaderboardView;
  scopeContext: {
    grade: StudentGrade;
    classCode: ClassCode | null;
    academicYearLabel: string;
  };
  week: WeeklyDateRange & { daysRemaining: number };
  asOf: string;
  snapshotToken: string;
  participantCount: number;
  rankedCount: number;
  unrankedCount: number;
  pendingReviewCount: number;
  notice: "NONE" | "PARTIAL_COVERAGE";
  personal: {
    rank: number | null;
    scoreMilliPoints: number;
    score: number;
    gapToNextMilliPoints: number | null;
    gapToNext: number | null;
    learningDays: number;
    goal: {
      targetDays: number;
      completedDays: number;
      reached: boolean;
      eligibleDays: number;
    };
    scoreBreakdown: {
      effort: number | null;
      outcome: number | null;
      total: number | null;
    };
    dailyProgress: WeeklyDailyProgress[];
    rankingState: WeeklyRankingState;
    coverage: "CHECKED" | "INCOMPLETE";
  };
  cumulative: {
    studyDays: number;
    masteredWords: number;
  };
  topEntries: WeeklyLeaderboardEntry[];
  nearbyEntries: WeeklyLeaderboardEntry[];
  page: {
    entries: WeeklyLeaderboardEntry[];
    nextCursor: string | null;
    myPageCursor: string | null;
  };
};

type WeeklyMember = RewardMember & {
  classCode: ClassCode | null;
  academicYearLabel: string;
};

type WeeklyContext = {
  grade: StudentGrade;
  classId: string | null;
  classCode: ClassCode | null;
  academicYearLabel: string;
};

type WeeklyCandidateWithReport = {
  member: WeeklyMember;
  candidate: WeeklyRankingCandidate;
  report: ReturnType<typeof buildStudentReward>;
};

type WeeklyCursorPayload = {
  v: 1;
  subject: string;
  scope: LeaderboardScope;
  view: "all";
  asOf: string;
  expiresAt: string;
  digest: string;
  offset: number;
};

const WEEKLY_CURSOR_VERSION = 1 as const;
const MAX_CURSOR_BYTES = 4096;
const SHANGHAI_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function localDate(value: Date): string {
  const parts = SHANGHAI_FORMATTER.formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function tokenSecret() {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("NEXTAUTH_SECRET_REQUIRED");
  return "development-only-student-weekly-leaderboard-secret";
}

function signToken(body: string) {
  return createHmac("sha256", tokenSecret()).update("student-weekly-leaderboard-v1:").update(body).digest("base64url");
}

function encodeCursor(payload: WeeklyCursorPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signToken(body)}`;
}

function decodeCursor(value: string, now = new Date()): WeeklyCursorPayload {
  if (!value || Buffer.byteLength(value, "utf8") > MAX_CURSOR_BYTES) {
    throw new WeeklyLeaderboardCursorError("LEADERBOARD_CURSOR_INVALID", false);
  }
  const [body, signature] = value.split(".");
  if (!body || !signature) throw new WeeklyLeaderboardCursorError("LEADERBOARD_CURSOR_INVALID", false);
  const left = Buffer.from(signature);
  const right = Buffer.from(signToken(body));
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new WeeklyLeaderboardCursorError("LEADERBOARD_CURSOR_INVALID", false);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new WeeklyLeaderboardCursorError("LEADERBOARD_CURSOR_INVALID", false);
  }
  if (!payload || typeof payload !== "object") throw new WeeklyLeaderboardCursorError("LEADERBOARD_CURSOR_INVALID", false);
  const candidate = payload as Partial<WeeklyCursorPayload>;
  const expiresAt = typeof candidate.expiresAt === "string" ? new Date(candidate.expiresAt) : new Date(0);
  const asOf = typeof candidate.asOf === "string" ? new Date(candidate.asOf) : new Date(0);
  if (candidate.v !== WEEKLY_CURSOR_VERSION || typeof candidate.subject !== "string" || !isLeaderboardScope(candidate.scope ?? "") || candidate.view !== "all" || typeof candidate.digest !== "string" || !Number.isInteger(candidate.offset) || (candidate.offset ?? -1) < 0 || Number.isNaN(expiresAt.getTime()) || expiresAt <= now || Number.isNaN(asOf.getTime()) || asOf > now) {
    throw new WeeklyLeaderboardCursorError("LEADERBOARD_CURSOR_INVALID", false);
  }
  return candidate as WeeklyCursorPayload;
}

function digestValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function entryKey(scope: LeaderboardScope, studentId: string) {
  return createHmac("sha256", tokenSecret()).update("student-weekly-entry-v1:").update(scope).update(":").update(studentId).digest("base64url").slice(0, 22);
}

function subjectBinding(userId: string) {
  return createHmac("sha256", tokenSecret()).update("student-weekly-subject-v1:").update(userId).digest("base64url");
}

function buildRewardRange(range: WeeklyDateRange): RewardRange {
  return {
    requestedFrom: range.start,
    requestedTo: range.scoreTo,
    from: range.effectiveFrom,
    to: range.scoreTo,
    rangeClamped: range.start !== range.effectiveFrom || range.scoreTo !== range.effectiveTo,
    timezone: "Asia/Shanghai",
  };
}

function scopeMatches(member: WeeklyMember, scope: LeaderboardScope, context: WeeklyContext) {
  if (scope === "school") return true;
  if (scope === "grade") return member.grade === context.grade;
  return context.classId !== null && member.classId === context.classId;
}

function toPublicEntry(scope: LeaderboardScope, me: string, entry: WeeklyRankedEntry): WeeklyLeaderboardEntry {
  return {
    entryKey: entryKey(scope, entry.studentId),
    nickname: entry.nickname,
    rank: entry.rank,
    isTied: entry.isTied,
    scoreMilliPoints: entry.scoreMilliPoints,
    isMe: entry.studentId === me,
    rankingState: entry.rankingState,
  };
}

function makeCursor(input: { userId: string; scope: LeaderboardScope; asOf: Date; digest: string; offset: number }) {
  const expiresAt = new Date(input.asOf.getTime() + STUDENT_WEEKLY_CURSOR_TTL_MS);
  return encodeCursor({
    v: WEEKLY_CURSOR_VERSION,
    subject: subjectBinding(input.userId),
    scope: input.scope,
    view: "all",
    asOf: input.asOf.toISOString(),
    expiresAt: expiresAt.toISOString(),
    digest: input.digest,
    offset: input.offset,
  });
}

function memberWhere() {
  return {
    role: ROLES.STUDENT,
    status: "ACTIVE" as const,
    studentProfile: {
      is: {
        enrollments: {
          some: { status: "ACTIVE" as const, isCurrent: true, academicYear: { status: "CURRENT" as const } },
        },
      },
    },
  };
}

async function readWeeklyMembers(db: Pick<typeof prisma, "user">) {
  const rows = await db.user.findMany({
    where: memberWhere(),
    orderBy: [{ accountNameCanonical: "asc" }, { accountName: "asc" }, { id: "asc" }],
    select: {
      id: true,
      accountName: true,
      studentProfile: {
        select: {
          legalName: true,
          nickname: true,
          enrollments: {
            where: { status: "ACTIVE", isCurrent: true, academicYear: { status: "CURRENT" } },
            take: 1,
            orderBy: { id: "asc" },
            select: {
              grade: true,
              classId: true,
              studentNumber: true,
              startedAt: true,
              schoolClass: { select: { classCode: true } },
              academicYear: { select: { label: true } },
            },
          },
        },
      },
    },
  });
  return rows.flatMap((row): WeeklyMember[] => {
    const profile = row.studentProfile;
    const enrollment = profile?.enrollments[0];
    if (!profile || !enrollment) return [];
    return [{
      id: row.id,
      accountName: row.accountName,
      studentNumber: enrollment.studentNumber ?? null,
      legalName: profile.legalName,
      nickname: profile.nickname,
      grade: enrollment.grade,
      classId: enrollment.classId,
      classCode: enrollment.schoolClass?.classCode ?? null,
      academicYearLabel: enrollment.academicYear.label,
      startedAt: enrollment.startedAt,
    }];
  });
}

async function readCurrentYear(db: Pick<typeof prisma, "academicYear">) {
  const year = await db.academicYear.findFirst({
    where: { status: "CURRENT" },
    orderBy: [{ startsOn: "desc" }, { id: "asc" }],
    select: { id: true, label: true, startsOn: true, endsOn: true },
  });
  if (!year) throw new WeeklyLeaderboardUnavailableError("LEADERBOARD_CURRENT_YEAR_UNAVAILABLE");
  return year;
}

function groupActivity(activity: RewardLoadedActivity) {
  const grouped = new Map<string, RewardLoadedActivity>();
  const get = (userId: string): RewardLoadedActivity => {
    const existing = grouped.get(userId);
    if (existing) return existing;
    const created: RewardLoadedActivity = { reviewEvents: [], encounters: [], studyDays: [] };
    grouped.set(userId, created);
    return created;
  };
  for (const event of activity.reviewEvents) get(event.userId).reviewEvents.push(event);
  for (const encounter of activity.encounters) get(encounter.userId).encounters.push(encounter);
  for (const day of activity.studyDays) get(day.userId).studyDays.push(day);
  return grouped;
}

function rankingStateForReport(report: ReturnType<typeof buildStudentReward>): WeeklyRankingState {
  if (report.total.coverage.validationGapCount > 0 || report.total.coverage.historyCoverage === "KNOWN_GAP") return "PENDING_REVIEW";
  return report.total.scores?.weightedMilliPoints && report.total.scores.weightedMilliPoints > 0 ? "RANKED" : "UNRANKED";
}

function serializeDailyProgress(report: ReturnType<typeof buildStudentReward>, range: WeeklyDateRange): WeeklyDailyProgress[] {
  const byDate = new Map(report.days.map((day) => [day.date, day]));
  return daysBetweenKeys(range.effectiveFrom, range.effectiveTo).map((date) => {
    const day = byDate.get(date);
    return {
      date,
      active: Boolean(day?.eligible && day.effortActivityCount !== null && day.effortActivityCount > 0),
      effortActivityCount: day?.eligible ? day.effortActivityCount ?? 0 : 0,
      firstCorrectSenseCount: day?.eligible ? day.firstCorrectSenseCount ?? 0 : 0,
      scoreMilliPoints: day?.eligible ? day.scores?.weightedMilliPoints ?? 0 : 0,
    };
  });
}

function getScore(report: ReturnType<typeof buildStudentReward>) {
  return report.total.scores?.weightedMilliPoints ?? 0;
}

async function buildWeeklySnapshot(input: { userId: string; scope?: LeaderboardScope; view: LeaderboardView; cursor?: string }) {
  const cursorPayload = input.cursor ? decodeCursor(input.cursor) : null;
  if (cursorPayload && input.view !== "all") throw new WeeklyLeaderboardCursorError("LEADERBOARD_CURSOR_INVALID", false);
  if (cursorPayload && cursorPayload.subject !== subjectBinding(input.userId)) throw new WeeklyLeaderboardCursorError("LEADERBOARD_CURSOR_INVALID", false);
  if (cursorPayload && input.scope && cursorPayload.scope !== input.scope) throw new WeeklyLeaderboardCursorError("LEADERBOARD_CURSOR_INVALID", false);
  const asOf = cursorPayload ? new Date(cursorPayload.asOf) : new Date();

  const result = await prisma.$transaction(async (tx) => {
    const [year, members] = await Promise.all([readCurrentYear(tx), readWeeklyMembers(tx)]);
    const current = members.find((member) => member.id === input.userId);
    if (!current) throw new WeeklyLeaderboardForbiddenError("LEADERBOARD_NO_CURRENT_ENROLLMENT");
    const context: WeeklyContext = {
      grade: current.grade,
      classId: current.classId,
      classCode: current.classCode,
      academicYearLabel: current.academicYearLabel,
    };
    const requestedScope = input.scope ?? (cursorPayload?.scope ?? chooseDefaultLeaderboardScope(context));
    if (requestedScope === "class" && context.classId === null) throw new LeaderboardScopeUnavailableError(requestedScope, "NO_CLASS");
    if (requestedScope === "grade" && context.grade === null) throw new LeaderboardScopeUnavailableError(requestedScope, "NO_CURRENT_ENROLLMENT");
    const today = todayKey(asOf);
    const yearFrom = localDate(year.startsOn);
    const yearTo = localDate(year.endsOn);
    const week = buildWeeklyDateRange({ today, yearFrom, yearTo });
    if (!week) throw new WeeklyLeaderboardUnavailableError();
    const scoreRange = buildRewardRange(week);
    const scopeMembers = members.filter((member) => scopeMatches(member, requestedScope, context));
    if (!scopeMembers.length) throw new WeeklyLeaderboardUnavailableError("LEADERBOARD_SCOPE_EMPTY");
    const activity = await loadRewardActivityForMembers(tx, {
      memberIds: scopeMembers.map((member) => member.id),
      from: scoreRange.from,
      to: scoreRange.to,
      asOf,
    });
    const activityByUser = groupActivity(activity);
    const reports = scopeMembers.map((member): WeeklyCandidateWithReport => {
      const report = buildStudentReward({
        member,
        activity: activityByUser.get(member.id) ?? { reviewEvents: [], encounters: [], studyDays: [] },
        range: scoreRange,
        weights: STUDENT_WEEKLY_LEADERBOARD_WEIGHTS,
      });
      return {
        member,
        report,
        candidate: {
          studentId: member.id,
          nickname: member.nickname,
          scoreMilliPoints: getScore(report),
          rankingState: rankingStateForReport(report),
        },
      };
    });
    const ranked = rankWeeklyEntries(reports.map((item) => item.candidate));
    const byStudentId = new Map(reports.map((item) => [item.member.id, item]));
    const meRanked = ranked.find((entry) => entry.studentId === input.userId);
    if (!meRanked) throw new WeeklyLeaderboardForbiddenError("LEADERBOARD_STUDENT_NOT_IN_SCOPE");
    const meReport = byStudentId.get(input.userId)?.report;
    if (!meReport) throw new WeeklyLeaderboardForbiddenError("LEADERBOARD_STUDENT_REPORT_MISSING");
    const rosterRevision = (await tx.rosterMutationState.findUnique({ where: { id: 1 }, select: { revision: true } }))?.revision ?? 0;
    const digest = digestValue({
      asOf: asOf.toISOString(),
      scope: requestedScope,
      week,
      roster: ranked.map((entry) => [entry.studentId, entry.scoreMilliPoints, entry.rankingState, entry.rank]),
      rosterRevision,
    });
    if (cursorPayload && cursorPayload.digest !== digest) throw new WeeklyLeaderboardCursorError("LEADERBOARD_SNAPSHOT_STALE", true);
    const allEntries = ranked.map((entry) => toPublicEntry(requestedScope, input.userId, entry));
    const rankedEntries = ranked.filter((entry) => entry.rank !== null);
    const meIndex = ranked.findIndex((entry) => entry.studentId === input.userId);
    const offset = cursorPayload?.offset ?? 0;
    const pageEntries = input.view === "all" ? ranked.slice(offset, offset + STUDENT_WEEKLY_PAGE_SIZE) : [];
    const eligibleDays = daysBetweenDateKeys(
      meReport.total.eligibleFrom > week.effectiveFrom ? meReport.total.eligibleFrom : week.effectiveFrom,
      week.effectiveTo,
    ).length;
    const score = meReport.total.scores?.weightedMilliPoints ?? 0;
    const learningDays = meReport.total.activeDayCount;
    const goalFrom = meReport.total.eligibleFrom > week.effectiveFrom ? meReport.total.eligibleFrom : week.effectiveFrom;
    const targetDays = goalFrom <= week.effectiveTo ? weeklyGoalTargetDays(goalFrom, week.effectiveTo) : 0;
    const gap = gapToNextWeeklyRank(ranked, input.userId);
    const [studyDayCount, masteredReviews] = await Promise.all([
      tx.studyDay.count({ where: { userId: input.userId } }),
      tx.review.findMany({ where: { userId: input.userId, word: withCurrentCatalogWord() }, select: { interval: true } }),
    ]);
    const page = {
      entries: pageEntries.map((entry) => toPublicEntry(requestedScope, input.userId, entry)),
      nextCursor: offset + STUDENT_WEEKLY_PAGE_SIZE < ranked.length ? makeCursor({ userId: input.userId, scope: requestedScope, asOf, digest, offset: offset + STUDENT_WEEKLY_PAGE_SIZE }) : null,
      myPageCursor: meIndex >= 0 ? makeCursor({ userId: input.userId, scope: requestedScope, asOf, digest, offset: Math.max(0, meIndex - 2) }) : null,
    };
    return {
      policyVersion: STUDENT_WEEKLY_LEADERBOARD_POLICY_VERSION,
      scope: requestedScope,
      view: input.view,
      scopeContext: { grade: context.grade, classCode: context.classCode, academicYearLabel: context.academicYearLabel },
      week: { ...week, daysRemaining: daysBetweenDateKeys(today, week.effectiveTo).length },
      asOf: asOf.toISOString(),
      snapshotToken: makeCursor({ userId: input.userId, scope: requestedScope, asOf, digest, offset: 0 }),
      participantCount: ranked.length,
      rankedCount: rankedEntries.length,
      unrankedCount: ranked.filter((entry) => entry.rankingState === "UNRANKED").length,
      pendingReviewCount: ranked.filter((entry) => entry.rankingState === "PENDING_REVIEW").length,
      notice: ranked.some((entry) => entry.rankingState === "PENDING_REVIEW") ? "PARTIAL_COVERAGE" : "NONE",
      personal: {
        rank: meRanked.rank,
        scoreMilliPoints: score,
        score: score / 1000,
        gapToNextMilliPoints: gap,
        gapToNext: gap === null ? null : gap / 1000,
        learningDays,
        goal: { targetDays, completedDays: Math.min(learningDays, targetDays), reached: learningDays >= targetDays, eligibleDays },
        scoreBreakdown: scorePartsForDisplay(meReport.total.scores),
        dailyProgress: serializeDailyProgress(meReport, week),
        rankingState: meRanked.rankingState,
        coverage: meReport.total.coverage.validationGapCount > 0 || meReport.total.coverage.historyCoverage === "KNOWN_GAP" ? "INCOMPLETE" : "CHECKED",
      },
      cumulative: { studyDays: studyDayCount, masteredWords: masteredReviews.filter((review) => review.interval >= 22).length },
      topEntries: allEntries.filter((entry) => entry.rank !== null && entry.rank <= 3),
      nearbyEntries: nearbyWeeklyEntries(ranked, input.userId).map((entry) => toPublicEntry(requestedScope, input.userId, entry)),
      page,
    } satisfies WeeklyLeaderboardData;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 60_000 });
  return result;
}

function daysBetweenDateKeys(from: string, to: string) {
  const days: string[] = [];
  for (let cursor = from; cursor <= to; cursor = offsetDay(cursor, 1)) days.push(cursor);
  return days;
}

export async function getWeeklyLeaderboard(input: { userId: string; scope?: LeaderboardScope; view?: LeaderboardView; cursor?: string }): Promise<WeeklyLeaderboardData> {
  return buildWeeklySnapshot({ ...input, view: input.view ?? "summary" });
}

/** Small pure helper used by tests and UI previews. */
export function weeklyDateWindowFor(now = new Date()) {
  const today = todayKey(now);
  const start = startOfLeaderboardWeek(today);
  return { start, endExclusive: offsetDay(start, 7) };
}
