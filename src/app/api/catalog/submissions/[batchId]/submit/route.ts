import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/csrf";
import { catalogBulkSubmissionEnabled } from "@/lib/catalog/features";
import { catalogRouteError, catalogResponse, CATALOG_PRIVATE_HEADERS, parseJsonObject, requireCatalogActor } from "@/lib/catalog/api";
import { submitCatalogSubmissionBatch } from "@/lib/catalog/submission-server";

export async function POST(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  if (!isSameOriginMutation(req)) return catalogResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireCatalogActor(req, { rateLimit: true });
  if (!auth.ok) return auth.response;
  if (!catalogBulkSubmissionEnabled()) return NextResponse.json({ code: "CATALOG_BULK_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  try {
    const body = await parseJsonObject(req, 16 * 1024);
    const { batchId } = await params;
    const result = await submitCatalogSubmissionBatch({
      batchId,
      actorId: auth.actor.userId,
      expectedRevision: Number(body.expectedRevision),
      operationId: req.headers.get("idempotency-key") ?? "",
      reason: typeof body.reason === "string" ? body.reason.trim() : "",
    });
    return NextResponse.json(result, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) { return catalogRouteError(error); }
}
