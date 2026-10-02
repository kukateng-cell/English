import { NextResponse } from "next/server";
import { CATALOG_PRIVATE_HEADERS, requireCatalogActor } from "@/lib/catalog/api";
import { catalogBulkSubmissionEnabled, catalogHistoryEnabled } from "@/lib/catalog/features";

export async function GET(req: Request) {
  const auth = await requireCatalogActor(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({
    actorUserId: auth.actor.userId,
    canReview: auth.canReview,
    bulkEnabled: catalogBulkSubmissionEnabled(),
    historyEnabled: catalogHistoryEnabled(),
  }, { headers: CATALOG_PRIVATE_HEADERS });
}
