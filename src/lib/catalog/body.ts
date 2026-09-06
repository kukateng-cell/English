import { readLimitedBody as readLimitedRequestBody } from "@/lib/request-body";

export function readLimitedBody(
  req: Request,
  maxBytes: number,
  errorCode = "CATALOG_CSV_TOO_LARGE",
): Promise<Uint8Array> {
  return readLimitedRequestBody(req, maxBytes, errorCode);
}
