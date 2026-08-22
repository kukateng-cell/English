import { NextResponse } from "next/server";
import { catalogBulkSubmissionEnabled } from "@/lib/catalog/features";
import { catalogRouteError, CATALOG_PRIVATE_HEADERS, requireCatalogActor } from "@/lib/catalog/api";
import { catalogBatchErrorsCsv, getCatalogSubmissionBatch } from "@/lib/catalog/submission-server";

export async function GET(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const auth = await requireCatalogActor(req);
  if (!auth.ok) return auth.response;
  if (!catalogBulkSubmissionEnabled()) return NextResponse.json({ code: "CATALOG_BULK_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  try {
    const { batchId } = await params;
    const batch = await getCatalogSubmissionBatch({ batchId, actorId: auth.actor.userId, canReview: auth.canReview });
    return new NextResponse(catalogBatchErrorsCsv(batch), {
      headers: {
        ...CATALOG_PRIVATE_HEADERS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''catalog-errors-${encodeURIComponent(batch.id)}.csv`,
      },
    });
  } catch (error) {
    return catalogRouteError(error);
  }
}
