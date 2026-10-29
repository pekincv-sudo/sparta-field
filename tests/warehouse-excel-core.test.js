"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

function runTests(directory = path.resolve(__dirname, "..")) {
  const core = require(path.join(directory, "warehouse-core.js"));
  const excel = require(path.join(directory, "warehouse-excel-core.js")).create(core);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const context = { exportId: "b7b8b478-59be-4fc4-87d9-c2af6d459420", exportedAt: "2026-10-29T08:30:00.000Z", scope: { mode: "company", companyId: "company-a" } };
  const options = { scope: clone(context.scope), batchHash: "a".repeat(64), date: "2026-10-29" };
  const item = (overrides = {}) => ({ id: "panel", name: "Панель 550 Вт", sku: "PV-550", category: "Фотомодулі", brand: "Brand", model: "M550", unit: "шт", currency: "USD", qty: 10, retailPrice: 200, salePrice: 200, installerPrice: 190, wholesalePrice: 180, minQty: 2, location: "Стелаж 1", purchasePrice: 100, deliveryCost: 5, extraCost: 1, ...overrides });
  const state = (overrides = {}) => ({ items: [item(), item({ id: "cable", name: "Кабель", sku: "CBL", unit: "м", currency: "UAH", qty: 30, category: "Кабелі" })], movements: [], documents: [], reservations: [], orderReservations: [], projects: [], ...overrides });
  const fixture = (overrides = {}) => { const before = state(overrides), manifest = excel.snapshot(before, context); return { before, manifest, rows: clone(manifest.rows) }; };
  const apply = (f, rows = f.rows, current = f.before, opts = options) => excel.prepare(f.manifest, rows, current, opts);
  const newRow = (overrides = {}) => ({ id: "", name: "Новий інвертор", sku: "NEW", category: "Інвертори", brand: "New", model: "X", unit: "шт", currency: "USD", qty: 3, retailPrice: 500, installerPrice: 490, wholesalePrice: 480, minQty: 1, location: "Склад Б", ...overrides });
  const checks = [];
  const check = (name, fn) => { fn(); checks.push(name); };

  check("snapshot excludes services, exposes only editable projection and owns its scope/rows", () => {
    const f = fixture({ items: [item({ privateCost: { value: 45 } }), item({ id: "service", category: "Роботи" })] });
    assert.equal(f.manifest.format, "sparta-warehouse-excel");
    assert.equal(f.manifest.version, 1);
    assert.equal(f.manifest.rows.length, 1);
    assert.deepEqual(Object.keys(f.manifest.rows[0]).sort(), [...excel.fields].sort());
    assert.equal(f.manifest.rows[0].purchasePrice, undefined);
    f.manifest.scope.companyId = "modified";
    f.manifest.rows[0].name = "modified";
    assert.equal(context.scope.companyId, "company-a");
    assert.equal(f.before.items[0].name, "Панель 550 Вт");
  });
  check("unchanged export/import creates no documents and preserves state identity", () => {
    const f = fixture(), saved = clone(f.before), result = apply(f);
    assert.equal(result.state, f.before);
    assert.deepEqual(result.summary.documentIds, []);
    assert.equal(result.summary.unchangedItems, 2);
    assert.equal(result.alreadyApplied, false);
    assert.deepEqual(f.before, saved);
  });
  check("metadata, all sales tiers and quantity update with one audit document and original costs", () => {
    const historic = { id: "old", documentId: "old-doc", itemId: "panel", qty: 2, unitCost: 41, attachment: { id: "keep" } };
    const f = fixture({ movements: [historic], documents: [{ id: "old-doc", status: "posted", lines: [{ unitCost: 41 }] }], projects: [{ id: "p", materials: [{ warehouseItemId: "panel", issuedQty: 2, costPrice: 41 }] }] });
    f.before.items[0].custom = { nested: [1, { note: "keep" }] };
    const saved = clone(f.before);
    Object.assign(f.rows[0], { sku: "NEW-PV", name: "Нова панель", brand: "Next", model: "N", category: "Панелі", location: "Б", minQty: 4, qty: 14, retailPrice: 250, installerPrice: 240, wholesalePrice: 230, purchasePrice: 999999, deliveryCost: 999999 });
    const result = apply(f), updated = result.state.items.find((entry) => entry.id === "panel");
    assert.equal(updated.qty, 14);
    for (const field of ["sku", "name", "brand", "model", "category", "location", "minQty", "retailPrice", "installerPrice", "wholesalePrice"]) assert.equal(updated[field], f.rows[0][field]);
    assert.equal(updated.salePrice, 250);
    for (const field of ["purchasePrice", "deliveryCost", "extraCost"]) assert.equal(updated[field], saved.items[0][field]);
    assert.deepEqual(updated.custom, saved.items[0].custom);
    assert.deepEqual(result.state.projects, saved.projects);
    assert.deepEqual(result.state.movements.find((entry) => entry.id === "old"), saved.movements[0]);
    assert.equal(result.state.movements[0].unitCost, 106);
    assert.equal(result.state.movements[0].delta, 4);
    assert.equal(result.summary.updatedItems, 1);
    assert.equal(result.summary.quantityChanges, 1);
    assert.equal(result.summary.metadataChanges, 1);
    assert.equal(result.summary.priceChanges, 1);
    const doc = result.state.documents.find((entry) => entry.id === result.summary.documentIds[0]);
    assert.equal(doc.type, "stocktake");
    assert.equal(doc.roundtripChanges[0].before.retailPrice, 200);
    assert.equal(doc.roundtripChanges[0].after.retailPrice, 250);
    assert.deepEqual(f.before, saved);
  });
  check("price-only and metadata-only changes receive zero-delta stocktake audit lines", () => {
    const f = fixture();
    f.rows[0].retailPrice = 201;
    f.rows[1].location = "Нове місце";
    const result = apply(f);
    assert.equal(result.state.documents.length, 2);
    assert.equal(result.state.movements.length, 0);
    assert.ok(result.state.documents.every((doc) => doc.lines.length === 1 && doc.lines[0].delta === 0));
    assert.deepEqual(result.summary.documentIds, ["excel-" + options.batchHash + "-USD", "excel-" + options.batchHash + "-UAH"]);
    assert.deepEqual(result.summary.currencies, { USD: { changedItems: 1, quantityDelta: 0 }, UAH: { changedItems: 1, quantityDelta: 0 } });
  });
  check("new rows have deterministic IDs, unknown purchase costs and stocktake quantities including zero", () => {
    const f = fixture();
    f.rows.push(newRow({ purchasePrice: 777, serialTracking: true, custom: "ignored" }), newRow({ name: "Новий кабель", sku: "NEW-C", currency: "UAH", unit: "м", qty: 0, minQty: 0 }));
    const result = apply(f), added = result.state.items.find((entry) => entry.sku === "NEW");
    assert.equal(added.id, "excel-item-" + options.batchHash + "-3");
    assert.equal(added.qty, 3);
    assert.equal(added.purchasePrice, 0);
    assert.equal(added.deliveryCost, 0);
    assert.equal(added.extraCost, 0);
    assert.equal(added.purchasePriceKnown, false);
    assert.equal(added.serialTracking, undefined);
    assert.equal(added.custom, undefined);
    assert.equal(result.summary.newItems, 2);
    assert.equal(result.state.documents.length, 2);
    assert.ok(result.state.documents.every((doc) => doc.valuationIncomplete));
    assert.equal(result.state.items.find((entry) => entry.sku === "NEW-C").qty, 0);
  });
  check("deleting workbook rows never deletes catalog entries or creates documents", () => {
    const f = fixture(), result = apply(f, []);
    assert.equal(result.state, f.before);
    assert.equal(result.state.items.length, 2);
    assert.equal(result.summary.deletedRowsIgnored, 2);
  });
  check("existing ID is mandatory; unknown IDs, repeated IDs and duplicate SKU are atomic failures", () => {
    const f = fixture(), saved = clone(f.before);
    const unknown = clone(f.rows); unknown[0].id = "forged";
    assert.throws(() => apply(f, unknown), /ідентифікатор/);
    assert.throws(() => apply(f, f.rows.concat([f.rows[0]])), /повторюється/);
    const blankId = clone(f.rows); blankId[0].id = "";
    assert.throws(() => apply(f, blankId), /початковий ID/);
    const duplicateSku = clone(f.rows); duplicateSku[0].sku = " cbl ";
    assert.throws(() => apply(f, duplicateSku), /артикул/);
    assert.throws(() => apply(f, f.rows.concat([newRow(), newRow({ name: "Інше", sku: "new" })])), /збігається/);
    assert.throws(() => apply(f, f.rows.concat([newRow({ name: "  Панель 550 Вт ", sku: "UNIQUE" })])), /початковий ID/);
    assert.deepEqual(f.before, saved);
  });
  check("unit and currency changes are rejected even at zero stock", () => {
    const f = fixture({ items: [item({ qty: 0 })] });
    for (const patch of [{ unit: "м" }, { currency: "UAH" }, { unit: "" }, { currency: "" }]) assert.throws(() => apply(f, [{ ...f.rows[0], ...patch }]), /валют|одиниц|текст/);
  });
  check("quantity precision, units, zero, numeric blanks and decimal commas are deliberate", () => {
    const f = fixture();
    f.rows[0].qty = 0;
    f.rows[0].retailPrice = "";
    f.rows[0].installerPrice = null;
    f.rows[0].wholesalePrice = " ";
    f.rows[0].minQty = "";
    f.rows[1].qty = "30,125";
    const result = apply(f);
    assert.equal(result.state.items[0].qty, 0);
    assert.equal(result.state.items[0].retailPrice, 200);
    assert.equal(result.state.items[0].installerPrice, 190);
    assert.equal(result.state.items[0].wholesalePrice, 180);
    assert.equal(result.state.items[0].minQty, 2);
    assert.equal(result.state.items[1].qty, 30.125);
    assert.throws(() => apply(f, [{ ...f.rows[0], qty: 0.5 }, f.rows[1]]), /ціла/);
    assert.throws(() => apply(f, [f.rows[0], { ...f.rows[1], qty: 30.0001 }]), /трьох/);
  });
  check("malformed types and nonfinite, negative, oversized numeric values never mutate state", () => {
    const f = fixture(), saved = clone(f.before);
    for (const field of ["qty", "minQty", "retailPrice", "installerPrice", "wholesalePrice"]) {
      for (const value of [true, {}, [], Infinity, NaN, -1, Number.MAX_SAFE_INTEGER, "1e999", "=1+2"]) assert.throws(() => apply(f, [{ ...f.rows[0], [field]: value }, f.rows[1]]));
    }
    for (const field of ["id", "name", "brand", "model", "category", "sku", "location", "unit", "currency"]) assert.throws(() => apply(f, [{ ...f.rows[0], [field]: {} }, f.rows[1]]));
    const missingField = clone(f.rows); delete missingField[0].retailPrice;
    assert.throws(() => apply(f, missingField), /стовпці/);
    assert.deepEqual(f.before, saved);
  });
  check("formula-like text remains inert literal metadata", () => {
    const f = fixture();
    Object.assign(f.rows[0], { sku: "=HYPERLINK(test)", name: "+SUM(A1)", model: "@value", location: "-literal" });
    const result = apply(f);
    assert.equal(result.state.items[0].sku, "=HYPERLINK(test)");
    assert.equal(result.state.items[0].name, "+SUM(A1)");
    assert.equal(result.state.items[0].model, "@value");
  });
  check("stale edited rows reject whole batch including unrelated valid new goods", () => {
    const f = fixture(), current = clone(f.before);
    f.rows[0].retailPrice = 250;
    f.rows.push(newRow());
    current.items[0].qty = 9;
    const saved = clone(current);
    assert.throws(() => apply(f, f.rows, current), /після експорту/);
    assert.deepEqual(current, saved);
    current.items[0].qty = 10;
    current.items[0].brand = "Concurrent";
    assert.throws(() => apply(f, f.rows, current), /після експорту/);
  });
  check("untouched stale rows are ignored; an edited row already at target is unchanged", () => {
    const f = fixture(), current = clone(f.before);
    current.items[0].qty = 8;
    current.items[1].location = "Already";
    f.rows[1].location = "Already";
    const result = apply(f, f.rows, current);
    assert.equal(result.state, current);
    assert.equal(result.summary.unchangedItems, 2);
    assert.equal(result.state.items[0].qty, 8);
  });
  check("combined project and buyer holds protect inventory; equality is valid", () => {
    const f = fixture({ reservations: [{ id: "p", itemId: "panel", projectId: "project", qty: 3 }], orderReservations: [{ id: "o", itemId: "panel", qty: 4 }] });
    f.rows[0].qty = 6;
    assert.throws(() => apply(f), /резерв/);
    f.rows[0].qty = 7;
    const result = apply(f);
    assert.equal(result.state.items[0].qty, 7);
    assert.deepEqual(result.state.reservations, f.before.reservations);
    assert.deepEqual(result.state.orderReservations, f.before.orderReservations);
  });
  check("serial quantities require serial documents while price-only edits remain auditable", () => {
    for (const serial of [{ serialTracking: true }, { serialNumbers: ["SN-1"] }, { serialNumber: "SN-legacy" }]) {
      const f = fixture({ items: [item(serial)] });
      f.rows[0].qty = 9;
      assert.throws(() => apply(f), /серійн/);
      f.rows[0].qty = 10;
      f.rows[0].retailPrice = 230;
      assert.equal(apply(f).state.documents[0].lines[0].delta, 0);
    }
  });
  check("reimport is an idempotent no-op after subsequent stock moves and metadata changes", () => {
    const f = fixture();
    f.rows[0].qty = 12;
    f.rows.push(newRow());
    const applied = apply(f);
    const moved = core.postStocktake(applied.state, { id: "later-stocktake", date: "2026-10-29", currency: "USD", reason: "Пізніша інвентаризація", lines: [{ itemId: "panel", countedQty: 5 }] });
    const current = { ...applied.state, ...moved };
    current.items.find((entry) => entry.id === "panel").retailPrice = 999;
    const saved = clone(current), replay = apply(f, f.rows, current);
    assert.equal(replay.alreadyApplied, true);
    assert.equal(replay.state, current);
    assert.deepEqual(replay.summary, applied.summary);
    assert.deepEqual(current, saved);
    assert.equal(current.items.find((entry) => entry.id === "panel").qty, 5);
    replay.summary.rows[0].name = "mutated summary";
    assert.notEqual(current.documents.find((doc) => doc.excelBatchHash).excelSummary.rows[0].name, "mutated summary");
  });
  check("partial import documents, missing audit documents and hash collisions cannot replay", () => {
    const f = fixture();
    f.rows[0].qty = 12;
    f.rows[1].qty = 32;
    const result = apply(f);
    const partial = clone(result.state); partial.documents.pop();
    assert.throws(() => apply(f, f.rows, partial), /неповний/);
    const missingDocs = clone(result.state); missingDocs.documents = [];
    assert.throws(() => apply(f, f.rows, missingDocs), /неповний/);
    const collision = clone(f.before); collision.documents = [{ id: "excel-" + options.batchHash + "-USD", status: "posted" }];
    assert.throws(() => apply(f, f.rows, collision), /інший або неповний/);
  });
  check("scope, date, UUID, manifest versions and batch hashes are validated", () => {
    const f = fixture();
    assert.throws(() => apply(f, f.rows, f.before, { ...options, scope: { mode: "company", companyId: "company-b" } }), /іншій компанії/);
    for (const date of ["2026-02-30", "29-10-2026", "2026-10-29T00:00:00Z"]) assert.throws(() => apply(f, f.rows, f.before, { ...options, date }), /дату/);
    assert.throws(() => apply(f, f.rows, f.before, { ...options, batchHash: "bad" }), /сум/);
    assert.throws(() => excel.prepare({ ...f.manifest, version: 2 }, f.rows, f.before, options), /підтримуваний/);
    assert.throws(() => excel.snapshot(f.before, { ...context, exportId: "bad" }), /ідентифікатор/);
  });
  check("return state, summaries, document audits, reservations and nested metadata are isolated", () => {
    const f = fixture({ reservations: [{ itemId: "cable", projectId: "p", qty: 2, nested: { keep: true } }], projects: [{ id: "p", materials: [] }] });
    f.before.items[0].nested = { keep: [1, 2] };
    f.rows[0].name = "Оновлена панель";
    const saved = clone(f.before), result = apply(f);
    result.state.items[0].nested.keep.push(3);
    result.state.reservations[0].nested.keep = false;
    result.state.projects[0].materials.push({ id: "mutated" });
    result.summary.rows[0].name = "summary mutated";
    result.state.documents[0].roundtripChanges[0].before.name = "audit mutated";
    assert.deepEqual(f.before, saved);
    assert.notEqual(result.state.documents[0].excelSummary.rows[0].name, "summary mutated");
    assert.equal(f.manifest.rows[0].name, "Панель 550 Вт");
  });
  return checks;
}

module.exports = runTests;
if (require.main === module) console.log("Warehouse Excel core: " + runTests().length + " checks passed");
