import { NextResponse } from "next/server";
import { catalogHistoryEnabled } from "@/lib/catalog/features";
import { catalogRouteError, CATALOG_PRIVATE_HEADERS, requireCatalogActor } from "@/lib/catalog/api";
import { getCatalogHistoryEntry } from "@/lib/catalog/history";

export async function GET(req: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const auth = await requireCatalogActor(req);
  if (!auth.ok) return auth.response;
  if (!catalogHistoryEnabled()) return NextResponse.json({ code: "CATALOG_HISTORY_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  try {
    const { requestId } = await params;
    const entry = await getCatalogHistoryEntry({ feedEntryIdOrRequestId: requestId, actorId: auth.actor.userId, canReview: auth.canReview });
    return NextResponse.json({ entry }, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) { return catalogRouteError(error); }
}
