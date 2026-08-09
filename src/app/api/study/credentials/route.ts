import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canResumeStudySession } from "@/lib/study-session";
import {
  issueStudySession,
  serializeStudySession,
} from "@/lib/study-session-server";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const body = (await req.json().catch(() => null)) as
    | { wordIds?: unknown }
    | null;
  if (!body || !canResumeStudySession(body.wordIds)) {
    return NextResponse.json({ error: "wordIds 无效" }, { status: 400 });
  }

  // Reauthorize a durable outbox even after the old expired session has been
  // removed by maintenance. The normal POST path still enforces the user's
  // current unit unlock state before creating a first Review.
  const existingWords = await prisma.word.findMany({
    where: { id: { in: body.wordIds } },
    select: { id: true },
  });
  const existingIds = new Set(existingWords.map((word) => word.id));
  if (body.wordIds.some((wordId) => !existingIds.has(wordId))) {
    return NextResponse.json(
      { error: "包含不存在的单词" },
      { status: 404 },
    );
  }

  const studySession = await issueStudySession(auth.userId, body.wordIds);
  return NextResponse.json({ studySession: serializeStudySession(studySession) });
}
