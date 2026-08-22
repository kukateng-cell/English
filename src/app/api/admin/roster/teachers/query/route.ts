import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { Prisma } from "@/lib/prisma";
import { prisma } from "@/lib/prisma";
import { requireAdminRead, rosterResponse, stableRosterCode } from "@/lib/roster-api";
import { decodeTeacherCursor, encodeTeacherCursor } from "@/lib/teacher-workspace";
import { normalizeAccountName, normalizeLegalName } from "@/lib/identity";
import { isSameOriginMutation } from "@/lib/csrf";

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return rosterResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireAdminRead();
  if (auth instanceof Response) return auth;
  try {
    if (Number(req.headers.get("content-length") ?? 0) > 16 * 1024) throw new Error("QUERY_INVALID");
    const rawBody = await req.text().catch(() => "");
    if (Buffer.byteLength(rawBody, "utf8") > 16 * 1024) throw new Error("QUERY_INVALID");
    const body = (() => { try { return JSON.parse(rawBody) as { search?: unknown; status?: unknown; cursor?: unknown; limit?: unknown }; } catch { return null; } })();
    const search = typeof body?.search === "string" ? body.search.normalize("NFKC").trim() : "";
    if ([...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(search)].length > 80) throw new Error("QUERY_INVALID");
    const status: "ACTIVE" | "SUSPENDED" | undefined = body?.status === "ACTIVE" || body?.status === "SUSPENDED" ? body.status : undefined;
    if (body?.status !== undefined && !status) throw new Error("QUERY_INVALID");
    const limit = body?.limit === undefined ? 50 : Number(body.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("QUERY_INVALID");
    const cursorValue = typeof body?.cursor === "string" ? body.cursor : undefined;
    const state = await prisma.rosterMutationState.findUnique({ where: { id: 1 }, select: { revision: true } });
    if (!state) throw new Error("ROSTER_MUTATION_STATE_MISSING");
    const fingerprint = createHash("sha256").update(JSON.stringify({ search: search || null, status: status ?? null })).digest("hex");
    const cursor = cursorValue ? decodeTeacherCursor(cursorValue) : null;
    if (cursorValue && (!cursor || cursor.fingerprint !== fingerprint || cursor.rosterRevision !== state.revision)) throw new Error(cursor ? "TEACHER_QUERY_STALE" : "CURSOR_INVALID");
    const accountSearch = normalizeAccountName(search);
    const legalSearch = normalizeLegalName(search);
    const where: Prisma.UserWhereInput = {
      role: "TEACHER" as const,
      ...(status ? { status } : {}),
      AND: [
        ...(search ? [{ OR: [
          { accountNameCanonical: { contains: accountSearch, mode: "insensitive" as const } },
          { accountName: { contains: accountSearch, mode: "insensitive" as const } },
          { teacherProfile: { is: { legalName: { contains: legalSearch, mode: "insensitive" as const } } } },
        ] }] : []),
        ...(cursor ? [{ OR: [{ accountName: { gt: cursor.accountName } }, { accountName: cursor.accountName, id: { gt: cursor.id } }] }] : []),
      ],
    };
    const users = await prisma.user.findMany({ where, orderBy: [{ accountName: "asc" }, { id: "asc" }], take: limit + 1, select: { id: true, accountName: true, status: true, teacherProfile: { select: { legalName: true, accessRevision: true, canResetStudentPassword: true, canManageWordCatalog: true } } } });
    const hasNext = users.length > limit;
    const rows = hasNext ? users.slice(0, limit) : users;
    const last = rows.at(-1);
    return NextResponse.json({ items: rows.map((user) => ({ id: user.id, accountName: user.accountName, legalName: user.teacherProfile?.legalName ?? "", status: user.status, accessRevision: user.teacherProfile?.accessRevision ?? 0, canResetStudentPassword: user.teacherProfile?.canResetStudentPassword ?? false, canManageWordCatalog: user.teacherProfile?.canManageWordCatalog ?? false })), nextCursor: hasNext && last ? encodeTeacherCursor({ v: 2, accountName: normalizeAccountName(last.accountName), studentNumber: null, sort: "ACCOUNT_ASC", id: last.id, fingerprint, accessRevision: last.teacherProfile?.accessRevision ?? null, rosterRevision: state.revision, yearRevision: 0 }) : null, rosterRevision: state.revision, generatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const code = stableRosterCode(error, ["QUERY_INVALID", "CURSOR_INVALID", "TEACHER_QUERY_STALE", "ROSTER_MUTATION_STATE_MISSING"], "QUERY_INVALID");
    return rosterResponse(code, code === "TEACHER_QUERY_STALE" ? 409 : code === "ROSTER_MUTATION_STATE_MISSING" ? 503 : 422);
  }
}
