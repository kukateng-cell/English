import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import {
  recoverStudySessionCredential,
  renewStudySessionCredentials,
  serializeStudySession,
  StudyCredentialRenewalError,
} from "@/lib/study-session-server";
import { checkStudyCredentialRate } from "@/lib/study-limiter";
import { getClientIp } from "@/lib/login-limiter";

const ID_PATTERN = /^[A-Za-z0-9:_-]{8,200}$/;

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const rate = await checkStudyCredentialRate(
    auth.userId,
    getClientIp(req.headers),
  );
  if (!rate.ok) {
    return NextResponse.json(
      { error: "学习凭证续期过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSec ?? 60) },
      },
    );
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const previousSessionId =
    typeof body?.previousSessionId === "string"
      ? body.previousSessionId.trim()
      : "";
  const operations = Array.isArray(body?.operations) ? body.operations : [];
  const mode = body?.mode === "recover" ? "recover" : "renew";
  if (
    !ID_PATTERN.test(previousSessionId) ||
    operations.length === 0 ||
    (mode === "recover" && operations.length !== 1) ||
    operations.length > 20 ||
    operations.some((value) => {
      if (typeof value !== "object" || value === null) return true;
      const row = value as Record<string, unknown>;
      return (
        typeof row.operationId !== "string" ||
        !ID_PATTERN.test(row.operationId) ||
        typeof row.wordId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(row.wordId)
      );
    })
  ) {
    return NextResponse.json({ error: "续期请求无效" }, { status: 400 });
  }
  try {
    const typedOperations = operations as Array<{
      operationId: string;
      wordId: string;
    }>;
    const studySession = mode === "recover"
      ? await recoverStudySessionCredential(
          auth.userId,
          previousSessionId,
          typedOperations[0],
        )
      : await renewStudySessionCredentials(
          auth.userId,
          previousSessionId,
          typedOperations,
        );
    const serialized = serializeStudySession(studySession)!;
    return NextResponse.json({
      studySession: serialized,
      credentials: typedOperations.map((operation) => ({
        ...operation,
        nonce: serialized.nonces[operation.wordId],
      })),
    });
  } catch (error) {
    if (error instanceof StudyCredentialRenewalError) {
      return NextResponse.json(
        { error: error.message, ...error.details },
        { status: error.status },
      );
    }
    throw error;
  }
}
