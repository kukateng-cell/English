import ExcelJS from "exceljs";
import { inflateRawSync } from "node:zlib";

// Vercel Functions reject request bodies above 4.5 MB before a route runs.
// Keep the app limit below that ceiling so callers receive our stable JSON.
export const MAX_ROSTER_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_ROSTER_ROWS = 500;
export const MAX_ROSTER_COLUMNS = 100;
export const MAX_ROSTER_CELL_LENGTH = 4_000;
export const MAX_ROSTER_INFLATED_BYTES = 25 * 1024 * 1024;
export const MAX_ROSTER_ZIP_ENTRY_BYTES = 16 * 1024 * 1024;
export const MAX_ROSTER_ZIP_ENTRIES = 512;
export const MAX_ROSTER_ZIP_COMPRESSION_RATIO = 200;

export type RosterFileFormat = "CSV" | "XLSX";
const SOURCE_ROW_NUMBER = Symbol("rosterSourceRowNumber");
export type RosterCellRow = Record<string, string> & { [SOURCE_ROW_NUMBER]: number };
type ParsedRosterRow = { sourceRowNumber: number; values: string[] };

export function rosterSourceRowNumber(row: RosterCellRow): number {
  return row[SOURCE_ROW_NUMBER];
}

function parseCsvRows(text: string): ParsedRosterRow[] {
  const rows: ParsedRosterRow[] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let afterClosingQuote = false;
  let currentLine = 1;
  let rowStartLine = 1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        afterClosingQuote = true;
      } else {
        cell += char;
        if (char === "\n") currentLine += 1;
      }
      continue;
    }
    if (afterClosingQuote) {
      if (char === ",") {
        row.push(cell);
        cell = "";
        afterClosingQuote = false;
      } else if (char === "\n") {
        row.push(cell);
        rows.push({ sourceRowNumber: rowStartLine, values: row });
        row = [];
        cell = "";
        afterClosingQuote = false;
        currentLine += 1;
        rowStartLine = currentLine;
      } else if (char === "\r" && text[index + 1] === "\n") {
        // The following LF owns the physical line transition.
      } else {
        throw new Error(`CSV 第 ${currentLine} 行引號後包含無效字元`);
      }
      continue;
    }
    if (char === '"') {
      if (cell.length > 0) throw new Error(`CSV 第 ${currentLine} 行引號位置無效`);
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push({ sourceRowNumber: rowStartLine, values: row });
      row = [];
      cell = "";
      currentLine += 1;
      rowStartLine = currentLine;
    } else if (char === "\r" && text[index + 1] !== "\n") {
      throw new Error(`CSV 第 ${currentLine} 行換行格式無效`);
    } else cell += char;
  }
  if (quoted) throw new Error("CSV 引號未閉合");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push({ sourceRowNumber: rowStartLine, values: row });
  }
  return rows;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      throw new Error("名單不可包含公式");
    }
    if ("hyperlink" in value) return String(value.text ?? "");
    if ("richText" in value) {
      return value.richText.map((part) => part.text).join("");
    }
    if (value instanceof Date) return value.toISOString();
    throw new Error("名單包含不支援的儲存格類型");
  }
  return String(value);
}

function recordsFromRows(rows: ParsedRosterRow[]): RosterCellRow[] {
  const nonempty = rows.filter((row) => row.values.some((cell) => cell.trim()));
  if (nonempty.length < 1) throw new Error("名單必須包含標題");
  const headers = nonempty[0].values.map((header) =>
    header.replace(/^\uFEFF/, "").normalize("NFKC").trim(),
  );
  if (headers.length > MAX_ROSTER_COLUMNS) throw new Error("名單欄位過多");
  if (headers.some((header) => !header)) throw new Error("名單標題不可留空");
  if (new Set(headers).size !== headers.length) throw new Error("名單標題不可重複");
  if (nonempty.length - 1 > MAX_ROSTER_ROWS) throw new Error("名單最多 500 行");
  return nonempty.slice(1).map((row) => {
    if (row.values.length > headers.length) {
      throw new Error(
        `CSV 第 ${row.sourceRowNumber} 行欄位數不符：預期 ${headers.length} 欄，實際 ${row.values.length} 欄`,
      );
    }
    const record = Object.fromEntries(
      headers.map((header, index) => {
        const value = (row.values[index] ?? "").normalize("NFKC").trim();
        if (value.length > MAX_ROSTER_CELL_LENGTH) {
          throw new Error(`欄位 ${header} 內容過長`);
        }
        return [header, value];
      }),
    ) as RosterCellRow;
    Object.defineProperty(record, SOURCE_ROW_NUMBER, {
      configurable: false,
      enumerable: false,
      value: row.sourceRowNumber,
      writable: false,
    });
    return record;
  });
}

function uint16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) throw new Error("XLSX ZIP 結構不完整");
  return view.getUint16(offset, true);
}

function uint32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) throw new Error("XLSX ZIP 結構不完整");
  return view.getUint32(offset, true);
}

function decodeZipName(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("XLSX ZIP entry 名稱編碼無效");
  }
}

/**
 * ExcelJS materializes the whole ZIP. Inspect the central directory first so
 * declared resource limits are enforced before any entry is decompressed.
 */
export function preflightRosterXlsx(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdSignature = 0x06054b50;
  const minimumEocdSize = 22;
  const searchStart = Math.max(0, bytes.length - minimumEocdSize - 0xffff);
  let eocdOffset = -1;
  for (let offset = bytes.length - minimumEocdSize; offset >= searchStart; offset -= 1) {
    if (uint32(view, offset) !== eocdSignature) continue;
    const commentLength = uint16(view, offset + 20);
    if (offset + minimumEocdSize + commentLength === bytes.length) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("XLSX ZIP central directory 無效");
  if (eocdOffset >= 20 && uint32(view, eocdOffset - 20) === 0x07064b50) {
    throw new Error("XLSX 不支援 ZIP64");
  }
  const diskNumber = uint16(view, eocdOffset + 4);
  const directoryDisk = uint16(view, eocdOffset + 6);
  const diskEntries = uint16(view, eocdOffset + 8);
  const entryCount = uint16(view, eocdOffset + 10);
  const directorySize = uint32(view, eocdOffset + 12);
  const directoryOffset = uint32(view, eocdOffset + 16);
  if (
    diskNumber !== 0 || directoryDisk !== 0 || diskEntries !== entryCount ||
    entryCount === 0 || entryCount === 0xffff ||
    directorySize === 0xffffffff || directoryOffset === 0xffffffff
  ) {
    throw new Error("XLSX ZIP 分卷或 ZIP64 結構不受支援");
  }
  if (entryCount > MAX_ROSTER_ZIP_ENTRIES) throw new Error("XLSX ZIP entry 數量過多");
  const directoryEnd = directoryOffset + directorySize;
  if (directoryOffset < 0 || directoryEnd > eocdOffset || directoryEnd < directoryOffset) {
    throw new Error("XLSX ZIP central directory 範圍無效");
  }

  let cursor = directoryOffset;
  let totalUncompressed = 0;
  let totalActualUncompressed = 0;
  const names = new Set<string>();
  const localOffsets = new Set<number>();
  const ranges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (uint32(view, cursor) !== 0x02014b50) throw new Error("XLSX ZIP entry 結構無效");
    const versionNeeded = uint16(view, cursor + 6);
    const flags = uint16(view, cursor + 8);
    const method = uint16(view, cursor + 10);
    const compressedSize = uint32(view, cursor + 20);
    const uncompressedSize = uint32(view, cursor + 24);
    const nameLength = uint16(view, cursor + 28);
    const extraLength = uint16(view, cursor + 30);
    const commentLength = uint16(view, cursor + 32);
    const startDisk = uint16(view, cursor + 34);
    const localOffset = uint32(view, cursor + 42);
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > directoryEnd || versionNeeded >= 45 || startDisk !== 0) {
      throw new Error("XLSX ZIP64 或 entry 範圍無效");
    }
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) throw new Error("XLSX 不可包含加密 entry");
    if (method !== 0 && method !== 8) throw new Error("XLSX ZIP 壓縮方法不受支援");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error("XLSX 不支援 ZIP64 entry");
    }
    if (uncompressedSize > MAX_ROSTER_ZIP_ENTRY_BYTES) throw new Error("XLSX 單一 ZIP entry 解壓後過大");
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_ROSTER_INFLATED_BYTES) throw new Error("XLSX 解壓後資料過大");
    if (uncompressedSize > 0) {
      if (compressedSize === 0 || uncompressedSize / compressedSize > MAX_ROSTER_ZIP_COMPRESSION_RATIO) {
        throw new Error("XLSX ZIP 壓縮比例異常");
      }
    }

    const name = decodeZipName(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (
      !name || name.includes("\0") || name.includes("\\") || name.startsWith("/") ||
      name.split("/").some((part) => part === "..") || names.has(name)
    ) {
      throw new Error("XLSX ZIP entry 名稱無效或重複");
    }
    names.add(name);
    if (localOffsets.has(localOffset) || localOffset >= directoryOffset || uint32(view, localOffset) !== 0x04034b50) {
      throw new Error("XLSX ZIP local entry 無效或重疊");
    }
    localOffsets.add(localOffset);
    const localNameLength = uint16(view, localOffset + 26);
    const localExtraLength = uint16(view, localOffset + 28);
    const localNameStart = localOffset + 30;
    const dataStart = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (
      dataStart > directoryOffset || dataEnd > directoryOffset || dataEnd < dataStart ||
      decodeZipName(bytes.subarray(localNameStart, localNameStart + localNameLength)) !== name
    ) {
      throw new Error("XLSX ZIP local entry 範圍或名稱不一致");
    }
    const remainingOutputLimit = Math.min(
      MAX_ROSTER_ZIP_ENTRY_BYTES,
      MAX_ROSTER_INFLATED_BYTES - totalActualUncompressed,
    );
    let actualUncompressedSize: number;
    if (method === 0) {
      actualUncompressedSize = compressedSize;
    } else {
      try {
        actualUncompressedSize = inflateRawSync(
          bytes.subarray(dataStart, dataEnd),
          { maxOutputLength: Math.max(1, remainingOutputLimit) },
        ).byteLength;
      } catch {
        throw new Error("XLSX ZIP entry 解壓失敗或實際大小超限");
      }
    }
    if (actualUncompressedSize !== uncompressedSize) {
      throw new Error("XLSX ZIP entry 宣告大小與實際內容不一致");
    }
    totalActualUncompressed += actualUncompressedSize;
    if (totalActualUncompressed > MAX_ROSTER_INFLATED_BYTES) {
      throw new Error("XLSX 解壓後資料過大");
    }
    if (
      actualUncompressedSize > 0 &&
      (compressedSize === 0 ||
        actualUncompressedSize / compressedSize > MAX_ROSTER_ZIP_COMPRESSION_RATIO)
    ) {
      throw new Error("XLSX ZIP 壓縮比例異常");
    }
    ranges.push({ start: localOffset, end: dataEnd });
    cursor = entryEnd;
  }
  if (cursor !== directoryEnd) throw new Error("XLSX ZIP central directory 尾端無效");
  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) throw new Error("XLSX ZIP entry 範圍重疊");
  }
}

export async function parseRosterFile(
  bytes: Uint8Array,
  format: RosterFileFormat,
): Promise<RosterCellRow[]> {
  if (!bytes.length) throw new Error("檔案是空的");
  if (bytes.length > MAX_ROSTER_FILE_BYTES) throw new Error("檔案不可超過 4 MiB");
  if (format === "CSV") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return recordsFromRows(parseCsvRows(text.replace(/^\uFEFF/u, "")));
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("XLSX 檔案格式無效");
  }
  preflightRosterXlsx(bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  if (Reflect.get(workbook, "vbaProject") || Reflect.get(workbook, "_externalLinks")) {
    throw new Error("XLSX 不可包含巨集或外部連結");
  }
  const visibleSheets = workbook.worksheets.filter(
    (worksheet) => worksheet.state !== "hidden" && worksheet.state !== "veryHidden",
  );
  if (visibleSheets.length !== 1 || visibleSheets[0].name.trim().toLowerCase() !== "data") {
    throw new Error("XLSX 必須有一個可見的資料工作表");
  }
  const sheet = visibleSheets[0];
  if (sheet.actualRowCount > MAX_ROSTER_ROWS + 1) throw new Error("名單最多 500 行");
  if (sheet.actualColumnCount > MAX_ROSTER_COLUMNS) throw new Error("名單欄位過多");
  const rows: ParsedRosterRow[] = [];
  let inflatedBytes = 0;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    for (let index = 1; index <= sheet.actualColumnCount; index += 1) {
      const value = row.getCell(index).value;
      if (typeof value === "number" && rows.length > 0) {
        const header = rows[0]?.values[index - 1]?.trim().toLowerCase();
        // 簡體項目是舊名單輸入 alias，不會用作介面文案。
        if (["accountname", "account", "账号", "帳號", "學生證", "学生证"].includes(header)) {
          throw new Error("學生證號／帳號儲存格必須設為文字格式");
        }
      }
      const text = cellText(value);
      inflatedBytes += Buffer.byteLength(text, "utf8");
      if (inflatedBytes > MAX_ROSTER_INFLATED_BYTES) {
        throw new Error("XLSX 解壓後資料過大");
      }
      values.push(text);
    }
    rows.push({ sourceRowNumber: row.number, values });
  });
  return recordsFromRows(rows);
}
