import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { catalogRowsToCsv, parseCatalogGovernanceCsv, CATALOG_GOVERNANCE_HEADERS } from "../src/lib/catalog/csv.ts";

// Integration test: the application's export passes through a real spreadsheet
// engine's import and CSV save, not a simulated serializer.
const directory = await mkdtemp(path.join(tmpdir(), "catalog-csv-spreadsheet-"));
const workbookDir = path.join(directory, "workbook");
const savedDir = path.join(directory, "saved");
await mkdir(workbookDir); await mkdir(savedDir);
const values = ["中文修改", "=literal", "+literal", "-123", "@literal", "'original"];
const rows = values.map(value => ({ schema_version: "word-catalog-v1", requested_action: "CREATE", term: "apple", lemma: "apple", part_of_speech: "noun", level: "A1", category: "other", definition_zh: value }));
await writeFile(path.join(directory, "export.csv"), catalogRowsToCsv(rows, CATALOG_GOVERNANCE_HEADERS));
function run(args) {
  const result = spawnSync("soffice", ["--headless", ...args], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
}
run(["--convert-to", "xlsx", "--outdir", workbookDir, path.join(directory, "export.csv")]);
run(["--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76", "--outdir", savedDir, path.join(workbookDir, "export.xlsx")]);
const bytes = await readFile(path.join(savedDir, "export.csv"));
assert.deepEqual(parseCatalogGovernanceCsv(bytes, "spreadsheet-saved.csv").map(row => row.definition_zh), values);
console.log("Application export -> LibreOffice spreadsheet -> saved CSV -> application parser passed");
console.log(`Disposable test artifacts: ${directory}`);
