/**
 * 學生排行榜：三個現有指標（客觀認讀連續天數／掌握詞數／累計打卡），
 * 按 current-year ACTIVE enrollment 即時計算本班、全年級及全校範圍。
 *
 * 資料量小（學生數十人），直接讀取 canonical StudyDay / Review /
 * ReviewEvent 後在 memory 聚合；不建立快照表，保持指標實時且不改學習語義。
 */
import type { ClassCode, StudentGrade } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/roles";
import { todayKey, offsetDay } from "@/lib/streak";
import { isMasteredByInterval } from "@/lib/mastered";
import type { RewardIconName } from "@/lib/reward-icons";
import { eligibleOperationalObjectiveEventWhere, withCurrentCatalogWord } from "@/lib/catalog/runtime";

export type LeaderboardType = "streak" | "words" | "studyDays";
export type LeaderboardIcon = Extract<RewardIconName, "flame" | "word-stack" | "calendar-check">;

export const LEADERBOARD_SCOPES = ["class", "grade", "school"] as const;
export type LeaderboardScope = (typeof LEADERBOARD_SCOPES)[number];

export type LeaderboardUnavailableReason = "NO_CURRENT_ENROLLMENT" | "NO_CLASS";

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  value: number;
  isMe: boolean;
}

export interface LeaderboardList {
  type: LeaderboardType;
  /** 簡體標題（前端經 tc() 轉換）。 */
  label: string;
  icon: LeaderboardIcon;
  entries: LeaderboardEntry[];
}

export interface LeaderboardMetricSummary {
  rank: number | null;
  value: number | null;
  outOf: number;
}

export type LeaderboardMetricValues = Record<LeaderboardType, number>;

export interface LeaderboardScopeOverview {
  scope: LeaderboardScope;
  available: boolean;
  participantCount: number;
  /** 只為 class／grade scope 提供學生所屬 context；school scope 為 null。 */
  grade: StudentGrade | null;
  classCode: ClassCode | null;
  metrics: Record<LeaderboardType, LeaderboardMetricSummary>;
  unavailableReason?: LeaderboardUnavailableReason;
}

export interface LeaderboardContext {
  academicYearLabel: string | null;
  grade: StudentGrade | null;
  classCode: ClassCode | null;
}

export interface LeaderboardData {
  /** 目前詳細榜單所使用的範圍。 */
  scope: LeaderboardScope;
  lists: LeaderboardList[];
  /** 目前登入者 id；route response 會轉成公開的 "me" marker。 */
  me: string;
  context: LeaderboardContext;
  overview: Record<LeaderboardScope, LeaderboardScopeOverview>;
}

const TOP_N = 20;

const LEADERBOARD_DEFINITIONS: ReadonlyArray<{
  type: LeaderboardType;
  label: string;
  icon: LeaderboardIcon;
}> = [
  { type: "streak", label: "客觀認讀連續天數", icon: "flame" },
  { type: "words", label: "掌握詞數", icon: "word-stack" },
  { type: "studyDays", label: "累計打卡", icon: "calendar-check" },
];

interface LeaderboardMember {
  id: string;
  name: string;
  grade: StudentGrade;
  classId: string | null;
  classCode: ClassCode | null;
  academicYearLabel: string;
}

interface CurrentEnrollmentContext {
  academicYearLabel: string | null;
  grade: StudentGrade | null;
  classId: string | null;
  classCode: ClassCode | null;
}

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

export function isLeaderboardScope(value: string): value is LeaderboardScope {
  return (LEADERBOARD_SCOPES as readonly string[]).includes(value);
}

/** 純函數：從打卡日期集合計算連續天數（Duolingo 式，今天／昨天起點）。 */
export function countLeaderboardStreak(dates: Set<string>): number {
  const today = todayKey();
  const yesterday = offsetDay(today, -1);
  let cursor: string | null = null;
  if (dates.has(today)) cursor = today;
  else if (dates.has(yesterday)) cursor = yesterday;
  else return 0;
  let count = 0;
  while (dates.has(cursor)) {
    count++;
    cursor = offsetDay(cursor, -1);
  }
  return count;
}

/** 標準競賽排名：相同分值並列名次（1,1,3,...），同分 row 用 userId 穩定排序。 */
export function rankLeaderboardEntries(
  values: { userId: string; name: string; value: number }[],
  me: string,
): LeaderboardEntry[] {
  const sorted = [...values].sort((a, b) => b.value - a.value || a.userId.localeCompare(b.userId));
  const entries: LeaderboardEntry[] = [];
  let prevValue: number | null = null;
  let prevRank = 0;
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i];
    const rank = v.value === prevValue ? prevRank : i + 1;
    prevValue = v.value;
    prevRank = rank;
    entries.push({ rank, userId: v.userId, name: v.name, value: v.value, isMe: v.userId === me });
  }
  return entries;
}

/** 截斷到 TOP_N，並確保當前用戶一定在列表內（不在則追加）。 */
export function trimLeaderboardEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  if (entries.length <= TOP_N) return entries;
  const top = entries.slice(0, TOP_N);
  if (top.some((e) => e.isMe)) return top;
  const meEntry = entries.find((e) => e.isMe);
  return meEntry ? [...top, meEntry] : top;
}

export function chooseDefaultLeaderboardScope(context: Pick<CurrentEnrollmentContext, "classId" | "grade">): LeaderboardScope {
  if (context.classId) return "class";
  if (context.grade) return "grade";
  return "school";
}

function matchesScope(
  member: Pick<LeaderboardMember, "grade" | "classId">,
  scope: LeaderboardScope,
  context: Pick<CurrentEnrollmentContext, "classId" | "grade">,
): boolean {
  if (scope === "school") return true;
  if (scope === "grade") return context.grade !== null && member.grade === context.grade;
  return context.classId !== null && member.classId === context.classId;
}

function zeroMetricSummaries(outOf = 0): Record<LeaderboardType, LeaderboardMetricSummary> {
  return {
    streak: { rank: null, value: null, outOf },
    words: { rank: null, value: null, outOf },
    studyDays: { rank: null, value: null, outOf },
  };
}

function emptyOverview(
  scope: LeaderboardScope,
  context: CurrentEnrollmentContext,
  reason: LeaderboardUnavailableReason,
): LeaderboardScopeOverview {
  return {
    scope,
    available: false,
    participantCount: 0,
    grade: scope === "class" || scope === "grade" ? context.grade : null,
    classCode: scope === "class" ? context.classCode : null,
    metrics: zeroMetricSummaries(),
    unavailableReason: reason,
  };
}

function buildOverview(
  scope: LeaderboardScope,
  members: LeaderboardMember[],
  valuesByUser: Map<string, LeaderboardMetricValues>,
  userId: string,
  context: CurrentEnrollmentContext,
): LeaderboardScopeOverview {
  const rankedByType = new Map<LeaderboardType, LeaderboardEntry[]>();
  for (const definition of LEADERBOARD_DEFINITIONS) {
    const ranked = rankLeaderboardEntries(
      members.map((member) => ({
        userId: member.id,
        name: member.name,
        value: valuesByUser.get(member.id)?.[definition.type] ?? 0,
      })),
      userId,
    );
    rankedByType.set(definition.type, ranked);
  }

  const metrics = zeroMetricSummaries(members.length);
  for (const definition of LEADERBOARD_DEFINITIONS) {
    const me = rankedByType.get(definition.type)?.find((entry) => entry.isMe);
    metrics[definition.type] = {
      rank: me?.rank ?? null,
      value: me?.value ?? null,
      outOf: members.length,
    };
  }

  return {
    scope,
    available: true,
    participantCount: members.length,
    grade: scope === "class" || scope === "grade" ? context.grade : null,
    classCode: scope === "class" ? context.classCode : null,
    metrics,
  };
}

function buildLists(
  members: LeaderboardMember[],
  valuesByUser: Map<string, LeaderboardMetricValues>,
  userId: string,
): LeaderboardList[] {
  return LEADERBOARD_DEFINITIONS.map((definition) => {
    const ranked = rankLeaderboardEntries(
      members.map((member) => ({
        userId: member.id,
        name: member.name,
        value: valuesByUser.get(member.id)?.[definition.type] ?? 0,
      })),
      userId,
    );
    return {
      ...definition,
      entries: trimLeaderboardEntries(ranked),
    };
  });
}

export async function getLeaderboard(
  userId: string,
  requestedScope?: LeaderboardScope,
): Promise<LeaderboardData> {
  const users = await prisma.user.findMany({
    where: {
      role: ROLES.STUDENT,
      status: "ACTIVE",
      studentProfile: {
        is: {
          enrollments: {
            some: {
              status: "ACTIVE",
              academicYear: { status: "CURRENT" },
            },
          },
        },
      },
    },
    select: {
      id: true,
      studentProfile: {
        select: {
          nickname: true,
          enrollments: {
            where: {
              status: "ACTIVE",
              academicYear: { status: "CURRENT" },
            },
            orderBy: [{ academicYear: { startsOn: "desc" } }, { id: "asc" }],
            take: 1,
            select: {
              grade: true,
              classId: true,
              schoolClass: { select: { classCode: true } },
              academicYear: { select: { label: true } },
            },
          },
        },
      },
    },
  });

  const members: LeaderboardMember[] = users.map((user) => {
    const profile = user.studentProfile;
    const enrollment = profile?.enrollments[0];
    if (!profile || !enrollment) {
      throw new Error("ACTIVE_STUDENT_PROFILE_MISSING");
    }
    return {
      id: user.id,
      name: profile.nickname,
      grade: enrollment.grade,
      classId: enrollment.classId,
      classCode: enrollment.schoolClass?.classCode ?? null,
      academicYearLabel: enrollment.academicYear.label,
    };
  });

  const currentMember = members.find((member) => member.id === userId);
  const context: CurrentEnrollmentContext = currentMember
    ? {
        academicYearLabel: currentMember.academicYearLabel,
        grade: currentMember.grade,
        classId: currentMember.classId,
        classCode: currentMember.classCode,
      }
    : {
        academicYearLabel: null,
        grade: null,
        classId: null,
        classCode: null,
      };

  const defaultScope = chooseDefaultLeaderboardScope(context);
  const scope = requestedScope ?? defaultScope;
  const classAvailable = context.classId !== null;
  const gradeAvailable = context.grade !== null;
  if (scope === "class" && !classAvailable) {
    throw new LeaderboardScopeUnavailableError(
      scope,
      context.grade ? "NO_CLASS" : "NO_CURRENT_ENROLLMENT",
    );
  }
  if (scope === "grade" && !gradeAvailable) {
    throw new LeaderboardScopeUnavailableError(scope, "NO_CURRENT_ENROLLMENT");
  }

  const participantIds = members.map((member) => member.id);
  const [studyDays, reviews, objectiveEvents] = await Promise.all([
    prisma.studyDay.findMany({
      where: { userId: { in: participantIds } },
      select: { userId: true, date: true },
    }),
    prisma.review.findMany({
      where: { userId: { in: participantIds }, word: withCurrentCatalogWord() },
      select: { userId: true, interval: true },
    }),
    prisma.reviewEvent.findMany({
      where: { AND: [eligibleOperationalObjectiveEventWhere(), { userId: { in: participantIds } }] },
      select: { userId: true, createdAt: true },
    }),
  ]);

  const datesByUser = new Map<string, Set<string>>();
  for (const studyDay of studyDays) {
    const dates = datesByUser.get(studyDay.userId) ?? new Set<string>();
    dates.add(studyDay.date);
    datesByUser.set(studyDay.userId, dates);
  }

  const wordsByUser = new Map<string, number>();
  for (const review of reviews) {
    if (isMasteredByInterval(review.interval)) {
      wordsByUser.set(review.userId, (wordsByUser.get(review.userId) ?? 0) + 1);
    }
  }

  // Personal learning-day streaks remain in StudyDay for the dashboard. The
  // leaderboard's scored streak is a separate projection and only counts
  // provenance-complete V2 objective ledger events.
  const objectiveDatesByUser = new Map<string, Set<string>>();
  for (const event of objectiveEvents) {
    const dates = objectiveDatesByUser.get(event.userId) ?? new Set<string>();
    dates.add(todayKey(event.createdAt));
    objectiveDatesByUser.set(event.userId, dates);
  }

  const valuesByUser = new Map<string, LeaderboardMetricValues>();
  for (const member of members) {
    valuesByUser.set(member.id, {
      streak: countLeaderboardStreak(objectiveDatesByUser.get(member.id) ?? new Set()),
      words: wordsByUser.get(member.id) ?? 0,
      studyDays: datesByUser.get(member.id)?.size ?? 0,
    });
  }

  const membersForScope = (candidate: LeaderboardScope) =>
    members.filter((member) => matchesScope(member, candidate, context));
  const classMembers = classAvailable ? membersForScope("class") : [];
  const gradeMembers = gradeAvailable ? membersForScope("grade") : [];
  const schoolMembers = membersForScope("school");

  const overview: Record<LeaderboardScope, LeaderboardScopeOverview> = {
    class: classAvailable
      ? buildOverview("class", classMembers, valuesByUser, userId, context)
      : emptyOverview("class", context, context.grade ? "NO_CLASS" : "NO_CURRENT_ENROLLMENT"),
    grade: gradeAvailable
      ? buildOverview("grade", gradeMembers, valuesByUser, userId, context)
      : emptyOverview("grade", context, "NO_CURRENT_ENROLLMENT"),
    school: buildOverview("school", schoolMembers, valuesByUser, userId, context),
  };

  return {
    scope,
    lists: buildLists(membersForScope(scope), valuesByUser, userId),
    me: userId,
    context: {
      academicYearLabel: context.academicYearLabel,
      grade: context.grade,
      classCode: context.classCode,
    },
    overview,
  };
}
