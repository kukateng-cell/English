import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
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
