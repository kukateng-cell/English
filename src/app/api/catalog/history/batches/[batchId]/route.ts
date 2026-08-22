import { NextResponse } from "next/server";
import { catalogHistoryEnabled } from "@/lib/catalog/features";
import { catalogRouteError, CATALOG_PRIVATE_HEADERS, requireCatalogActor } from "@/lib/catalog/api";
import { getCatalogHistoryBatchChildren } from "@/lib/catalog/history";

export async function GET(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const auth = await requireCatalogActor(req);
  if (!auth.ok) return auth.response;
  if (!catalogHistoryEnabled()) return NextResponse.json({ code: "CATALOG_HISTORY_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  try {
    const { batchId } = await params;
    const url = new URL(req.url);
    const result = await getCatalogHistoryBatchChildren({
      batchId,
      actorId: auth.actor.userId,
      canReview: auth.canReview,
      cursor: url.searchParams.get("cursor"),
      limit: Number(url.searchParams.get("limit") ?? "50"),
    });
    return NextResponse.json(result, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) {
    return catalogRouteError(error);
  }
}
