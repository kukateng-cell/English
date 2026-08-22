import { NextResponse } from "next/server";
import { catalogBulkSubmissionEnabled } from "@/lib/catalog/features";
import { catalogRouteError, CATALOG_PRIVATE_HEADERS, requireCatalogActor } from "@/lib/catalog/api";
import { listCatalogSubmissionBatches } from "@/lib/catalog/submission-server";

export async function GET(req: Request) {
  const auth = await requireCatalogActor(req);
  if (!auth.ok) return auth.response;
  if (!catalogBulkSubmissionEnabled()) return NextResponse.json({ code: "CATALOG_BULK_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") === "reviewable" ? "reviewable" : "mine";
  const limit = Number(url.searchParams.get("limit") ?? "25");
  try {
    const result = await listCatalogSubmissionBatches({
      actorId: auth.actor.userId,
      canReview: auth.canReview,
      scope,
      cursor: url.searchParams.get("cursor"),
      limit: Number.isInteger(limit) ? limit : 25,
    });
    return NextResponse.json(result, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) {
    return catalogRouteError(error);
  }
}
