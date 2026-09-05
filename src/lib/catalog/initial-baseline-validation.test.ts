import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readCatalogSourceFiles } from "./seed";
import { normalizeCatalogRow, validateCatalogRow } from "./csv";
import { validateInitialBaselineRow } from "./initial-baseline-validation";
import { catalogSenseKeySetDigest, readCatalogInitialActivationManifest } from "./initial-activation";
import type { CatalogIdentityManifest } from "./identity";

test("frozen approval reproduces the original set while daily validation can relax", async () => {
  const identity = JSON.parse(await readFile("outputs/catalog-identity/word-catalog-v1.identity.json", "utf8")) as CatalogIdentityManifest;
  const manifest = await readCatalogInitialActivationManifest(process.cwd(), identity.sourceDigest);
  const assignments = new Map(identity.assignments.map(row => [`${row.sourceFile}:${row.sourceRow}`, row]));
  const rows = (await readCatalogSourceFiles()).flatMap(file => file.rows).map(row => {
    const assigned = assignments.get(`${row.sourceFile}:${row.sourceRow}`)!;
    return normalizeCatalogRow({ ...row, catalog_key: assigned.catalogKey, sense_key: assigned.senseKey }, 0);
  });
  const active: string[] = [], draft: string[] = [];
  let failed = 0, nowValidButNotApproved = 0;
  for (const row of rows) {
    const historical = validateInitialBaselineRow(row, rows.filter(other => other.normalizedTerm === row.normalizedTerm && other.senseKey !== row.senseKey));
    if (historical.errors.length) {
      failed++;
      if (validateCatalogRow(row).errors.length === 0) nowValidButNotApproved++;
    } else (historical.directionEligible ? active : draft).push(row.senseKey);
  }
  assert.equal(rows.length, manifest.expected.sourceRows);
  assert.equal(failed, manifest.expected.validationFailedRows);
  assert.equal(active.length, manifest.expected.activeSenses);
  assert.equal(draft.length, manifest.expected.draftSenses);
  assert.equal(nowValidButNotApproved, 65);
  assert.equal(catalogSenseKeySetDigest(active), manifest.selectionDigests.activeSenseKeysSha256);
  assert.equal(catalogSenseKeySetDigest(draft), manifest.selectionDigests.draftSenseKeysSha256);
});
