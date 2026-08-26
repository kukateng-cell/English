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
    const searchParams = new URL(req.url).searchParams;
    for (const key of searchParams.keys()) {
      if ((key !== "cursor" && key !== "limit") || searchParams.getAll(key).length !== 1) throw new Error("CATALOG_HISTORY_FILTER_INVALID");
    }
    const rawLimit = searchParams.get("limit");
    if (rawLimit !== null && !/^\d{1,2}$/u.test(rawLimit)) throw new Error("CATALOG_HISTORY_FILTER_INVALID");
    const page = await getCatalogSenseHistory({
      senseKey,
      actorId: auth.actor.userId,
      canReview: auth.canReview,
      cursor: searchParams.get("cursor"),
      limit: rawLimit === null ? undefined : Number(rawLimit),
    });
    return NextResponse.json(page, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) { return catalogRouteError(error); }
}
