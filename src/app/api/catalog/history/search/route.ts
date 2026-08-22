import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/csrf";
import { catalogHistoryEnabled } from "@/lib/catalog/features";
import { catalogRouteError, catalogResponse, CATALOG_PRIVATE_HEADERS, parseJsonObject, requireCatalogActor } from "@/lib/catalog/api";
import { listCatalogHistory, type CatalogHistoryFilters } from "@/lib/catalog/history";

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return catalogResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireCatalogActor(req, { rateLimit: true });
  if (!auth.ok) return auth.response;
  if (!catalogHistoryEnabled()) return NextResponse.json({ code: "CATALOG_HISTORY_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  try {
    const body = await parseJsonObject(req, 32 * 1024);
    const filters = body.filters && typeof body.filters === "object" && !Array.isArray(body.filters) ? body.filters as CatalogHistoryFilters : {};
    const result = await listCatalogHistory({
      actorId: auth.actor.userId,
      canReview: auth.canReview,
      cursor: typeof body.cursor === "string" ? body.cursor : null,
      limit: Number(body.limit ?? 25),
      filters,
    });
    return NextResponse.json(result, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) { return catalogRouteError(error); }
}
