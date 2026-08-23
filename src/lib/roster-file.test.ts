import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  MAX_ROSTER_ZIP_ENTRY_BYTES,
  parseRosterFile,
  rosterSourceRowNumber,
} from "./roster-file";

function centralEntryOffset(bytes: Uint8Array, expectedName?: string): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!expectedName || name === expectedName) return offset;
  }
  return -1;
}

test("CSV roster preserves a leading-zero student account", async () => {
  const rows = await parseRosterFile(
    new TextEncoder().encode(
      "accountName,legalName,nickname,grade,classCode\r\n001234,陳大文,星空學人,初一,甲",
    ),
    "CSV",
  );
  assert.equal(rows[0].accountName, "001234");
  assert.equal(rows[0].legalName, "陳大文");
});

test("CSV parser handles quotes and rejects duplicate headers", async () => {
  const rows = await parseRosterFile(
    new TextEncoder().encode('accountName,legalName\n"001,2","陳,同學"'),
    "CSV",
  );
  assert.equal(rows[0].accountName, "001,2");
  await assert.rejects(
    parseRosterFile(
      new TextEncoder().encode("accountName,accountName\n001,002"),
      "CSV",
    ),
    /標題不可重複/u,
  );
});

test("CSV parser rejects malformed quote placement without rewriting identifiers", async () => {
  for (const csv of [
    'accountName,legalName\n"student-01"junk,陳同學',
    'accountName,legalName\nstudent"-01,陳同學',
  ]) {
    await assert.rejects(
      parseRosterFile(new TextEncoder().encode(csv), "CSV"),
      /引號/u,
    );
  }

  const rows = await parseRosterFile(
    new TextEncoder().encode(
      '\uFEFF"accountName","legalName"\r\n"student-01","陳\r\n同學"',
    ),
    "CSV",
  );
  assert.equal(rows[0].accountName, "student-01");
  assert.equal(rows[0].legalName, "陳\r\n同學");
});

test("CSV parser rejects surplus columns instead of silently discarding them", async () => {
  await assert.rejects(
    parseRosterFile(
      new TextEncoder().encode(
        "accountName,legalName,nickname,grade\nstudent-01,陳大文,小明,初一,甲",
      ),
      "CSV",
    ),
    /第 2 行欄位數不符：預期 4 欄，實際 5 欄/u,
  );
});

test("CSV parser permits omitted trailing fields and preserves physical source rows", async () => {
  const rows = await parseRosterFile(
    new TextEncoder().encode(
      'accountName,legalName,nickname,grade,classCode\n\nstudent-01,"陳\n大文",小明,初一\nstudent-02,李小文,晨光,初一,乙',
    ),
    "CSV",
  );
  assert.equal(rows[0].classCode, "");
  assert.equal(rosterSourceRowNumber(rows[0]), 3);
  assert.equal(rosterSourceRowNumber(rows[1]), 5);
});

test("XLSX roster rejects formulas", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("data");
  sheet.addRow(["accountName", "legalName"]);
  sheet.addRow(["001234", { formula: 'HYPERLINK("https://example.com")' }]);
  const buffer = await workbook.xlsx.writeBuffer();
  await assert.rejects(
    parseRosterFile(new Uint8Array(buffer), "XLSX"),
    /不可包含公式/u,
  );
});

test("XLSX roster requires the canonical data worksheet", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Roster");
  sheet.addRow(["accountName", "legalName"]);
  sheet.addRow(["001234", "陳同學"]);
  const buffer = await workbook.xlsx.writeBuffer();
  await assert.rejects(
    parseRosterFile(new Uint8Array(buffer), "XLSX"),
    /可見的資料工作表/u,
  );
});

test("XLSX roster rejects an oversized declared ZIP entry before decompression", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("data");
  sheet.addRow(["accountName", "legalName"]);
  sheet.addRow(["001234", "陳同學"]);
  const original = new Uint8Array(await workbook.xlsx.writeBuffer());
  const bytes = original.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const centralEntry = centralEntryOffset(bytes);
  assert.notEqual(centralEntry, -1);
  view.setUint32(centralEntry + 24, MAX_ROSTER_ZIP_ENTRY_BYTES + 1, true);
  await assert.rejects(
    parseRosterFile(bytes, "XLSX"),
    /單一 ZIP entry 解壓後過大/u,
  );
});

test("XLSX roster verifies actual inflated bytes instead of trusting ZIP metadata", async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("data").addRows([
    ["accountName", "legalName"],
    ["001234", "陳同學"],
  ]);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer()).slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const centralEntry = centralEntryOffset(bytes);
  assert.notEqual(centralEntry, -1);
  const declaredSize = view.getUint32(centralEntry + 24, true);
  assert.ok(declaredSize > 1);
  view.setUint32(centralEntry + 24, declaredSize - 1, true);
  await assert.rejects(
    parseRosterFile(bytes, "XLSX"),
    /宣告大小與實際內容不一致/u,
  );
});

test("XLSX roster preflights hidden worksheet payloads and malformed directories", async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("data").addRows([
    ["accountName", "legalName"],
    ["001234", "陳同學"],
  ]);
  const hidden = workbook.addWorksheet("payload");
  hidden.state = "veryHidden";
  hidden.addRow(["hidden"]);
  const original = new Uint8Array(await workbook.xlsx.writeBuffer());

  const hiddenPayload = original.slice();
  const hiddenView = new DataView(
    hiddenPayload.buffer,
    hiddenPayload.byteOffset,
    hiddenPayload.byteLength,
  );
  const hiddenEntry = centralEntryOffset(hiddenPayload, "xl/worksheets/sheet2.xml");
  assert.notEqual(hiddenEntry, -1);
  hiddenView.setUint32(hiddenEntry + 24, MAX_ROSTER_ZIP_ENTRY_BYTES + 1, true);
  await assert.rejects(
    parseRosterFile(hiddenPayload, "XLSX"),
    /單一 ZIP entry 解壓後過大/u,
  );

  await assert.rejects(
    parseRosterFile(original.slice(0, -22), "XLSX"),
    /central directory 無效/u,
  );
});

test("CSV/XLSX header-only templates parse without creating an import row", async () => {
  assert.deepEqual(
    await parseRosterFile(new TextEncoder().encode("accountName,legalName\r\n"), "CSV"),
    [],
  );
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("data").addRow(["accountName", "legalName"]);
  const buffer = await workbook.xlsx.writeBuffer();
  assert.deepEqual(await parseRosterFile(new Uint8Array(buffer), "XLSX"), []);
});

test("roster parser rejects the 501st data row", async () => {
  const rows = ["accountName,legalName"];
  for (let index = 1; index <= 501; index += 1) {
    rows.push(`student-${index},同學${index}`);
  }
  await assert.rejects(
    parseRosterFile(new TextEncoder().encode(rows.join("\n")), "CSV"),
    /最多 500 行/u,
  );
});

test("XLSX roster accepts numeric student numbers but keeps account identifiers as text", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("data");
  sheet.addRow(["accountName", "studentNumber", "legalName"]);
  sheet.addRow(["student-1234", 1234, "陳同學"]);
  const buffer = await workbook.xlsx.writeBuffer();
  const rows = await parseRosterFile(new Uint8Array(buffer), "XLSX");
  assert.equal(rows[0].studentNumber, "1234");

  const badWorkbook = new ExcelJS.Workbook();
  const badSheet = badWorkbook.addWorksheet("data");
  badSheet.addRow(["accountName", "studentNumber", "legalName"]);
  badSheet.addRow([1234, 1234, "陳同學"]);
  const badBuffer = await badWorkbook.xlsx.writeBuffer();
  await assert.rejects(parseRosterFile(new Uint8Array(badBuffer), "XLSX"), /學生證號／帳號儲存格必須設為文字格式/u);
});

test("roster parser rejects files over the 4 MiB Vercel-safe upload limit", async () => {
  await assert.rejects(
    parseRosterFile(new Uint8Array(4 * 1024 * 1024 + 1), "CSV"),
    /檔案不可超過 4 MiB/u,
  );
});

test("CSV and XLSX parser accept the 1, 200 and 500 row boundaries", async () => {
  for (const count of [1, 200, 500]) {
    const csv = ["accountName,legalName", ...Array.from({ length: count }, (_, index) => `student-${count}-${index},同學${index}`)].join("\n");
    const parsedCsv = await parseRosterFile(new TextEncoder().encode(csv), "CSV");
    assert.equal(parsedCsv.length, count);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("data");
    sheet.addRow(["accountName", "legalName"]);
    for (let index = 0; index < count; index += 1) sheet.addRow([`student-${count}-${index}`, `同學${index}`]);
    const buffer = await workbook.xlsx.writeBuffer();
    const parsedXlsx = await parseRosterFile(new Uint8Array(buffer), "XLSX");
    assert.equal(parsedXlsx.length, count);
  }

  const oversizedWorkbook = new ExcelJS.Workbook();
  const oversizedSheet = oversizedWorkbook.addWorksheet("data");
  oversizedSheet.addRow(["accountName", "legalName"]);
  for (let index = 0; index < 501; index += 1) {
    oversizedSheet.addRow([`student-over-${index}`, `同學${index}`]);
  }
  const oversizedBuffer = await oversizedWorkbook.xlsx.writeBuffer();
  await assert.rejects(
    parseRosterFile(new Uint8Array(oversizedBuffer), "XLSX"),
    /最多 500 行/u,
  );
});
