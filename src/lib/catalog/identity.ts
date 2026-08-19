import { createHash } from "node:crypto";
import type { CatalogSourceRow } from "./csv";
import { normalizeCatalogText } from "./csv";

export const CATALOG_IDENTITY_MANIFEST_VERSION = "catalog-identity-manifest-v1" as const;
export const CATALOG_IDENTITY_MANIFEST_PATH = "outputs/catalog-identity/word-catalog-v1.identity.json" as const;

export interface CatalogIdentityAssignment {
  sourceFile: string;
  sourceRow: number;
  /** Content-independent enough to survive reorder and level/category edits. */
  matchKey: string;
  identityFingerprint: string;
  catalogKey: string;
  senseKey: string;
  /** Explicit resolution for duplicate spellings; never inferred by seed. */
  resolution: "CREATE" | "KEEP_DISTINCT" | "MERGE" | "CONFLICT";
  /** Explicit V1 primary mapping; never selected by lowest-level-wins. */
  legacyPrimary: boolean;
}

export interface CatalogIdentityManifest {
  manifestVersion: typeof CATALOG_IDENTITY_MANIFEST_VERSION;
  schemaVersion: "word-catalog-v1";
  sourceDigest: string;
  assignments: CatalogIdentityAssignment[];
}

export function identityGroupKey(row: CatalogSourceRow): string {
  return [
    normalizeCatalogText(row.term),
    normalizeCatalogText(row.part_of_speech),
    normalizeCatalogText(row.level),
    normalizeCatalogText(row.category),
  ].join("\0");
}

export function identityMatchKey(row: CatalogSourceRow): string {
  return [
    row.sourceFile,
    normalizeCatalogText(row.term),
    normalizeCatalogText(row.part_of_speech),
    normalizeCatalogText(row.definition_zh),
  ].join("\0");
}

export function identityFingerprint(row: CatalogSourceRow): string {
  return createHash("sha256")
    .update(identityMatchKey(row), "utf8")
    .digest("hex");
}

export function sourceLocator(sourceFile: string, sourceRow: number): string {
  return `${sourceFile}:${sourceRow}`;
}
