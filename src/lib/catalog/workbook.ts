import ExcelJS from "exceljs";
import {
  CATALOG_GOVERNANCE_HEADERS,
  CATALOG_GOVERNANCE_MAX_BYTES,
  CATALOG_GOVERNANCE_MAX_ROWS,
  CatalogCsvError,
  parseCatalogGovernanceCsv,
  parseCatalogGovernanceRecords,
  type CatalogHeader,
  type CatalogSourceRow,
} from "./csv";
import { preflightRosterXlsx } from "@/lib/roster-file";

export type CatalogWorkbookFormat = "XLSX" | "CSV";

export const CATALOG_XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function safeSpreadsheetText(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // ExcelJS serializes strings as text cells; formulas require a formula object.
  return text;
}

function worksheetCellText(
  value: ExcelJS.CellValue,
  sourceFile: string,
  rowNumber: number,
  columnNumber: number,
): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      throw new CatalogCsvError(
        "CATALOG_CSV_FORMULA_INVALID",
        `${sourceFile}: XLSX row ${rowNumber}, column ${columnNumber} contains a formula`,
      );
    }
    if ("richText" in value) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("hyperlink" in value) return String(value.text ?? "");
    if (value instanceof Date) return value.toISOString();
    throw new CatalogCsvError(
      "CATALOG_XLSX_INVALID",
      `${sourceFile}: XLSX row ${rowNumber}, column ${columnNumber} contains an unsupported cell value`,
    );
  }
  return String(value);
}

function xlsxError(error: unknown, sourceFile: string): never {
  if (error instanceof CatalogCsvError) throw error;
  throw new CatalogCsvError(
    "CATALOG_XLSX_INVALID",
    `${sourceFile}: ${error instanceof Error ? error.message : "XLSX file is invalid"}`,
  );
}

export async function parseCatalogGovernanceFile(
  bytes: Uint8Array,
  sourceFile: string,
  format: CatalogWorkbookFormat,
): Promise<CatalogSourceRow[]> {
  if (format === "CSV") return parseCatalogGovernanceCsv(bytes, sourceFile);
  if (!bytes.length) {
    throw new CatalogCsvError("CATALOG_CSV_EMPTY", `${sourceFile}: XLSX file is empty`);
  }
  if (bytes.byteLength > CATALOG_GOVERNANCE_MAX_BYTES) {
    throw new CatalogCsvError("CATALOG_CSV_TOO_LARGE", `${sourceFile}: XLSX exceeds 4 MiB`);
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new CatalogCsvError("CATALOG_XLSX_INVALID", `${sourceFile}: XLSX signature is invalid`);
  }

  try {
    preflightRosterXlsx(bytes);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    if (
      Reflect.get(workbook, "vbaProject") ||
      Reflect.get(workbook, "_externalLinks")
    ) {
      throw new CatalogCsvError(
        "CATALOG_XLSX_INVALID",
        `${sourceFile}: XLSX macros and external links are not accepted`,
      );
    }
    const visibleSheets = workbook.worksheets.filter(
      (worksheet) => worksheet.state !== "hidden" && worksheet.state !== "veryHidden",
    );
    if (
      visibleSheets.length !== 1 ||
      visibleSheets[0].name.trim().toLocaleLowerCase("en-US") !== "data"
    ) {
      throw new CatalogCsvError(
        "CATALOG_XLSX_SHEET_INVALID",
        `${sourceFile}: XLSX must contain one visible worksheet named Data`,
      );
    }
    const sheet = visibleSheets[0];
    if (sheet.actualRowCount > CATALOG_GOVERNANCE_MAX_ROWS + 1) {
      throw new CatalogCsvError(
        "CATALOG_CSV_TOO_MANY_ROWS",
        `${sourceFile}: XLSX exceeds ${CATALOG_GOVERNANCE_MAX_ROWS} data rows`,
      );
    }
    if (sheet.actualColumnCount > CATALOG_GOVERNANCE_HEADERS.length) {
      throw new CatalogCsvError(
        "CATALOG_CSV_COLUMN_COUNT_INVALID",
        `${sourceFile}: XLSX has more than ${CATALOG_GOVERNANCE_HEADERS.length} columns`,
      );
    }

    const columnCount = Math.max(
      sheet.actualColumnCount,
      CATALOG_GOVERNANCE_HEADERS.length,
    );
    let textBytes = 0;
    const records: Array<{ values: string[]; sourceLine: number }> = [];
    const appendRow = (row: ExcelJS.Row) => {
      const values: string[] = [];
      for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
        const value = worksheetCellText(
          row.getCell(columnNumber).value,
          sourceFile,
          row.number,
          columnNumber,
        );
        textBytes += Buffer.byteLength(value, "utf8");
        if (textBytes > CATALOG_GOVERNANCE_MAX_BYTES) {
          throw new CatalogCsvError(
            "CATALOG_CSV_TOO_LARGE",
            `${sourceFile}: XLSX cell content exceeds 4 MiB`,
          );
        }
        values.push(value);
      }
      records.push({ values, sourceLine: row.number });
    };
    appendRow(sheet.getRow(1));
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (row.number !== 1) appendRow(row);
    });
    return parseCatalogGovernanceRecords(records, sourceFile, "XLSX");
  } catch (error) {
    xlsxError(error, sourceFile);
  }
}

function excelColumnName(columnNumber: number): string {
  let value = columnNumber;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

export async function catalogRowsToXlsx(
  rows: readonly Partial<Record<CatalogHeader, unknown>>[],
  headers: readonly CatalogHeader[] = CATALOG_GOVERNANCE_HEADERS,
): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "EMM English";
  const sheet = workbook.addWorksheet("Data", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow(headers.map((header) => safeSpreadsheetText(row[header])));
  }
  sheet.autoFilter = {
    from: "A1",
    to: `${excelColumnName(headers.length)}1`,
  };
  const headerRow = sheet.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF40218F" },
    };
    cell.alignment = { vertical: "middle" };
  });
  sheet.columns.forEach((column, index) => {
    const header = headers[index] ?? "";
    let width = Math.max(12, Math.min(24, header.length + 2));
    for (const value of rows.slice(0, 200)) {
      width = Math.max(
        width,
        Math.min(40, safeSpreadsheetText(value[header as CatalogHeader]).length + 2),
      );
    }
    column.width = width;
    column.numFmt = "@";
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const source = new Uint8Array(buffer);
  const output = new Uint8Array(source.byteLength);
  output.set(source);
  return output;
}
