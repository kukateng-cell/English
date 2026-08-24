export interface CatalogExportTarget {
  senseKey: string | null;
  hasSense: boolean;
  revision: number | null;
}

export type CatalogExportAvailability =
  | "EXPORTABLE"
  | "REQUIRES_GOVERNED_REVISION"
  | "REVISION_UNAVAILABLE"
  | "MISSING_SENSE_KEY";

export type CatalogExportKeyInput =
  | { ok: true; senseKeys: string[] }
  | { ok: false; issue: "EMPTY" | "DUPLICATE" | "TOO_MANY" };

export interface CatalogExportRevisionSource {
  approvedRevision: unknown | null;
  revisions: readonly unknown[];
}

/**
 * CSV UPDATE exports require an existing governed WordSense. Import-only
 * draft rows can still be repaired through the per-word editor, but they do
 * not yet have the revision identity required by the bulk UPDATE contract.
 */
export function hasCatalogExportTarget(row: CatalogExportTarget): boolean {
  return catalogExportAvailability(row) === "EXPORTABLE";
}

export function catalogExportAvailability(row: CatalogExportTarget): CatalogExportAvailability {
  if (!row.senseKey) return "MISSING_SENSE_KEY";
  if (!row.hasSense) return "REQUIRES_GOVERNED_REVISION";
  if (row.revision === null) return "REVISION_UNAVAILABLE";
  return "EXPORTABLE";
}

export function allCatalogExportSensesHaveRevision(senses: readonly CatalogExportRevisionSource[]): boolean {
  return senses.every((sense) => Boolean(sense.approvedRevision ?? sense.revisions[0]));
}

export function parseCatalogExportKeys(input: string): CatalogExportKeyInput {
  const senseKeys = input.split(/[\n,]+/u).map((value) => value.trim()).filter(Boolean);
  return validateCatalogExportKeys(senseKeys);
}

export function parseCatalogExportKeyArray(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  if (input.some((value) => typeof value !== "string" || !value || value.trim() !== value)) return null;
  const result = validateCatalogExportKeys(input as string[]);
  return result.ok ? result.senseKeys : null;
}

function validateCatalogExportKeys(senseKeys: string[]): CatalogExportKeyInput {
  if (!senseKeys.length) return { ok: false, issue: "EMPTY" };
  if (senseKeys.length > 200) return { ok: false, issue: "TOO_MANY" };
  if (new Set(senseKeys).size !== senseKeys.length) return { ok: false, issue: "DUPLICATE" };
  return { ok: true, senseKeys };
}
