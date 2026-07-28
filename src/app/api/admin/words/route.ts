import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { normalizeLevel } from "@/lib/units";

export async function GET() {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    const words = await prisma.word.findMany({
      select: {
        id: true,
        term: true,
        phonetic: true,
        definition: true,
        level: true,
        category: true,
        _count: { select: { reviews: true } },
      },
      orderBy: { term: "asc" },
    });

    return NextResponse.json(
      words.map((w) => ({
        id: w.id,
        term: w.term,
        phonetic: w.phonetic,
        definition: w.definition,
        level: w.level,
        category: w.category,
        reviewCount: w._count.reviews,
      }))
    );
  } catch {
    return NextResponse.json({ error: "获取单词列表失败" }, { status: 500 });
  }
}

/** 把逗号分隔的字符串切成数组（去空、去重）；支持已经是数组的输入。 */
function toArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return [...new Set(v.map((x) => String(x).trim()).filter(Boolean))];
  }
  if (typeof v === "string") {
    return [...new Set(v.split(",").map((x) => x.trim()).filter(Boolean))];
  }
  return [];
}

/** 把任意形状的 examples 规范成 [{en, zh}]；非法返回 []。 */
function toExamples(v: unknown): { en: string; zh: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((e) => {
      if (!e || typeof e !== "object") return null;
      const en = String((e as { en?: unknown }).en ?? "").trim();
      const zh = String((e as { zh?: unknown }).zh ?? "").trim();
      return en ? { en, zh } : null;
    })
    .filter((e): e is { en: string; zh: string } => e !== null);
}

export async function POST(req: Request) {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });

    const term = String(body.term ?? "").trim();
    const definition = String(body.definition ?? "").trim();
    // normalizeLevel 返回 LevelCode 字面量联合，直接兼容 Postgres enum / SQLite string，无需强转。
    const level = normalizeLevel(body.level);

    if (!term) return NextResponse.json({ error: "单词不能为空" }, { status: 400 });
    if (!definition)
      return NextResponse.json({ error: "释义不能为空" }, { status: 400 });

    const exists = await prisma.word.findUnique({ where: { term } });
    if (exists) return NextResponse.json({ error: "该单词已存在" }, { status: 409 });

    const word = (await prisma.word.create({
      // 整体 cast 成 create input：synonyms/antonyms/examples 在 Postgres 是 String[]/Json、
      // 在 SQLite 是 String?（JSON 字符串），用 unknown cast 统一传数组，运行时由对应 schema 处理。
      data: {
        term,
        definition,
        level,
        phonetic: body.phonetic ? String(body.phonetic).trim() : null,
        pos: body.pos ? String(body.pos).trim() : null,
        category: body.category ? String(body.category).trim() : null,
        imageUrl: body.imageUrl ? String(body.imageUrl).trim() : null,
        synonyms: toArray(body.synonyms),
        antonyms: toArray(body.antonyms),
        examples: toExamples(body.examples),
      } as unknown as Prisma.WordCreateInput,
      select: {
        id: true,
        term: true,
        phonetic: true,
        definition: true,
        level: true,
        category: true,
        _count: { select: { reviews: true } },
      } as unknown as Prisma.WordSelect,
    })) as unknown as {
      id: string;
      term: string;
      phonetic: string | null;
      definition: string;
      level: string;
      category: string | null;
      _count: { reviews: number };
    };

    return NextResponse.json(
      {
        id: word.id,
        term: word.term,
        phonetic: word.phonetic,
        definition: word.definition,
        level: word.level,
        category: word.category,
        reviewCount: word._count.reviews,
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "创建单词失败" }, { status: 500 });
  }
}
