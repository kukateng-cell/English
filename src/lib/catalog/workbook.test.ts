import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  CATALOG_GOVERNANCE_HEADERS,
  CatalogCsvError,
  catalogRowsToCsv,
  neutralizeCsvCell,
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

test("editable exports preserve formula-like text and real apostrophes exactly", async () => {
  for (const value of ["=SUM(A1)", "+hello", "-123", "-SUM(1,1)", "-(1+1)", "-ed", "  -SUM(1,1)", "@name", "'original", "'emm-v1:literal"]) {
    const row = governanceRow({ definition_zh: value });
    for (const format of ["CSV", "XLSX"] as const) {
      const bytes = format === "CSV"
        ? new TextEncoder().encode(catalogRowsToCsv([row], CATALOG_GOVERNANCE_HEADERS))
        : await catalogRowsToXlsx([row], CATALOG_GOVERNANCE_HEADERS);
      const parsed = await parseCatalogGovernanceFile(bytes, `roundtrip.${format.toLowerCase()}`, format);
      assert.equal(parsed[0].definition_zh, value, `${format}: ${value}`);
    }
  }
});

test("CSV negative prefixes are safely encoded, not merely round-tripped", async () => {
  for (const value of ["-SUM(1,1)", "-(1+1)", "-123", "-ed", "  -SUM(1,1)"]) {
    const csv = catalogRowsToCsv([governanceRow({ definition_zh: value })], CATALOG_GOVERNANCE_HEADERS);
    const encoded = `'emm-v1:${encodeURIComponent(value)}`;
    assert.ok(csv.includes(encoded), `editable export must encode ${value}`);
    const ordinaryCell = `'${value}`;
    assert.equal(neutralizeCsvCell(value), value.includes(",") ? `"${ordinaryCell}"` : ordinaryCell);
    const raw = csv.replace(encoded, `"${value}"`);
    for (const unsafe of [raw, raw.replace("#emm-catalog-csv-escaped-v1\r\n", "")]) {
      await assert.rejects(
        () => parseCatalogGovernanceFile(new TextEncoder().encode(unsafe), "unsafe.csv", "CSV"),
        (error: unknown) => error instanceof CatalogCsvError && error.code === "CATALOG_CSV_FORMULA_INVALID",
      );
    }
  }
});

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

test("CSV marker survives spreadsheet quoting, padding and line endings", async () => {
  const exported = catalogRowsToCsv([governanceRow({ definition_zh: "=literal" })], CATALOG_GOVERNANCE_HEADERS);
  for (const marker of ["#emm-catalog-csv-escaped-v1", '"#emm-catalog-csv-escaped-v1"', "#emm-catalog-csv-escaped-v1" + ",".repeat(33), '"#emm-catalog-csv-escaped-v1"' + ",".repeat(33)]) {
    for (const ending of ["\r\n", "\n"]) {
      const text = exported.replace("#emm-catalog-csv-escaped-v1", marker).replaceAll("\r\n", ending);
      const rows = await parseCatalogGovernanceFile(new TextEncoder().encode(text), "sheet.csv", "CSV");
      assert.equal(rows[0].definition_zh, "=literal");
      assert.equal(rows[0].sourceRow, 3);
    }
  }
  await assert.rejects(parseCatalogGovernanceFile(new TextEncoder().encode(exported.replace("#emm-catalog-csv-escaped-v1", "#emm-catalog-csv-escaped-v1,unexpected")), "bad.csv", "CSV"), /marker record/);
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
