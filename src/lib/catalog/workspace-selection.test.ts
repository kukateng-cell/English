import assert from "node:assert/strict";
import test from "node:test";
import {
  allCatalogExportSensesHaveRevision,
  catalogExportAvailability,
  hasCatalogExportTarget,
  parseCatalogExportKeyArray,
  parseCatalogExportKeys,
} from "./workspace-selection";

test("governed word senses with stable keys can be exported", () => {
  assert.equal(hasCatalogExportTarget({ senseKey: "sense_example", hasSense: true, revision: 3 }), true);
});

test("import-only draft rows cannot enter the bulk UPDATE selection", () => {
  const row = { senseKey: "sense_draft", hasSense: false, revision: null };
  assert.equal(hasCatalogExportTarget(row), false);
  assert.equal(catalogExportAvailability(row), "REQUIRES_GOVERNED_REVISION");
});

test("rows without a sense key cannot enter the bulk UPDATE selection", () => {
  const row = { senseKey: null, hasSense: true, revision: 1 };
  assert.equal(hasCatalogExportTarget(row), false);
  assert.equal(catalogExportAvailability(row), "MISSING_SENSE_KEY");
});

test("import-only rows without a key do not promise an unavailable per-word editor", () => {
  assert.equal(
    catalogExportAvailability({ senseKey: null, hasSense: false, revision: null }),
    "MISSING_SENSE_KEY",
  );
});

test("governed senses without a readable revision fail closed", () => {
  const row = { senseKey: "sense_incomplete", hasSense: true, revision: null };
  assert.equal(hasCatalogExportTarget(row), false);
  assert.equal(catalogExportAvailability(row), "REVISION_UNAVAILABLE");
});

test("manual export input accepts exactly 200 unique keys", () => {
  assert.deepEqual(parseCatalogExportKeys("sense_one"), { ok: true, senseKeys: ["sense_one"] });
  const result = parseCatalogExportKeys(Array.from({ length: 200 }, (_, index) => `sense_${index}`).join("\n"));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.senseKeys.length, 200);
});

test("manual export input rejects the 201st key and duplicates", () => {
  assert.deepEqual(
    parseCatalogExportKeys(Array.from({ length: 201 }, (_, index) => `sense_${index}`).join(",")),
    { ok: false, issue: "TOO_MANY" },
  );
  assert.deepEqual(parseCatalogExportKeys("sense_a\nsense_a"), { ok: false, issue: "DUPLICATE" });
});

test("server export arrays reject malformed members instead of exporting a partial selection", () => {
  assert.deepEqual(parseCatalogExportKeyArray(["sense_one"]), ["sense_one"]);
  assert.equal(parseCatalogExportKeyArray(["sense_one", null]), null);
  assert.equal(parseCatalogExportKeyArray(["sense_one", ""]), null);
  assert.equal(parseCatalogExportKeyArray(["sense_one", " sense_two"]), null);
  assert.equal(parseCatalogExportKeyArray(Array.from({ length: 201 }, (_, index) => `sense_${index}`)), null);
  assert.equal(parseCatalogExportKeyArray(["sense_one", "sense_one"]), null);
});

test("server export revision guard rejects any sense without revision content", () => {
  assert.equal(allCatalogExportSensesHaveRevision([
    { approvedRevision: { revision: 2 }, revisions: [] },
    { approvedRevision: null, revisions: [{ revision: 1 }] },
  ]), true);
  assert.equal(allCatalogExportSensesHaveRevision([
    { approvedRevision: { revision: 2 }, revisions: [] },
    { approvedRevision: null, revisions: [] },
  ]), false);
});
