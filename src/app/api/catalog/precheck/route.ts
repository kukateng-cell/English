import { NextResponse } from "next/server";
import { Prisma, prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { catalogAccess } from "@/lib/catalog/access";
import { normalizeCatalogText } from "@/lib/catalog/csv";
import { catalogExactConflict } from "@/lib/catalog/duplicate";
import { catalogGovernancePayloadFromUnknown } from "@/lib/catalog/governance";

function headers() {
  return {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

function response(code: string, status: number) {
  return NextResponse.json({ code }, { status, headers: headers() });
}

const revisionSelect = {
  term: true,
  lemma: true,
  pos: true,
  level: true,
  definitionZh: true,
} as const;

type SourceRow = {
  id: string;
  senseKey: string | null;
  sourceData: Prisma.JsonValue | null;
};

type PendingRow = {
  senseKey: string | null;
  proposerId: string;
  payload: Prisma.JsonValue;
};

export async function GET(req: Request) {
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) {
    return response(
      auth.status === 503
        ? "AUTH_BACKEND_UNAVAILABLE"
        : auth.status === 401
          ? "AUTH_REQUIRED"
          : "ROLE_FORBIDDEN",
      auth.status,
    );
  }

  const params = new URL(req.url).searchParams;
  const allowed = new Set(["term", "lemma", "partOfSpeech", "definitionZh"]);
  if (
    [...params.keys()].some((key) => !allowed.has(key)) ||
    params.getAll("term").length !== 1 ||
    ["lemma", "partOfSpeech", "definitionZh"].some(
      (key) => params.getAll(key).length > 1,
    )
  )
    return response("CATALOG_QUERY_INVALID", 422);

  const term = params.get("term")?.normalize("NFKC").trim() ?? "";
  const lemma = params.get("lemma")?.normalize("NFKC").trim() ?? "";
  const partOfSpeech =
    params.get("partOfSpeech")?.normalize("NFKC").trim() ?? "";
  const definitionZh =
    params.get("definitionZh")?.normalize("NFKC").trim() ?? "";
  if (
    !term ||
    term.length > 120 ||
    lemma.length > 120 ||
    partOfSpeech.length > 80 ||
    definitionZh.length > 500
  )
    return response("CATALOG_QUERY_INVALID", 422);

  const normalizedTerm = normalizeCatalogText(term);
  const normalizedLemma = lemma ? normalizeCatalogText(lemma) : normalizedTerm;
  const normalizedHeadwords = [...new Set([normalizedTerm, normalizedLemma])];
  const exactCandidate = lemma && partOfSpeech && definitionZh
    ? { term, lemma, partOfSpeech, definitionZh }
    : null;

  try {
    const access = await catalogAccess(auth);
    const batch = await prisma.catalogImportBatch.findFirst({
      where: { status: "READY" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const senses = await prisma.wordSense.findMany({
      where: {
        OR: [
          { normalizedTerm: { in: normalizedHeadwords } },
          {
            catalogEntry: {
              normalizedLemma: { in: normalizedHeadwords },
            },
          },
        ],
      },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: 50,
      select: {
        senseKey: true,
        status: true,
        approvedRevision: { select: revisionSelect },
        revisions: {
          orderBy: { revision: "desc" },
          take: 1,
          select: revisionSelect,
        },
      },
    });
    const visiblePending = await prisma.catalogChangeRequest.findMany({
      where: {
        status: "PENDING",
        kind: "CREATE",
        afterNormalizedTermSnapshot: { in: normalizedHeadwords },
        ...(access.canReview ? {} : { proposerId: auth.userId }),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 50,
      select: { senseKey: true, payload: true },
    });
    const exactPending = exactCandidate
      ? await prisma.$queryRaw<PendingRow[]>(Prisma.sql`
          SELECT r."senseKey", r."proposerId", r."payload"
          FROM "CatalogChangeRequest" r
          WHERE r."status" = 'PENDING'
            AND r."kind" = 'CREATE'
            AND lower(coalesce(r."payload"->>'lemma', '')) = ${normalizedLemma}
            AND lower(coalesce(r."payload"->>'partOfSpeech', '')) = ${normalizeCatalogText(partOfSpeech)}
            AND lower(coalesce(r."payload"->>'definitionZh', '')) = ${normalizeCatalogText(definitionZh)}
          ORDER BY r."createdAt" ASC, r."id" ASC
          LIMIT 50
        `)
      : [];
    const sourceRows = batch
      ? await prisma.$queryRaw<SourceRow[]>(Prisma.sql`
            SELECT r."id", r."senseKey", r."sourceData"
            FROM "CatalogImportRow" r
            WHERE r."batchId" = ${batch.id}
              AND (
                lower(btrim(coalesce(r."sourceData"->>'term', ''))) = ${normalizedTerm}
                OR lower(btrim(coalesce(r."sourceData"->>'term', ''))) = ${normalizedLemma}
                OR lower(btrim(coalesce(r."sourceData"->>'lemma', ''))) = ${normalizedTerm}
                OR lower(btrim(coalesce(r."sourceData"->>'lemma', ''))) = ${normalizedLemma}
              )
            ORDER BY r."sourceRow" ASC, r."id" ASC
            LIMIT 50
          `)
      : [];
    const exactSenses = exactCandidate
      ? await prisma.wordSense.findMany({
          where: {
            OR: [
              { normalizedTerm: { in: normalizedHeadwords } },
              {
                catalogEntry: {
                  normalizedLemma: { in: normalizedHeadwords },
                },
              },
            ],
          },
          select: {
            approvedRevision: { select: revisionSelect },
            revisions: {
              orderBy: { revision: "desc" },
              take: 1,
              select: revisionSelect,
            },
          },
        })
      : [];
    const exactSourceRows = batch && exactCandidate
      ? await prisma.$queryRaw<SourceRow[]>(Prisma.sql`
            SELECT r."id", r."senseKey", r."sourceData"
            FROM "CatalogImportRow" r
            WHERE r."batchId" = ${batch.id}
              AND (
                lower(btrim(coalesce(r."sourceData"->>'term', ''))) = ${normalizedTerm}
                OR lower(btrim(coalesce(r."sourceData"->>'term', ''))) = ${normalizedLemma}
                OR lower(btrim(coalesce(r."sourceData"->>'lemma', ''))) = ${normalizedTerm}
                OR lower(btrim(coalesce(r."sourceData"->>'lemma', ''))) = ${normalizedLemma}
              )
          `)
      : [];

    const matches: Array<{
      kind: "SENSE" | "IMPORT_DRAFT" | "PENDING_CREATE";
      senseKey: string | null;
      term: string;
      definitionZh: string;
      partOfSpeech: string;
      level: string;
      status: string;
    }> = [];
    const seenKeys = new Set<string>();
    const exactConflict = exactCandidate
      ? catalogExactConflict(
          exactCandidate,
          [
            ...exactSenses.map(
              (sense) => sense.approvedRevision ?? sense.revisions[0],
            ),
            ...exactSourceRows.map((row) => row.sourceData),
          ],
          exactPending.map((request) => request.payload),
        )
      : null;

    for (const sense of senses) {
      const payload = sense.approvedRevision ?? sense.revisions[0];
      if (!payload) continue;
      seenKeys.add(sense.senseKey);
      matches.push({
        kind: "SENSE",
        senseKey: sense.senseKey,
        term: payload.term,
        definitionZh: payload.definitionZh,
        partOfSpeech: payload.pos ?? "",
        level: payload.level,
        status: sense.status,
      });
    }

    for (const row of sourceRows) {
      if (row.senseKey && seenKeys.has(row.senseKey)) continue;
      const payload = catalogGovernancePayloadFromUnknown(row.sourceData);
      if (!payload) continue;
      if (row.senseKey) seenKeys.add(row.senseKey);
      matches.push({
        kind: "IMPORT_DRAFT",
        senseKey: row.senseKey,
        term: payload.term,
        definitionZh: payload.definitionZh,
        partOfSpeech: payload.partOfSpeech,
        level: payload.level,
        status: "DRAFT",
      });
    }

    const pendingForMatches = [...visiblePending];
    if (exactCandidate) {
      const existingPendingKeys = new Set(
        pendingForMatches.map((request) => request.senseKey),
      );
      for (const request of exactPending) {
        if (
          pendingForMatches.length >= 50 ||
          existingPendingKeys.has(request.senseKey) ||
          (!access.canReview && request.proposerId !== auth.userId)
        )
          continue;
        const payload = catalogGovernancePayloadFromUnknown(request.payload);
        if (
          !payload ||
          !normalizedHeadwords.some(
            (headword) =>
              normalizeCatalogText(payload.term) === headword ||
              normalizeCatalogText(payload.lemma) === headword,
          )
        )
          continue;
        pendingForMatches.push(request);
        existingPendingKeys.add(request.senseKey);
      }
    }

    for (const request of pendingForMatches) {
      if (request.senseKey && seenKeys.has(request.senseKey)) continue;
      const payload = catalogGovernancePayloadFromUnknown(request.payload);
      if (!payload) continue;
      if (request.senseKey) seenKeys.add(request.senseKey);
      matches.push({
        kind: "PENDING_CREATE",
        senseKey: request.senseKey,
        term: payload.term,
        definitionZh: payload.definitionZh,
        partOfSpeech: payload.partOfSpeech,
        level: payload.level,
        status: "PENDING",
      });
    }

    return NextResponse.json(
      { normalizedTerm, matches: matches.slice(0, 50), exactConflict },
      { headers: headers() },
    );
  } catch (error) {
    console.error(
      "[catalog] duplicate precheck failed",
      error instanceof Error ? { name: error.name } : { name: "UnknownError" },
    );
    return response("CATALOG_READ_FAILED", 500);
  }
}
