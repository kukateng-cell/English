import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export async function GET() {
  const auth = await requireRole("ADMIN");
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
