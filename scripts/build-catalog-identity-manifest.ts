import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readCatalogSourceFiles } from "../src/lib/catalog/seed";
import {
  CATALOG_IDENTITY_MANIFEST_PATH,
  CATALOG_IDENTITY_MANIFEST_VERSION,
  identityFingerprint,
  identityMatchKey,
  type CatalogIdentityAssignment,
  type CatalogIdentityManifest,
} from "../src/lib/catalog/identity";
import { normalizeCatalogText } from "../src/lib/catalog/csv";

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function opaqueKey(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function locator(sourceFile: string, sourceRow: number): string {
  return `${sourceFile}:${sourceRow}`;
}

const root = process.cwd();

async function readPreviousManifest(output: string): Promise<CatalogIdentityManifest | null> {
  try {
    return JSON.parse(await readFile(output, "utf8")) as CatalogIdentityManifest;
  } catch {
    return null;
  }
}

async function main() {
  const files = await readCatalogSourceFiles(root);
  const allRows = files.flatMap((file) => file.rows);
  const output = path.join(root, CATALOG_IDENTITY_MANIFEST_PATH);
  const previous = await readPreviousManifest(output);
  const previousByLocator = new Map((previous?.assignments ?? []).map((assignment) => [locator(assignment.sourceFile, assignment.sourceRow), assignment]));
  const previousByMatch = new Map<string, CatalogIdentityAssignment[]>();
  for (const assignment of previous?.assignments ?? []) {
    if (!assignment.matchKey) continue;
    const bucket = previousByMatch.get(assignment.matchKey) ?? [];
    bucket.push(assignment);
    previousByMatch.set(assignment.matchKey, bucket);
  }

  const termCounts = new Map<string, number>();
  for (const row of allRows) {
    const key = normalizeCatalogText(row.term);
    termCounts.set(key, (termCounts.get(key) ?? 0) + 1);
  }
  const firstByTerm = new Map<string, number>();
  const usedSenseKeys = new Set<string>();
  const usedCatalogKeys = new Set<string>();
  const unresolved: string[] = [];
  const assignments: CatalogIdentityAssignment[] = [];
  const catalogByLemma = new Map<string, string>();

  for (const row of allRows) {
    const rowLocator = locator(row.sourceFile, row.sourceRow);
    const matchKey = identityMatchKey(row);
    const explicitCatalogKey = row.catalog_key.trim();
    const explicitSenseKey = row.sense_key.trim();
    const exactPrevious = previousByLocator.get(rowLocator);
    const candidates = previousByMatch.get(matchKey) ?? [];
    const matched = exactPrevious ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!matched && !explicitSenseKey && candidates.length > 1) {
      unresolved.push(`${rowLocator}: identity match is ambiguous; add catalog_key/sense_key explicitly`);
      continue;
    }

    const lemmaKey = normalizeCatalogText(row.lemma || row.term);
    const catalogKey = explicitCatalogKey || matched?.catalogKey || catalogByLemma.get(lemmaKey) || opaqueKey("cat");
    const senseKey = explicitSenseKey || matched?.senseKey || opaqueKey("sense");
    if (matched && explicitCatalogKey && explicitCatalogKey !== matched.catalogKey) unresolved.push(`${rowLocator}: catalog_key changed without an explicit identity migration`);
    if (matched && explicitSenseKey && explicitSenseKey !== matched.senseKey) unresolved.push(`${rowLocator}: sense_key changed without an explicit identity migration`);
    if (usedSenseKeys.has(senseKey)) unresolved.push(`${rowLocator}: duplicate sense_key ${senseKey}`);
    if (usedCatalogKeys.has(catalogKey) === false) usedCatalogKeys.add(catalogKey);
    usedSenseKeys.add(senseKey);
    catalogByLemma.set(lemmaKey, catalogKey);

    const termKey = normalizeCatalogText(row.term);
    const primaryIndex = firstByTerm.get(termKey) ?? 0;
    firstByTerm.set(termKey, primaryIndex + 1);
    assignments.push({
      sourceFile: row.sourceFile,
      sourceRow: row.sourceRow,
      matchKey,
      identityFingerprint: identityFingerprint(row),
      catalogKey,
      senseKey,
      resolution: matched?.resolution ?? (termCounts.get(termKey)! > 1 ? "KEEP_DISTINCT" : "CREATE"),
      legacyPrimary: matched?.legacyPrimary ?? primaryIndex === 0,
    });
  }

  if (unresolved.length > 0) {
    throw new Error(`Identity manifest requires explicit resolution:\n${unresolved.slice(0, 20).join("\n")}`);
  }
  if (assignments.length !== allRows.length) throw new Error("Identity manifest assignment count does not match CSV row count.");
  const sourceDigest = digest(files.map((file) => `${file.relativePath}\0${file.digest}`).join("\n"));
  const manifest: CatalogIdentityManifest = {
    manifestVersion: CATALOG_IDENTITY_MANIFEST_VERSION,
    schemaVersion: "word-catalog-v1",
    sourceDigest,
    assignments,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote ${assignments.length} checked-in catalog identity assignments to ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
