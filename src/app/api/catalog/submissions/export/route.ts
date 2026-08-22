import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSameOriginMutation } from "@/lib/csrf";
import { catalogRowsToCsv } from "@/lib/catalog/csv";
import { payloadFromRevision, payloadToSourceRow } from "@/lib/catalog/governance";
import { catalogBulkSubmissionEnabled } from "@/lib/catalog/features";
import { catalogRouteError, catalogResponse, CATALOG_PRIVATE_HEADERS, parseJsonObject, requireCatalogActor } from "@/lib/catalog/api";

const revisionSelect = {
  revision: true, term: true, lemma: true, pos: true, level: true, category: true,
  definitionZh: true, acceptedAnswersZh: true, phoneticIpa: true, exampleEn: true,
  exampleZh: true, acceptedFormsEn: true, synonymsEn: true, antonymsEn: true,
  enableEnToZh: true, distractorZh: true, enableZhToEn: true, distractorEn: true,
  sourceReference: true, contributorRef: true, changeNote: true, retirementReason: true,
} as const;

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return catalogResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireCatalogActor(req, { rateLimit: true });
  if (!auth.ok) return auth.response;
  if (!catalogBulkSubmissionEnabled()) return NextResponse.json({ code: "CATALOG_BULK_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  try {
    const body = await parseJsonObject(req, 32 * 1024);
    const senseKeys = Array.isArray(body.senseKeys) ? body.senseKeys.filter((value): value is string => typeof value === "string" && value.length > 0) : [];
    if (!senseKeys.length || senseKeys.length > 200 || new Set(senseKeys).size !== senseKeys.length) return catalogResponse("CATALOG_EXPORT_SELECTION_INVALID", 422);
    const senses = await prisma.wordSense.findMany({
      where: { senseKey: { in: senseKeys } },
      include: { catalogEntry: { select: { catalogKey: true } }, approvedRevision: { select: revisionSelect }, revisions: { orderBy: { revision: "desc" }, take: 1, select: revisionSelect } },
    });
    if (senses.length !== senseKeys.length) return catalogResponse("CATALOG_EXPORT_SELECTION_STALE", 409);
    const pending = await prisma.catalogChangeRequest.count({
      where: { status: "PENDING", senseId: { in: senses.map((sense) => sense.id) } },
    });
    if (pending > 0) return catalogResponse("CATALOG_EXPORT_SELECTION_PENDING", 409);
    const byKey = new Map(senses.map((sense) => [sense.senseKey, sense]));
    const csvRows = senseKeys.map((senseKey) => {
      const sense = byKey.get(senseKey)!;
      const revision = sense.approvedRevision ?? sense.revisions[0];
      if (!revision) throw new Error("CATALOG_APPROVED_REVISION_MISSING");
      const row = payloadToSourceRow(payloadFromRevision(revision), {
        catalogKey: sense.catalogEntry.catalogKey,
        senseKey: sense.senseKey,
        sourceFile: "governance-export",
        sourceRow: 0,
      }, revision.revision);
      return { ...row, requested_action: "UPDATE", catalog_status: sense.status, retirement_reason: "" };
    });
    return new NextResponse(catalogRowsToCsv(csvRows), {
      headers: {
        ...CATALOG_PRIVATE_HEADERS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''catalog-update-${new Date().toISOString().slice(0, 10)}.csv`,
      },
    });
  } catch (error) {
    return catalogRouteError(error);
  }
}
