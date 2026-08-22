import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CATALOG_NORMALIZATION_VERSION,
  CATALOG_SCHEMA_VERSION,
  CATALOG_VALIDATOR_VERSION,
} from "./csv";

export const CATALOG_INITIAL_ACTIVATION_MANIFEST_PATH =
  "outputs/catalog-identity/word-catalog-v1.initial-activation.json";
export const CATALOG_INITIAL_ACTIVATION_MANIFEST_VERSION =
  "catalog-initial-activation-v1" as const;
export const CATALOG_INITIAL_ACTIVATION_SELECTION_RULE =
  "VALIDATOR_PASSED_AND_DIRECTION_ENABLED" as const;

export interface CatalogInitialActivationManifest {
  manifestVersion: typeof CATALOG_INITIAL_ACTIVATION_MANIFEST_VERSION;
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  sourceDigest: string;
  validatorVersion: typeof CATALOG_VALIDATOR_VERSION;
  normalizationVersion: typeof CATALOG_NORMALIZATION_VERSION;
  selectionRule: typeof CATALOG_INITIAL_ACTIVATION_SELECTION_RULE;
  selectionDigests: {
    activeSenseKeysSha256: string;
    draftSenseKeysSha256: string;
  };
  expected: {
    sourceRows: number;
    validRows: number;
    activeSenses: number;
    draftSenses: number;
    validationFailedRows: number;
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export function catalogSenseKeySetDigest(
  senseKeys: readonly string[],
): string {
  return createHash("sha256")
    .update([...senseKeys].sort().join("\n"), "utf8")
    .digest("hex");
}

export async function readCatalogInitialActivationManifest(
  rootDir: string,
  sourceDigest: string,
): Promise<CatalogInitialActivationManifest> {
  const manifestPath = path.join(
    rootDir,
    CATALOG_INITIAL_ACTIVATION_MANIFEST_PATH,
  );
  let parsed: CatalogInitialActivationManifest;
  try {
    parsed = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as CatalogInitialActivationManifest;
  } catch (error) {
    throw new Error(
      `Cannot read checked-in catalog initial activation manifest ${manifestPath}: ${String(error)}`,
    );
  }

  const expected = parsed.expected;
  if (
    parsed.manifestVersion !== CATALOG_INITIAL_ACTIVATION_MANIFEST_VERSION ||
    parsed.schemaVersion !== CATALOG_SCHEMA_VERSION ||
    parsed.sourceDigest !== sourceDigest ||
    parsed.validatorVersion !== CATALOG_VALIDATOR_VERSION ||
    parsed.normalizationVersion !== CATALOG_NORMALIZATION_VERSION ||
    parsed.selectionRule !== CATALOG_INITIAL_ACTIVATION_SELECTION_RULE ||
    !parsed.selectionDigests ||
    !isSha256(parsed.selectionDigests.activeSenseKeysSha256) ||
    !isSha256(parsed.selectionDigests.draftSenseKeysSha256) ||
    !expected ||
    !isNonNegativeInteger(expected.sourceRows) ||
    !isNonNegativeInteger(expected.validRows) ||
    !isNonNegativeInteger(expected.activeSenses) ||
    !isNonNegativeInteger(expected.draftSenses) ||
    !isNonNegativeInteger(expected.validationFailedRows) ||
    expected.validRows !== expected.activeSenses + expected.draftSenses ||
    expected.sourceRows !== expected.validRows + expected.validationFailedRows
  ) {
    throw new Error(
      "Catalog initial activation manifest does not match the supported contract or CSV source digest; update it only after an intentional catalog approval.",
    );
  }
  return parsed;
}
