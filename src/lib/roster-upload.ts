import {
  MAX_ROSTER_FILE_BYTES,
  type RosterFileFormat,
} from "./roster-file";

export const ROSTER_UPLOAD_HEADERS = {
  fileName: "x-roster-file-name",
  entityType: "x-roster-entity-type",
  academicYearId: "x-roster-academic-year-id",
  mode: "x-roster-mode",
  acknowledgeImmediateGlobalCapabilityChange:
    "x-roster-acknowledge-immediate-global-capability-change",
  operationId: "x-roster-operation-id",
} as const;

export type RosterUploadMetadata = {
  fileName: string;
  format: RosterFileFormat;
  entityType: "STUDENT" | "TEACHER";
  academicYearId: string;
  mode: "CREATE_ONLY" | "MERGE";
  acknowledgeImmediateGlobalCapabilityChange: boolean;
  operationId: string;
};

export class RosterUploadError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 413 | 415 | 422,
  ) {
    super(code);
    this.name = "RosterUploadError";
  }
}

function requiredHeader(headers: Headers, name: string, code: string): string {
  const value = headers.get(name)?.trim() ?? "";
  if (!value) throw new RosterUploadError(code, 422);
  return value;
}

function parseFileName(headers: Headers): { fileName: string; format: RosterFileFormat } {
  const encoded = requiredHeader(headers, ROSTER_UPLOAD_HEADERS.fileName, "ROSTER_FILE_REQUIRED");
  let fileName: string;
  try {
    fileName = decodeURIComponent(encoded).normalize("NFKC").trim();
  } catch {
    throw new RosterUploadError("ROSTER_FILE_NAME_INVALID", 422);
  }
  if (
    !fileName ||
    Buffer.byteLength(fileName, "utf8") > 180 ||
    /[\u0000-\u001f\u007f/\\]/u.test(fileName) ||
    fileName === "." ||
    fileName === ".."
  ) {
    throw new RosterUploadError("ROSTER_FILE_NAME_INVALID", 422);
  }
  const lowerName = fileName.toLowerCase();
  const format = lowerName.endsWith(".csv")
    ? "CSV"
    : lowerName.endsWith(".xlsx")
      ? "XLSX"
      : null;
  if (!format) throw new RosterUploadError("ROSTER_FORMAT_INVALID", 422);
  return { fileName, format };
}

export function parseRosterUploadMetadata(headers: Headers): RosterUploadMetadata {
  const { fileName, format } = parseFileName(headers);
  const entityType = requiredHeader(
    headers,
    ROSTER_UPLOAD_HEADERS.entityType,
    "ROSTER_ENTITY_TYPE_INVALID",
  );
  if (entityType !== "STUDENT" && entityType !== "TEACHER") {
    throw new RosterUploadError("ROSTER_ENTITY_TYPE_INVALID", 422);
  }
  const academicYearId = requiredHeader(
    headers,
    ROSTER_UPLOAD_HEADERS.academicYearId,
    "ACADEMIC_YEAR_REQUIRED",
  );
  if (academicYearId.length > 128 || /[\u0000-\u001f\u007f]/u.test(academicYearId)) {
    throw new RosterUploadError("ACADEMIC_YEAR_REQUIRED", 422);
  }
  const mode = requiredHeader(headers, ROSTER_UPLOAD_HEADERS.mode, "ROSTER_MODE_INVALID");
  if (mode !== "CREATE_ONLY" && mode !== "MERGE") {
    throw new RosterUploadError("ROSTER_MODE_INVALID", 422);
  }
  const acknowledgement = requiredHeader(
    headers,
    ROSTER_UPLOAD_HEADERS.acknowledgeImmediateGlobalCapabilityChange,
    "ROSTER_ACKNOWLEDGEMENT_INVALID",
  );
  if (acknowledgement !== "true" && acknowledgement !== "false") {
    throw new RosterUploadError("ROSTER_ACKNOWLEDGEMENT_INVALID", 422);
  }
  const operationId = requiredHeader(
    headers,
    ROSTER_UPLOAD_HEADERS.operationId,
    "ROSTER_OPERATION_ID_INVALID",
  );
  if (operationId.length > 128 || /[\u0000-\u001f\u007f]/u.test(operationId)) {
    throw new RosterUploadError("ROSTER_OPERATION_ID_INVALID", 422);
  }

  const contentType = (headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const acceptedContentTypes = format === "CSV"
    ? new Set(["text/csv", "application/csv"])
    : new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
  if (!acceptedContentTypes.has(contentType)) {
    throw new RosterUploadError("ROSTER_CONTENT_TYPE_INVALID", 415);
  }
  if (headers.has("content-encoding")) {
    throw new RosterUploadError("ROSTER_CONTENT_ENCODING_UNSUPPORTED", 415);
  }

  return {
    fileName,
    format,
    entityType,
    academicYearId,
    mode,
    acknowledgeImmediateGlobalCapabilityChange: acknowledgement === "true",
    operationId,
  };
}

export async function readRosterUploadBody(
  request: Request,
  maximumBytes = MAX_ROSTER_FILE_BYTES,
): Promise<Uint8Array> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength)) {
      throw new RosterUploadError("ROSTER_CONTENT_LENGTH_INVALID", 422);
    }
    if (Number(declaredLength) > maximumBytes) {
      throw new RosterUploadError("ROSTER_FILE_TOO_LARGE", 413);
    }
  }
  if (!request.body) throw new RosterUploadError("ROSTER_FILE_REQUIRED", 422);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel("ROSTER_FILE_TOO_LARGE");
        throw new RosterUploadError("ROSTER_FILE_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (totalBytes === 0) throw new RosterUploadError("ROSTER_FILE_REQUIRED", 422);

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
