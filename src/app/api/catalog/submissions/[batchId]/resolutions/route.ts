import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/csrf";
import { catalogBulkSubmissionEnabled } from "@/lib/catalog/features";
import { catalogRouteError, catalogResponse, CATALOG_PRIVATE_HEADERS, parseJsonObject, requireCatalogActor } from "@/lib/catalog/api";
import { resolveCatalogSubmissionGroup } from "@/lib/catalog/submission-server";
import type { SubmissionResolution } from "@/lib/catalog/submission";

export async function PATCH(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  if (!isSameOriginMutation(req)) return catalogResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireCatalogActor(req, { rateLimit: true });
  if (!auth.ok) return auth.response;
  if (!catalogBulkSubmissionEnabled()) return NextResponse.json({ code: "CATALOG_BULK_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  try {
    const body = await parseJsonObject(req, 128 * 1024);
    const { batchId } = await params;
    const patch = await resolveCatalogSubmissionGroup({
      batchId,
      groupId: typeof body.groupId === "string" ? body.groupId : "",
      actorId: auth.actor.userId,
      canReview: auth.canReview,
      expectedBatchRevision: Number(body.expectedBatchRevision),
      expectedGroupRevision: Number(body.expectedGroupRevision),
      resolution: body.resolution as SubmissionResolution,
      reason: typeof body.reason === "string" ? body.reason.trim() : "",
      ...(body.payload === undefined ? {} : { payload: body.payload }),
      sourceSelectionMode: body.sourceSelectionMode === "SOURCE_ROW" || body.sourceSelectionMode === "CUSTOM" ? body.sourceSelectionMode : undefined,
      selectedSourceRowNumber: Number.isInteger(body.selectedSourceRowNumber) ? Number(body.selectedSourceRowNumber) : undefined,
      acknowledgedSourceSetDigest: typeof body.acknowledgedSourceSetDigest === "string" ? body.acknowledgedSourceSetDigest : undefined,
    });
    return NextResponse.json({ patch }, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) {
    return catalogRouteError(error);
  }
}
