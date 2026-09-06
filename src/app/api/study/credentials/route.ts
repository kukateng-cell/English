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
import { isSameOriginMutation } from "@/lib/csrf";
import { readLimitedBody } from "@/lib/request-body";

const ID_PATTERN = /^[A-Za-z0-9:_-]{8,200}$/;
const BODY_LIMIT = 32 * 1024;

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
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
      { error: "學習憑證續期過於頻繁，請稍後再試" },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSec ?? 60) },
      },
    );
  }
  let body: Record<string, unknown> | null = null;
  try {
    const raw = new TextDecoder().decode(await readLimitedBody(req, BODY_LIMIT));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch (error) {
    if (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE") {
      return NextResponse.json({ error: "請求內容過大" }, { status: 413 });
    }
  }
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
        !/^[A-Za-z0-9_-]{1,128}$/.test(row.wordId) ||
        (mode === "recover" &&
          (typeof row.quality !== "number" ||
            !Number.isInteger(row.quality) ||
            row.quality < 0 ||
            row.quality > 5))
      );
    })
  ) {
    return NextResponse.json({ error: "續期請求無效" }, { status: 400 });
  }
  try {
    const typedOperations = operations as Array<{
      operationId: string;
      wordId: string;
      quality?: number;
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
      const retryAfter = typeof error.details.retryAfterSec === "number"
        ? String(error.details.retryAfterSec)
        : undefined;
      return NextResponse.json(
        { error: error.message, ...error.details },
        {
          status: error.status,
          headers: retryAfter ? { "Retry-After": retryAfter } : undefined,
        },
      );
    }
    throw error;
  }
}
