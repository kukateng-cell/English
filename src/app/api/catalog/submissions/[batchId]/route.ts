import { NextResponse } from "next/server";
import { catalogBulkSubmissionEnabled } from "@/lib/catalog/features";
import { catalogRouteError, CATALOG_PRIVATE_HEADERS, requireCatalogActor } from "@/lib/catalog/api";
import { getCatalogSubmissionBatch } from "@/lib/catalog/submission-server";

export async function GET(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const auth = await requireCatalogActor(req);
  if (!auth.ok) return auth.response;
  if (!catalogBulkSubmissionEnabled()) return NextResponse.json({ code: "CATALOG_BULK_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  try {
    const { batchId } = await params;
    const batch = await getCatalogSubmissionBatch({ batchId, actorId: auth.actor.userId, canReview: auth.canReview });
    return NextResponse.json({ batch }, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) {
    return catalogRouteError(error);
  }
}
