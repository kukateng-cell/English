import { NextResponse } from "next/server";
import { CATALOG_GOVERNANCE_HEADERS, catalogRowsToCsv } from "@/lib/catalog/csv";
import { CATALOG_PRIVATE_HEADERS, requireCatalogActor } from "@/lib/catalog/api";
import { catalogBulkSubmissionEnabled } from "@/lib/catalog/features";
import { catalogRowsToXlsx, CATALOG_XLSX_CONTENT_TYPE } from "@/lib/catalog/workbook";

export async function GET(req: Request) {
  const auth = await requireCatalogActor(req);
  if (!auth.ok) return auth.response;
  if (!catalogBulkSubmissionEnabled()) return NextResponse.json({ code: "CATALOG_BULK_DISABLED" }, { status: 404, headers: CATALOG_PRIVATE_HEADERS });
  const blank = Object.fromEntries(CATALOG_GOVERNANCE_HEADERS.map((header) => [header, ""]));
  blank.schema_version = "word-catalog-v1";
  blank.requested_action = "CREATE";
  const requestedFormat = new URL(req.url).searchParams.get("format")?.toLocaleLowerCase("en-US") ?? "xlsx";
  if (requestedFormat !== "xlsx" && requestedFormat !== "csv") {
    return NextResponse.json({ code: "CATALOG_EXPORT_FORMAT_INVALID" }, { status: 422, headers: CATALOG_PRIVATE_HEADERS });
  }
  if (requestedFormat === "xlsx") {
    return new Response(await catalogRowsToXlsx([blank], CATALOG_GOVERNANCE_HEADERS), {
      headers: {
        ...CATALOG_PRIVATE_HEADERS,
        "Content-Type": CATALOG_XLSX_CONTENT_TYPE,
        "Content-Disposition": "attachment; filename*=UTF-8''word-catalog-template.xlsx",
      },
    });
  }
  const csv = catalogRowsToCsv([blank], CATALOG_GOVERNANCE_HEADERS);
  return new NextResponse(csv, {
    headers: {
      ...CATALOG_PRIVATE_HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename*=UTF-8''word-catalog-template.csv",
    },
  });
}
