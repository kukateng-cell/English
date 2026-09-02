import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { isSameOriginMutation } from "@/lib/csrf";
import { withCurrentCatalogWord } from "@/lib/catalog/runtime";

export async function GET() {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    const words = await prisma.word.findMany({
      where: withCurrentCatalogWord(),
      select: {
        id: true,
        senseKey: true,
        term: true,
        phonetic: true,
        pos: true,
        definition: true,
        level: true,
        category: true,
        enableEnToZh: true,
        enableZhToEn: true,
        sense: { select: { status: true, approvedRevisionId: true } },
        catalogRevision: { select: { revisionKey: true, sourceDigest: true } },
        _count: { select: { reviewEvents: true } },
      },
      orderBy: [{ term: "asc" }, { id: "asc" }],
    });

    return NextResponse.json(words.map((word) => ({
      id: word.id,
      senseKey: word.senseKey,
      term: word.term,
      phonetic: word.phonetic,
      pos: word.pos,
      definition: word.definition,
      level: word.level,
      category: word.category,
      status: word.sense?.status ?? null,
      approvedRevisionId: word.sense?.approvedRevisionId ?? null,
      catalogRevision: word.catalogRevision?.revisionKey ?? null,
      sourceDigest: word.catalogRevision?.sourceDigest ?? null,
      enableEnToZh: word.enableEnToZh,
      enableZhToEn: word.enableZhToEn,
      reviewCount: word._count.reviewEvents,
    })));
  } catch {
    return NextResponse.json({ error: "取得詞義清單失敗" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  return NextResponse.json({ code: "CATALOG_GOVERNANCE_REQUIRED", error: "詞庫內容必須經 CSV catalog workflow 提交及審核。" }, { status: 410 });
}
