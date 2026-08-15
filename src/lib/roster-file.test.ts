import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseRosterFile } from "./roster-file";

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
    /标题不可重复/u,
  );
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
    /可见的资料工作表/u,
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

test("XLSX roster rejects numeric student identifiers", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("data");
  sheet.addRow(["accountName", "legalName"]);
  sheet.addRow([1234, "陳同學"]);
  const buffer = await workbook.xlsx.writeBuffer();
  await assert.rejects(
    parseRosterFile(new Uint8Array(buffer), "XLSX"),
    /学生证号／账号储存格必须设为文字格式/u,
  );
});

test("roster parser rejects files over the 5 MiB upload limit", async () => {
  await assert.rejects(
    parseRosterFile(new Uint8Array(5 * 1024 * 1024 + 1), "CSV"),
    /档案不可超过 5 MiB/u,
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
