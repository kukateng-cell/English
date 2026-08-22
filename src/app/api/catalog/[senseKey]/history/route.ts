import { NextResponse } from "next/server";
import { catalogHistoryEnabled } from "@/lib/catalog/features";
import { catalogRouteError, CATALOG_PRIVATE_HEADERS, requireCatalogActor } from "@/lib/catalog/api";
import { getCatalogSenseHistory } from "@/lib/catalog/history";

export async function GET(req: Request, { params }: { params: Promise<{ senseKey: string }> }) {
  const auth = await requireCatalogActor(req);
  if (!auth.ok) return auth.response;
  if (!catalogHistoryEnabled()) return NextResponse.json({ code: "CATALOG_HISTORY_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  try {
    const { senseKey } = await params;
    const items = await getCatalogSenseHistory({ senseKey, actorId: auth.actor.userId, canReview: auth.canReview });
    return NextResponse.json({ items }, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) { return catalogRouteError(error); }
}
