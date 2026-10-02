import { NextResponse } from "next/server";
import { catalogHistoryEnabled } from "@/lib/catalog/features";
import { catalogRouteError, CATALOG_PRIVATE_HEADERS, requireCatalogActor } from "@/lib/catalog/api";
import { listCatalogHistory } from "@/lib/catalog/history";

export async function GET(req: Request) {
  const auth = await requireCatalogActor(req);
  if (!auth.ok) return auth.response;
  if (!catalogHistoryEnabled()) return NextResponse.json({ code: "CATALOG_HISTORY_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  const url = new URL(req.url);
  try {
    const result = await listCatalogHistory({
      actorId: auth.actor.userId,
      canReview: auth.canReview,
      cursor: url.searchParams.get("cursor"),
      limit: Number(url.searchParams.get("limit") ?? "25"),
      filters: {
        status: url.searchParams.get("status") ?? undefined,
        kind: url.searchParams.get("kind") ?? undefined,
        level: url.searchParams.get("level") ?? undefined,
        category: url.searchParams.get("category") ?? undefined,
        sourceKind: url.searchParams.get("sourceKind") ?? undefined,
      },
    });
    return NextResponse.json(result, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) { return catalogRouteError(error); }
}
