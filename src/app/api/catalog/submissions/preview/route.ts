import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/csrf";
import { CATALOG_GOVERNANCE_MAX_BYTES } from "@/lib/catalog/csv";
import { catalogBulkSubmissionEnabled } from "@/lib/catalog/features";
import { catalogRouteError, catalogResponse, CATALOG_PRIVATE_HEADERS, readLimitedBody, requireCatalogActor } from "@/lib/catalog/api";
import { createCatalogSubmissionPreview, decodeCatalogUploadName } from "@/lib/catalog/submission-server";
import { CATALOG_XLSX_CONTENT_TYPE, type CatalogWorkbookFormat } from "@/lib/catalog/workbook";

function uploadFormat(contentType: string): CatalogWorkbookFormat | null {
  const normalized = contentType.toLocaleLowerCase("en-US").split(";", 1)[0]?.trim();
  if (normalized === "text/csv" || normalized === "application/csv") return "CSV";
  if (normalized === CATALOG_XLSX_CONTENT_TYPE) return "XLSX";
  return null;
}

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return catalogResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireCatalogActor(req, { rateLimit: true });
  if (!auth.ok) return auth.response;
  if (!catalogBulkSubmissionEnabled()) return NextResponse.json({ code: "CATALOG_BULK_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  const format = uploadFormat(req.headers.get("content-type") ?? "");
  if (!format) return catalogResponse("CATALOG_CONTENT_TYPE_INVALID", 415);
  try {
    const bytes = await readLimitedBody(req, CATALOG_GOVERNANCE_MAX_BYTES);
    const result = await createCatalogSubmissionPreview({
      actorId: auth.actor.userId,
      operationId: req.headers.get("idempotency-key") ?? "",
      fileName: decodeCatalogUploadName(req.headers.get("x-catalog-filename"), format),
      bytes,
      format,
    });
    return NextResponse.json(result, { status: result.replay ? 200 : 201, headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) {
    return catalogRouteError(error);
  }
}
