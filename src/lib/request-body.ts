/**
 * Read a request body with an application-level byte cap.
 *
 * Content-Length is only an early rejection hint: chunked requests and
 * fetch-generated streams must still be bounded while they are being read.
 * The reader is cancelled before the error is returned so callers do not
 * continue consuming an oversized upload in the background.
 */
export async function readLimitedBody(
  req: Request,
  maxBytes: number,
  errorCode = "PAYLOAD_TOO_LARGE",
): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(errorCode);
  if (!req.body) return new Uint8Array();

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("body limit exceeded").catch(() => {});
        throw new Error(errorCode);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
