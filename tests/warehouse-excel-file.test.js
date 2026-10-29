"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const zlib = require("node:zlib");
const ExcelFile = require("../warehouse-excel-file.js");

function loadSheetJS() {
  const candidates = [process.env.SPARTA_SHEETJS_PATH, "../vendor/xlsx.full.min.js", "../assets/vendor/xlsx.full.min.js", "../xlsx.full.min.js"].filter(Boolean);
  const found = candidates.map(function (candidate) { return path.isAbsolute(candidate) ? candidate : path.resolve(__dirname, candidate); }).find(function (candidate) { return fs.existsSync(candidate); });
  if (!found) throw new Error("SheetJS vendor is required for the real XLSX round-trip tests.");
  return require(found);
}

function runWarehouseExcelFileTests() {
  const XLSX = loadSheetJS();
  const codec = ExcelFile.create(XLSX);
  let checks = 0;
  function check(name, fn) { fn(); checks++; }
  function item(overrides) {
    return Object.assign({ id: "panel-1", sku: "000042", name: "Панель 450 Вт", category: "Фотомодулі", brand: "SPARTA", model: "P-450", unit: "шт", currency: "UAH", qty: 12, retailPrice: 200, installerPrice: 180.25, wholesalePrice: 170, minQty: 2, location: "Склад 1" }, overrides);
  }
  function manifest(overrides) {
    return Object.assign({ format: "sparta-warehouse-excel", version: 1, exportId: "excel-20261029-fixture", scope: "company:company-1", exportedAt: "2026-10-29T12:00:00.000Z", rows: [item(), item({ id: "cable-1", sku: "DC6", name: "Кабель 6 мм²", unit: "м", qty: 12.125, minQty: 1.5, currency: "USD" })] }, overrides);
  }
  function state() {
    return { items: [Object.assign(item(), { purchasePrice: 100, deliveryCost: 4, extraCost: 3, serialNumbers: ["SECRET-SERIAL"] })],
      reservations: [{ itemId: "panel-1", qty: 3, projectId: "PRIVATE-PROJECT" }], orderReservations: [{ itemId: "panel-1", qty: 2, orderId: "PRIVATE-ORDER" }],
      projects: [{ name: "PRIVATE-PROJECT" }], token: "PRIVATE-TOKEN", user: { email: "private@example.com" } };
  }
  function decode(bytes, options) { return XLSX.read(bytes, Object.assign({ type: "array", cellFormula: true, cellNF: true, cellStyles: true }, options)); }
  function encode(book) { return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx", compression: true, cellStyles: true })); }
  function edit(fn) { const book = decode(codec.write(manifest(), state())); fn(book); return encode(book); }
  function column(field) { return ExcelFile.columns.findIndex(function (entry) { return entry.field === field; }); }
  function cell(field, row) { return XLSX.utils.encode_cell({ c: column(field), r: row || 1 }); }

  check("real XLSX round trip preserves baseline, Unicode, numeric types and leading-zero SKU", function () {
    const original = manifest(), source = state(), before = JSON.stringify(source);
    const bytes = codec.write(original, source);
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(Buffer.from(bytes.subarray(0, 2)).toString(), "PK");
    assert.deepEqual(codec.read(bytes.buffer), { manifest: original, rows: original.rows });
    assert.equal(JSON.stringify(source), before);
  });
  check("workbook contains clear Ukrainian headers, numeric formats, filter and hidden metadata", function () {
    const book = decode(codec.write(manifest(), state()));
    assert.deepEqual(book.SheetNames, ["Залишки", "Інструкція", "_Sparta"]);
    assert.equal(book.Workbook.Sheets[2].Hidden, 1);
    assert.equal(book.Sheets["Залишки"]["!autofilter"].ref, "A1:R3");
    assert.ok(book.Sheets["Залишки"]["!cols"][2].wch >= 40);
    assert.equal(book.Sheets["Залишки"][cell("qty")].t, "n");
    assert.equal(book.Sheets["Залишки"][cell("qty")].z, "0.000");
    assert.equal(book.Sheets["Залишки"][cell("retailPrice")].z, "0.00");
    assert.equal(book.Sheets["Залишки"]["B2"].v, "000042");
    const guide = XLSX.utils.sheet_to_json(book.Sheets["Інструкція"], { header: 1 }).flat().join("\n");
    ["кінцева абсолютна", "не видаляє", "лише довідково", "локальний", "компанії", "Серійні"].forEach(function (text) { assert.ok(guide.includes(text), text); });
  });
  check("source state never leaks private project, account or serial data into workbook", function () {
    const input = manifest({ token: "PRIVATE-TOKEN", user: { email: "private@example.com" } });
    input.rows[0].serialNumbers = ["SECRET-SERIAL"];
    const book = decode(codec.write(input, state()));
    const data = JSON.stringify(book);
    ["PRIVATE-PROJECT", "PRIVATE-ORDER", "PRIVATE-TOKEN", "private@example.com", "SECRET-SERIAL"].forEach(function (secret) { assert.ok(!data.includes(secret), secret); });
    assert.equal(book.Sheets["Залишки"][cell("reserved")].v, 5);
    assert.equal(book.Sheets["Залишки"][cell("available")].v, 7);
    assert.equal(book.Sheets["Залишки"][cell("purchasePrice")].v, 100);
    assert.equal(book.Sheets["Залишки"][cell("unitCost")].v, 107);
  });
  check("ordinary edits and sorting return rows by immutable ID while keeping baseline unchanged", function () {
    const bytes = edit(function (book) {
      const sheet = book.Sheets["Залишки"];
      sheet[cell("qty")].v = 15;
      sheet[cell("name")].v = "Нова назва";
      for (let index = 0; index < ExcelFile.columns.length; index++) {
        const a = XLSX.utils.encode_cell({ c: index, r: 1 }), b = XLSX.utils.encode_cell({ c: index, r: 2 });
        const old = sheet[a]; sheet[a] = sheet[b]; sheet[b] = old;
      }
    });
    const result = codec.read(bytes);
    assert.equal(result.rows[0].id, "cable-1");
    assert.equal(result.rows[1].qty, 15);
    assert.equal(result.rows[1].name, "Нова назва");
    assert.equal(result.manifest.rows[0].qty, 12);
  });
  check("numeric blanks remain blank, zero stays numeric and report-only edits are ignored", function () {
    const result = codec.read(edit(function (book) {
      const sheet = book.Sheets["Залишки"];
      delete sheet[cell("qty")];
      sheet[cell("retailPrice")].v = 0;
      sheet[cell("purchasePrice")].v = 999999;
    }));
    assert.equal(result.rows[0].qty, "");
    assert.equal(result.rows[0].retailPrice, 0);
    assert.equal(Object.hasOwn(result.rows[0], "purchasePrice"), false);
  });
  check("removed data rows do not remove their baseline and trailing empty dimensions are ignored", function () {
    const result = codec.read(edit(function (book) {
      const sheet = book.Sheets["Залишки"];
      ExcelFile.columns.forEach(function (entry, index) { delete sheet[XLSX.utils.encode_cell({ c: index, r: 2 })]; });
      sheet["!ref"] = "A1:R1048576";
    }));
    assert.equal(result.rows.length, 1);
    assert.equal(result.manifest.rows.length, 2);
  });
  check("metadata is chunked below Excel cell character limit and round trips intact", function () {
    const rows = Array.from({ length: 150 }, function (_, index) { return item({ id: "item-" + index, name: "Обладнання " + index + " я".repeat(100) }); });
    const original = manifest({ rows: rows });
    const bytes = codec.write(original, {}), book = decode(bytes), metadata = book.Sheets._Sparta;
    assert.ok(metadata.A3.v > 1);
    for (let index = 0; index < metadata.A3.v; index++) assert.ok(metadata["A" + (index + 4)].v.length <= 30000);
    assert.deepEqual(codec.read(bytes).manifest, original);
  });
  check("missing and malformed metadata fail with a fresh-export instruction", function () {
    assert.throws(function () { codec.read(edit(function (book) { delete book.Sheets._Sparta; book.SheetNames = book.SheetNames.filter(function (name) { return name !== "_Sparta"; }); })); }, /_Sparta|метадан|SPARTA/);
    assert.throws(function () { codec.read(edit(function (book) { book.Sheets._Sparta.A4.v = "{invalid"; })); }, /метадан/);
    assert.throws(function () { codec.read(edit(function (book) { book.Sheets._Sparta.A3.v = 99; })); }, /метадан/);
  });
  check("changed, missing and extra headers are rejected", function () {
    assert.throws(function () { codec.read(edit(function (book) { book.Sheets["Залишки"].C1.v = "Новий заголовок"; })); }, /Заголовки/);
    assert.throws(function () { codec.read(edit(function (book) { delete book.Sheets["Залишки"].I1; })); }, /Заголовки/);
    assert.throws(function () { codec.read(edit(function (book) { book.Sheets["Залишки"].S1 = { t: "s", v: "Зайвий стовпець" }; book.Sheets["Залишки"]["!ref"] = "A1:S3"; })); }, /стовп|Заголовки/);
  });
  check("duplicate IDs fail while blank IDs pass through for validated new products", function () {
    assert.throws(function () { codec.read(edit(function (book) { book.Sheets["Залишки"].A3.v = "panel-1"; })); }, /Повторний ID/);
    const result = codec.read(edit(function (book) { delete book.Sheets["Залишки"].A2; }));
    assert.equal(result.rows[0].id, "");
  });
  check("formulas are rejected with cached numeric or string results and without cached values", function () {
    [{ t: "n", f: "1+1", v: 2 }, { t: "s", f: 'CONCAT("A","B")', v: "AB" }, { t: "n", f: "1+1" }].forEach(function (formula) {
      assert.throws(function () { codec.read(edit(function (book) { book.Sheets["Залишки"][cell("qty")] = formula; })); }, /Формули.*Замініть/);
    });
    assert.throws(function () { codec.read(edit(function (book) { XLSX.utils.sheet_set_array_formula(book.Sheets["Залишки"], "I2:I3", "ROW(I2:I3)"); })); }, /Формули/);
  });
  check("formula-like text remains an inert string during export and import", function () {
    const original = manifest({ rows: [item({ sku: "=0001", name: "=SUM(1,2)" })] });
    const bytes = codec.write(original, {}), sheet = decode(bytes).Sheets["Залишки"];
    assert.equal(sheet.C2.t, "s");
    assert.equal(sheet.C2.f, undefined);
    assert.equal(codec.read(bytes).rows[0].name, "=SUM(1,2)");
  });
  check("Excel errors, dates and merged cells fail explicitly", function () {
    assert.throws(function () { codec.read(edit(function (book) { book.Sheets["Залишки"].I2 = { t: "e", v: 7 }; })); }, /помилку/);
    assert.throws(function () { codec.read(edit(function (book) { book.Sheets["Залишки"].I2 = { t: "d", v: new Date("2026-10-29T00:00:00Z") }; })); }, /тип клітинки/);
    assert.throws(function () { codec.read(edit(function (book) { book.Sheets["Залишки"]["!merges"] = [{ s: { r: 1, c: 2 }, e: { r: 2, c: 2 } }]; })); }, /Об’єднані/);
  });
  check("legacy XLS, random ZIP, truncated input and over-5-MB input are rejected", function () {
    const book = decode(codec.write(manifest(), {}));
    const legacy = XLSX.write(book, { type: "array", bookType: "biff8" });
    assert.throws(function () { codec.read(legacy); }, /лише формат .xlsx/);
    assert.throws(function () { codec.read(XLSX.write(book, { type: "array", bookType: "ods" })); }, /лише формат .xlsx/);
    assert.throws(function () { codec.read(new Uint8Array(5 * 1024 * 1024 + 1)); }, /5 МБ/);
    const bytes = codec.write(manifest(), {});
    assert.throws(function () { codec.read(bytes.subarray(0, bytes.length - 10)); }, /Excel-файл|структура/);
    assert.throws(function () { codec.read("not a workbook"); }, /.xlsx/);
  });
  check("excess rows and columns are rejected even outside worksheet-declared range", function () {
    assert.throws(function () { codec.read(edit(function (book) { book.Sheets["Залишки"].A10002 = { t: "s", v: "extra" }; book.Sheets["Залишки"]["!ref"] = "A1:R10002"; })); }, /забагато/);
    assert.throws(function () { codec.read(edit(function (book) { book.Sheets["Залишки"].Z1 = { t: "s", v: "extra" }; book.Sheets["Залишки"]["!ref"] = "A1:Z3"; })); }, /25 стовпців/);
  });
  check("invalid metadata baseline or unavailable Excel engine fails on export", function () {
    assert.throws(function () { codec.write(manifest({ version: 2 }), {}); }, /метадан/);
    assert.throws(function () { codec.write(manifest({ rows: [item(), item()] }), {}); }, /повторні ID/);
    assert.throws(function () { ExcelFile.create(null); }, /Модуль Excel/);
  });

  // Inspect standard ZIP entries independently of SheetJS, without private library APIs.
  function entries(bytes) {
    const buffer = Buffer.from(bytes), output = [];
    let end = buffer.length - 22;
    while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
    let at = buffer.readUInt32LE(end + 16);
    const count = buffer.readUInt16LE(end + 10);
    for (let index = 0; index < count; index++) {
      const length = buffer.readUInt16LE(at + 28), extra = buffer.readUInt16LE(at + 30), comment = buffer.readUInt16LE(at + 32);
      const name = buffer.subarray(at + 46, at + 46 + length).toString();
      const offset = buffer.readUInt32LE(at + 42), size = buffer.readUInt32LE(at + 20), method = buffer.readUInt16LE(at + 10);
      const dataAt = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
      const compressed = buffer.subarray(dataAt, dataAt + size);
      output.push({ name: name, data: method === 8 ? zlib.inflateRawSync(compressed) : compressed, directoryAt: at });
      at += 46 + length + extra + comment;
    }
    return output;
  }
  check("macro containers and declared ZIP expansion bombs are rejected before parsing", function () {
    const book = decode(codec.write(manifest(), {}));
    book.vbaraw = new Uint8Array([1, 2, 3]);
    const macro = XLSX.write(book, { type: "array", bookType: "xlsm" });
    assert.throws(function () { codec.read(macro); }, /макросами|структура/);
    const bytes = Buffer.from(codec.write(manifest(), {}));
    bytes.writeUInt32LE(ExcelFile.limits.expandedBytes + 1, entries(bytes)[0].directoryAt + 24);
    assert.throws(function () { codec.read(bytes); }, /Розпакований.*завеликий/);
  });
  check("external-workbook links are rejected before workbook parsing", function () {
    const bytes = Buffer.from(codec.write(manifest(), {}));
    const from = Buffer.from("xl/worksheets/sheet1.xml"), to = Buffer.from("xl/externalLinks/xxx.xml");
    assert.equal(from.length, to.length);
    let position = bytes.indexOf(from);
    while (position >= 0) { to.copy(bytes, position); position = bytes.indexOf(from, position + from.length); }
    assert.throws(function () { codec.read(bytes); }, /зовнішніми зв’язками/);
  });
  check("local exports remain scoped locally with report-only unknown costs blank", function () {
    const source = state(); source.items[0].purchasePriceKnown = false;
    const bytes = codec.write(manifest({ scope: "local" }), source), sheet = decode(bytes).Sheets["Залишки"];
    assert.equal(codec.read(bytes).manifest.scope, "local");
    assert.equal(sheet[cell("purchasePrice")].v, "");
    assert.equal(sheet[cell("unitCost")].v, "");
  });
  check("export carries plain numeric cells and no accidental formula XML", function () {
    const worksheet = entries(codec.write(manifest(), state())).find(function (entry) { return entry.name === "xl/worksheets/sheet1.xml"; }).data.toString();
    assert.ok(worksheet.includes('<autoFilter ref="A1:R3"'));
    assert.ok(!worksheet.includes("<f>"));
  });
  check("real workbook edits apply through the warehouse core with a stocktake and preserved costs", function () {
    const core = require("../warehouse-excel-core.js").create(require("../warehouse-core.js"));
    const source = { items: [Object.assign(item(), { purchasePrice: 100, deliveryCost: 5, extraCost: 0 })], movements: [], documents: [], reservations: [], orderReservations: [] };
    const context = { exportId: "11111111-2222-4333-8444-555555555555", scope: "company:11111111-2222-4333-8444-555555555555", exportedAt: "2026-10-29T12:00:00.000Z" };
    const book = decode(codec.write(core.snapshot(source, context), source));
    book.Sheets["Залишки"][cell("qty")].v = 15;
    book.Sheets["Залишки"][cell("retailPrice")].v = 225;
    book.Sheets["Залишки"][cell("purchasePrice")].v = 999;
    const parsed = codec.read(encode(book));
    const result = core.prepare(parsed.manifest, parsed.rows, source, { scope: context.scope, batchHash: "a".repeat(64), date: "2026-10-29" });
    assert.equal(result.state.items[0].qty, 15);
    assert.equal(result.state.items[0].retailPrice, 225);
    assert.equal(result.state.items[0].purchasePrice, 100);
    assert.equal(result.state.documents.length, 1);
    assert.equal(result.state.documents[0].type, "stocktake");
    assert.equal(result.state.movements[0].delta, 3);
    assert.equal(source.items[0].qty, 12);
  });

  return checks;
}

if (require.main === module) console.log("warehouse-excel-file: " + runWarehouseExcelFileTests() + " checks passed");
module.exports = runWarehouseExcelFileTests;
