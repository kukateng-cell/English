import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  CATALOG_GOVERNANCE_HEADERS,
  CatalogCsvError,
  catalogRowsToCsv,
  type CatalogHeader,
} from "./csv";
import {
  catalogRowsToXlsx,
  parseCatalogGovernanceFile,
} from "./workbook";

function governanceRow(
  overrides: Partial<Record<CatalogHeader, string>> = {},
): Partial<Record<CatalogHeader, string>> {
  return {
    ...Object.fromEntries(CATALOG_GOVERNANCE_HEADERS.map((header) => [header, ""])),
    schema_version: "word-catalog-v1",
    requested_action: "UPDATE",
    catalog_key: "catalog_accept",
    sense_key: "sense_accept",
    catalog_status: "ACTIVE",
    record_revision: "3",
    term: "accept",
    lemma: "accept",
    part_of_speech: "verb",
    level: "A1",
    category: "daily-life",
    definition_zh: "接受",
    ...overrides,
  };
}

test("catalog XLSX export keeps the 34-field contract and round-trips through upload parsing", async () => {
  const bytes = await catalogRowsToXlsx([governanceRow()], CATALOG_GOVERNANCE_HEADERS);
  const rows = await parseCatalogGovernanceFile(bytes, "catalog-export.xlsx", "XLSX");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.sourceRow, 2);
  assert.equal(rows[0]?.term, "accept");
  assert.equal(rows[0]?.definition_zh, "接受");
  assert.equal(rows[0]?.requested_action, "UPDATE");
});

test("catalog CSV upload remains compatible with the shared governance contract", async () => {
  const bytes = new TextEncoder().encode(
    catalogRowsToCsv([governanceRow()], CATALOG_GOVERNANCE_HEADERS),
  );
  const rows = await parseCatalogGovernanceFile(bytes, "catalog-export.csv", "CSV");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.sense_key, "sense_accept");
});

test("catalog XLSX upload rejects formulas instead of evaluating them", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");
  sheet.addRow(CATALOG_GOVERNANCE_HEADERS);
  sheet.addRow(CATALOG_GOVERNANCE_HEADERS.map((header) => governanceRow()[header] ?? ""));
  sheet.getCell("G2").value = { formula: "HYPERLINK(\"https://example.invalid\")", result: "accept" };
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  await assert.rejects(
    () => parseCatalogGovernanceFile(bytes, "formula.xlsx", "XLSX"),
    (error: unknown) => error instanceof CatalogCsvError && error.code === "CATALOG_CSV_FORMULA_INVALID",
  );
});

test("catalog XLSX upload requires one visible Data worksheet", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(CATALOG_GOVERNANCE_HEADERS);
  sheet.addRow(CATALOG_GOVERNANCE_HEADERS.map((header) => governanceRow()[header] ?? ""));
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  await assert.rejects(
    () => parseCatalogGovernanceFile(bytes, "wrong-sheet.xlsx", "XLSX"),
    (error: unknown) => error instanceof CatalogCsvError && error.code === "CATALOG_XLSX_SHEET_INVALID",
  );
});
