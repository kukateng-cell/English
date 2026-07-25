import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";

function normalizeLevel(s: unknown): "A1" | "A2" | "B1" | null {
  if (!s) return null;
  const v = String(s).toUpperCase();
  return v === "A2" || v === "B1" ? v : "A1";
}

function toArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return [...new Set(v.map((x) => String(x).trim()).filter(Boolean))];
  }
  if (typeof v === "string") {
    return [...new Set(v.split(",").map((x) => x.trim()).filter(Boolean))];
  }
  return [];
}

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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });

    const data: Record<string, unknown> = {};

    if (typeof body.term === "string") {
      const term = body.term.trim();
      if (!term) return NextResponse.json({ error: "单词不能为空" }, { status: 400 });
      data.term = term;
    }
    if (typeof body.definition === "string") {
      const definition = body.definition.trim();
      if (!definition)
        return NextResponse.json({ error: "释义不能为空" }, { status: 400 });
      data.definition = definition;
    }
    {
      const lvl = normalizeLevel(body.level);
      if (lvl) {
        // 适配当前生成的 client（Postgres enum / SQLite string）
        data.level = lvl as Prisma.WordUpdateInput["level"];
      }
    }
    if (typeof body.phonetic === "string")
      data.phonetic = body.phonetic.trim() || null;
    if (typeof body.pos === "string") data.pos = body.pos.trim() || null;
    if (typeof body.category === "string")
      data.category = body.category.trim() || null;
    if (typeof body.imageUrl === "string")
      data.imageUrl = body.imageUrl.trim() || null;
    if (body.synonyms !== undefined) data.synonyms = toArray(body.synonyms);
    if (body.antonyms !== undefined) data.antonyms = toArray(body.antonyms);
    if (body.examples !== undefined) data.examples = toExamples(body.examples);

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "没有需要更新的字段" }, { status: 400 });
    }

    const word = (await prisma.word.update({
      where: { id },
      data: data as unknown as Prisma.WordUpdateInput,
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

    return NextResponse.json({
      id: word.id,
      term: word.term,
      phonetic: word.phonetic,
      definition: word.definition,
      level: word.level,
      category: word.category,
      reviewCount: word._count.reviews,
    });
  } catch {
    return NextResponse.json({ error: "更新单词失败" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    const { id } = await params;
    await prisma.word.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "删除单词失败" }, { status: 500 });
  }
}
