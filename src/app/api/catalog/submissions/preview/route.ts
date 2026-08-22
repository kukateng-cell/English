import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/csrf";
import { CATALOG_GOVERNANCE_MAX_BYTES } from "@/lib/catalog/csv";
import { catalogBulkSubmissionEnabled } from "@/lib/catalog/features";
import { catalogRouteError, catalogResponse, CATALOG_PRIVATE_HEADERS, readLimitedBody, requireCatalogActor } from "@/lib/catalog/api";
import { createCatalogSubmissionPreview, decodeCatalogUploadName } from "@/lib/catalog/submission-server";

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return catalogResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireCatalogActor(req, { rateLimit: true });
  if (!auth.ok) return auth.response;
  if (!catalogBulkSubmissionEnabled()) return NextResponse.json({ code: "CATALOG_BULK_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  if (!(req.headers.get("content-type") ?? "").toLocaleLowerCase("en-US").startsWith("text/csv")) return catalogResponse("CATALOG_CONTENT_TYPE_INVALID", 415);
  try {
    const bytes = await readLimitedBody(req, CATALOG_GOVERNANCE_MAX_BYTES);
    const result = await createCatalogSubmissionPreview({
      actorId: auth.actor.userId,
      operationId: req.headers.get("idempotency-key") ?? "",
      fileName: decodeCatalogUploadName(req.headers.get("x-catalog-filename")),
      bytes,
    });
    return NextResponse.json(result, { status: result.replay ? 200 : 201, headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) {
    return catalogRouteError(error);
  }
}
