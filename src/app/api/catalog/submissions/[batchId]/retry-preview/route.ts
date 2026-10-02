import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/csrf";
import { catalogBulkSubmissionEnabled } from "@/lib/catalog/features";
import {
  CATALOG_PRIVATE_HEADERS,
  catalogResponse,
  catalogRouteError,
  requireCatalogActor,
} from "@/lib/catalog/api";
import { createRetryCatalogSubmissionPreview } from "@/lib/catalog/submission-server";

export async function POST(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  if (!isSameOriginMutation(req)) return catalogResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireCatalogActor(req, { rateLimit: true });
  if (!auth.ok) return auth.response;
  if (!catalogBulkSubmissionEnabled()) {
    return NextResponse.json({ code: "CATALOG_BULK_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  }
  try {
    const { batchId } = await params;
    const result = await createRetryCatalogSubmissionPreview({
      sourceBatchId: batchId,
      actorId: auth.actor.userId,
      operationId: req.headers.get("idempotency-key") ?? "",
    });
    return NextResponse.json(result, {
      status: "closed" in result ? 200 : result.replay ? 200 : 201,
      headers: CATALOG_PRIVATE_HEADERS,
    });
  } catch (error) {
    return catalogRouteError(error);
  }
}
