import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/csrf";
import { catalogBulkSubmissionEnabled, catalogHistoryEnabled } from "@/lib/catalog/features";
import { catalogRouteError, catalogResponse, CATALOG_PRIVATE_HEADERS, requireCatalogActor } from "@/lib/catalog/api";
import { createCorrectiveCatalogSubmissionPreview } from "@/lib/catalog/submission-server";

export async function POST(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  if (!isSameOriginMutation(req)) return catalogResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireCatalogActor(req, { review: true, rateLimit: true });
  if (!auth.ok) return auth.response;
  if (!catalogBulkSubmissionEnabled() || !catalogHistoryEnabled()) {
    return NextResponse.json({ code: "CATALOG_BULK_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  }
  try {
    const { batchId } = await params;
    const result = await createCorrectiveCatalogSubmissionPreview({
      sourceBatchId: batchId,
      actorId: auth.actor.userId,
      operationId: req.headers.get("idempotency-key") ?? "",
    });
    return NextResponse.json(result, { status: result.replay ? 200 : 201, headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) {
    return catalogRouteError(error);
  }
}
