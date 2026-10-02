import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseRosterFile } from "../src/lib/roster-file";

async function workbookWithCell(value: ExcelJS.CellValue) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("data");
  sheet.addRow(["accountName", "legalName"]);
  sheet.addRow([value, "Spike Student"]);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function main() {
  await assert.rejects(
    parseRosterFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "XLSX"),
    /Corrupted zip|XLSX|档案|格式/iu,
  );
  await assert.rejects(
    parseRosterFile(await workbookWithCell({ formula: 'HYPERLINK("https://example.test")' }), "XLSX"),
    /公式/u,
  );
  await assert.rejects(
    parseRosterFile(await workbookWithCell(1234), "XLSX"),
    /文字格式/u,
  );

  console.log("Roster workbook malicious-input spike passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
