import ExcelJS from "exceljs";

export const MAX_ROSTER_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROSTER_ROWS = 500;
export const MAX_ROSTER_COLUMNS = 100;
export const MAX_ROSTER_CELL_LENGTH = 4_000;
export const MAX_ROSTER_INFLATED_BYTES = 25 * 1024 * 1024;

export type RosterFileFormat = "CSV" | "XLSX";
export type RosterCellRow = Record<string, string>;

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("CSV 引号未闭合");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      throw new Error("名单不可包含公式");
    }
    if ("hyperlink" in value) return String(value.text ?? "");
    if ("richText" in value) {
      return value.richText.map((part) => part.text).join("");
    }
    if (value instanceof Date) return value.toISOString();
    throw new Error("名单包含不支援的储存格类型");
  }
  return String(value);
}

function recordsFromRows(rows: string[][]): RosterCellRow[] {
  const nonempty = rows.filter((row) => row.some((cell) => cell.trim()));
  if (nonempty.length < 1) throw new Error("名单必须包含标题");
  const headers = nonempty[0].map((header) =>
    header.replace(/^\uFEFF/, "").normalize("NFKC").trim(),
  );
  if (headers.length > MAX_ROSTER_COLUMNS) throw new Error("名单栏位过多");
  if (headers.some((header) => !header)) throw new Error("名单标题不可留空");
  if (new Set(headers).size !== headers.length) throw new Error("名单标题不可重复");
  if (nonempty.length - 1 > MAX_ROSTER_ROWS) throw new Error("名单最多 500 行");
  return nonempty.slice(1).map((row) =>
    Object.fromEntries(
      headers.map((header, index) => {
        const value = (row[index] ?? "").normalize("NFKC").trim();
        if (value.length > MAX_ROSTER_CELL_LENGTH) {
          throw new Error(`栏位 ${header} 内容过长`);
        }
        return [header, value];
      }),
    ),
  );
}

export async function parseRosterFile(
  bytes: Uint8Array,
  format: RosterFileFormat,
): Promise<RosterCellRow[]> {
  if (!bytes.length) throw new Error("档案为空");
  if (bytes.length > MAX_ROSTER_FILE_BYTES) throw new Error("档案不可超过 5 MiB");
  if (format === "CSV") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return recordsFromRows(parseCsvRows(text));
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("XLSX 档案格式无效");
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  if (Reflect.get(workbook, "vbaProject") || Reflect.get(workbook, "_externalLinks")) {
    throw new Error("XLSX 不可包含宏或外部链接");
  }
  const visibleSheets = workbook.worksheets.filter(
    (worksheet) => worksheet.state !== "hidden" && worksheet.state !== "veryHidden",
  );
  if (visibleSheets.length !== 1 || visibleSheets[0].name.trim().toLowerCase() !== "data") {
    throw new Error("XLSX 必须有一个可见的资料工作表");
  }
  const sheet = visibleSheets[0];
  if (sheet.actualRowCount > MAX_ROSTER_ROWS + 1) throw new Error("名单最多 500 行");
  if (sheet.actualColumnCount > MAX_ROSTER_COLUMNS) throw new Error("名单栏位过多");
  const rows: string[][] = [];
  let inflatedBytes = 0;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    for (let index = 1; index <= sheet.actualColumnCount; index += 1) {
      const value = row.getCell(index).value;
      if (typeof value === "number" && rows.length > 0) {
        const header = rows[0]?.[index - 1]?.trim().toLowerCase();
        if (["accountname", "studentnumber", "account", "账号", "帳號", "学生证号码", "學生證號碼"].includes(header)) {
          throw new Error("学生证号／账号储存格必须设为文字格式");
        }
      }
      const text = cellText(value);
      inflatedBytes += Buffer.byteLength(text, "utf8");
      if (inflatedBytes > MAX_ROSTER_INFLATED_BYTES) {
        throw new Error("XLSX 解压后资料过大");
      }
      values.push(text);
    }
    rows.push(values);
  });
  return recordsFromRows(rows);
}
