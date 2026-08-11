import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { getStudentVisibleWordFilters, classifyStudentWord, type StudentWordStatus } from "@/lib/student-metrics";
import { isLevel, type LevelCode, unitCategoryToStorage } from "@/lib/units";
import { MASTERED_MIN_INTERVAL } from "@/lib/mastered";
import { prisma, type Prisma } from "@/lib/prisma";

const MAX_LIMIT = 50;
const LEVELS: LevelCode[] = ["A1", "A2", "B1", "B2"];

type Cursor = { term: string; id: string };

function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof decoded.term !== "string" || decoded.term.length > 200 || typeof decoded.id !== "string" || decoded.id.length > 128) return null;
    return { term: decoded.term, id: decoded.id };
  } catch {
    return null;
  }
}

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function responseError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(req: Request) {
  const auth = await requireRole(ROLES.STUDENT);
  if (!auth.ok) return responseError(auth.message, auth.status);
  const url = new URL(req.url);
  const levelRaw = url.searchParams.get("level");
  const categoryRaw = url.searchParams.get("category");
  const statusRaw = url.searchParams.get("status") ?? "all";
  const limitRaw = Number(url.searchParams.get("limit") ?? "20");
  if (levelRaw && !isLevel(levelRaw)) return responseError("级别无效");
  if (categoryRaw && categoryRaw.length > 100) return responseError("单元名称过长");
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > MAX_LIMIT) return responseError("分页数量无效");
  const allowedStatuses: StudentWordStatus[] = ["unseen", "learning", "due", "mastered"];
  if (statusRaw !== "all" && !allowedStatuses.includes(statusRaw as StudentWordStatus)) return responseError("状态无效");
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  if (url.searchParams.has("cursor") && !cursor) return responseError("游标无效");

  const visibleFilters = await getStudentVisibleWordFilters(auth.userId);
  const visibleWhere: Prisma.WordWhereInput = visibleFilters.length ? { OR: visibleFilters } : { id: "__no_visible_words__" };
  const baseConditions: Prisma.WordWhereInput[] = [visibleWhere];
  if (levelRaw) baseConditions.push({ level: levelRaw as LevelCode });
  if (categoryRaw) baseConditions.push({ category: unitCategoryToStorage(categoryRaw) });
  const now = new Date();
  if (statusRaw === "unseen") baseConditions.push({ reviews: { none: { userId: auth.userId } } });
  if (statusRaw === "learning") baseConditions.push({ reviews: { some: { userId: auth.userId, interval: { lt: MASTERED_MIN_INTERVAL }, nextReviewDate: { gt: now } } } });
  if (statusRaw === "due") baseConditions.push({ reviews: { some: { userId: auth.userId, interval: { lt: MASTERED_MIN_INTERVAL }, nextReviewDate: { lte: now } } } });
  if (statusRaw === "mastered") baseConditions.push({ reviews: { some: { userId: auth.userId, interval: { gte: MASTERED_MIN_INTERVAL } } } });
  const totalWhere: Prisma.WordWhereInput = { AND: baseConditions };
  const pageConditions = cursor
    ? [...baseConditions, { OR: [{ term: { gt: cursor.term } }, { term: cursor.term, id: { gt: cursor.id } }] }]
    : baseConditions;
  const pageWhere: Prisma.WordWhereInput = { AND: pageConditions };
  const [words, total, categoryRows] = await Promise.all([
    prisma.word.findMany({ where: pageWhere, orderBy: [{ term: "asc" }, { id: "asc" }], take: limitRaw + 1, include: { reviews: { where: { userId: auth.userId }, select: { repetitions: true, interval: true, nextReviewDate: true, lastReviewedAt: true } } } }),
    prisma.word.count({ where: totalWhere }),
    prisma.word.findMany({ where: { AND: [visibleWhere, ...(levelRaw ? [{ level: levelRaw as LevelCode }] : [])] }, select: { category: true }, distinct: ["category"] }),
  ]);
  const hasNext = words.length > limitRaw;
  const page = hasNext ? words.slice(0, limitRaw) : words;
  const items = page.map((word) => {
    const review = word.reviews[0] ?? null;
    const state = classifyStudentWord(review ? { ...review, lastReviewedAt: review.lastReviewedAt } : null, now);
    return { id: word.id, term: word.term, phonetic: word.phonetic, pos: word.pos, definition: word.definition, level: word.level, category: word.category, learned: state.learned, mastered: state.mastered, status: state.status, nextReviewAt: review?.nextReviewDate.toISOString() ?? null };
  });
  const last = page.at(-1);
  const response = NextResponse.json({
    items,
    nextCursor: hasNext && last ? encodeCursor({ term: last.term, id: last.id }) : null,
    total,
    availableLevels: LEVELS.filter((candidate) => visibleFilters.some((filter) => filter.level === candidate)),
    availableCategories: categoryRows.map((row) => row.category ?? "未分类").sort((a, b) => a.localeCompare(b)),
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
