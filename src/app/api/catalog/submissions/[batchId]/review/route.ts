import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/csrf";
import { catalogBulkSubmissionEnabled } from "@/lib/catalog/features";
import { catalogRouteError, catalogResponse, CATALOG_PRIVATE_HEADERS, parseJsonObject, requireCatalogActor } from "@/lib/catalog/api";
import { reviewCatalogSubmissionGroup } from "@/lib/catalog/submission-server";

export async function PATCH(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  if (!isSameOriginMutation(req)) return catalogResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireCatalogActor(req, { review: true, rateLimit: true });
  if (!auth.ok) return auth.response;
  if (!catalogBulkSubmissionEnabled()) return NextResponse.json({ code: "CATALOG_BULK_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  try {
    const body = await parseJsonObject(req, 128 * 1024);
    if (body.payload !== undefined) return catalogResponse("CATALOG_SUBMITTED_PAYLOAD_IMMUTABLE", 409);
    const decision = body.decision === "APPROVE" || body.decision === "REJECT" ? body.decision : null;
    if (!decision) return catalogResponse("CATALOG_REVIEW_DECISION_INVALID", 422);
    const { batchId } = await params;
    const result = await reviewCatalogSubmissionGroup({
      batchId,
      groupId: typeof body.groupId === "string" ? body.groupId : "",
      actorId: auth.actor.userId,
      expectedBatchRevision: Number(body.expectedBatchRevision),
      expectedGroupRevision: Number(body.expectedGroupRevision),
      decision,
      reviewNote: typeof body.reviewNote === "string" ? body.reviewNote.trim() : "",
      acknowledgedPayloadDigest: typeof body.acknowledgedPayloadDigest === "string" ? body.acknowledgedPayloadDigest : undefined,
    });
    return NextResponse.json(result, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) { return catalogRouteError(error); }
}
