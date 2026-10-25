"use strict";

const assert = require("node:assert/strict");
const Warehouse = require("../warehouse-core.js");

function runWarehouseCoreTests() {
  let checks = 0;
  function check(name, fn) { fn(); checks += 1; }
  function item(overrides) { return Object.assign({ id: "panel", name: "Панель 450 Вт", category: "Панелі", unit: "шт", qty: 10, sku: "P-450", purchasePrice: 100, deliveryCost: 5, extraCost: 0, brand: "Deye", model: "P450" }, overrides); }
  function state(overrides) { return Object.assign({ items: [item(), item({ id: "cable", name: "Кабель 6 мм²", category: "Кабель", unit: "м", qty: 100, sku: "DC6", purchasePrice: 20, deliveryCost: 0 })], movements: [], documents: [] }, overrides); }
  function doc(overrides) { return Object.assign({ id: "receipt-1", number: "ПР-001", date: "2026-10-24", supplier: "Постачальник", location: "Основний склад", lines: [{ itemId: "panel", qty: 10, purchasePrice: 200, deliveryCost: 15 }] }, overrides); }

  check("quantity validates units and decimal precision", function () {
    assert.equal(Warehouse.quantity("2,125", "м"), 2.125);
    assert.equal(Warehouse.quantity(0, "шт", { allowZero: true }), 0);
    [0, -1, "", null, Infinity, "1e999"].forEach(function (value) { assert.throws(function () { Warehouse.quantity(value, "шт"); }); });
    assert.throws(function () { Warehouse.quantity(1.1, "компл"); });
    assert.throws(function () { Warehouse.quantity(1.0001, "м"); });
  });
  check("legacy aliases and custom categories remain discoverable", function () {
    assert.equal(Warehouse.groupFor({ category: "Фотомодулі" }), "panels");
    assert.equal(Warehouse.groupFor({ category: "Панелі" }), "panels");
    assert.equal(Warehouse.groupFor({ category: "Кабель" }), "cables");
    const custom = item({ category: "Датчики температури", name: "Новий датчик", sku: "T1" });
    assert.equal(Warehouse.groupFor(custom), "other");
    assert.deepEqual(Warehouse.filterItems([custom], { group: "other" }), [custom]);
    assert.equal(Warehouse.filterItems([custom], { query: "датчики T1" }).length, 1);
  });
  check("services and expenses are excluded from physical stock", function () {
    ["Роботи", "Витрати", "Послуги"].forEach(function (category) { assert.equal(Warehouse.isStockItem(item({ category: category })), false); });
    assert.equal(Warehouse.filterItems([item(), item({ category: "Роботи" })], {}).length, 1);
  });
  check("global search matches structured fields and all words", function () {
    const found = item({ serialNumbers: ["SN-123"], barcode: "482000123", characteristics: "Монокристал" });
    ["Deye P450", "450 Монокристал", "sn-123", "482000123"].forEach(function (query) { assert.equal(Warehouse.filterItems([found], { query: query }).length, 1); });
    assert.equal(Warehouse.filterItems([found], { brand: "DEYE", group: "panels" }).length, 1);
    assert.equal(Warehouse.filterItems([found], { query: "Deye невідомий" }).length, 0);
  });
  check("catalog saves preserve quantities and protect stored unit costs", function () {
    const before = [item()];
    const result = Warehouse.saveCatalog(before, { id: "panel", name: "Нова назва", qty: 1000, purchasePrice: 999, deliveryCost: 999 });
    assert.equal(result[0].qty, 10);
    assert.equal(result[0].purchasePrice, 100);
    assert.equal(result[0].deliveryCost, 5);
    assert.equal(before[0].name, "Панель 450 Вт");
    const created = Warehouse.saveCatalog(before, { id: "new", name: "Інвертор", category: "Інвертори", qty: 500, sku: "NEW" });
    assert.equal(created[0].qty, 0);
  });
  check("catalog rejects duplicate SKU and changing stocked units", function () {
    assert.throws(function () { Warehouse.saveCatalog([item()], { id: "new", name: "Інша панель", sku: " p-450 " }); });
    assert.throws(function () { Warehouse.saveCatalog([item()], { id: "panel", name: "Панель", unit: "м" }); });
    assert.throws(function () { Warehouse.saveCatalog([], { id: "new", name: "Монтаж", category: "Роботи" }); });
  });
  check("receipt calculates weighted unit costs and keeps historical issue snapshots", function () {
    const oldMove = { id: "old", type: "project", itemId: "panel", qty: 3, unitCost: 105 };
    const before = state({ movements: [oldMove] });
    const result = Warehouse.postReceipt(before, doc());
    assert.equal(result.items[0].qty, 20);
    assert.equal(result.items[0].purchasePrice, 150);
    assert.equal(result.items[0].deliveryCost, 10);
    assert.equal(Warehouse.unitCost(result.items[0]), 160);
    assert.equal(result.movements[0].unitCost, 215);
    assert.equal(result.movements[1].unitCost, 105);
    assert.equal(result.document.total, 2150);
    assert.equal(before.items[0].qty, 10);
    assert.equal(oldMove.unitCost, 105);
  });
  check("receipt validates every row atomically and rejects duplicate products", function () {
    const before = state();
    const snapshot = JSON.stringify(before);
    assert.throws(function () { Warehouse.postReceipt(before, doc({ lines: [{ itemId: "panel", qty: 5, purchasePrice: 100 }, { itemId: "missing", qty: 1, purchasePrice: 1 }] })); });
    assert.equal(JSON.stringify(before), snapshot);
    assert.throws(function () { Warehouse.postReceipt(before, doc({ lines: [{ itemId: "panel", qty: 5, purchasePrice: 100 }, { itemId: "panel", qty: 1, purchasePrice: 1 }] })); });
    assert.equal(JSON.stringify(before), snapshot);
  });
  check("receipt supports decimal meters but rejects invalid price or calendar date", function () {
    const result = Warehouse.postReceipt(state(), doc({ lines: [{ itemId: "cable", qty: "2,5", purchasePrice: "30,5" }] }));
    assert.equal(result.items[1].qty, 102.5);
    assert.throws(function () { Warehouse.postReceipt(state(), doc({ lines: [{ itemId: "panel", qty: 1, purchasePrice: -1 }] })); });
    assert.throws(function () { Warehouse.postReceipt(state(), doc({ date: "2026-02-30" })); });
  });
  check("posted documents cannot be applied twice; drafts are replaced on posting", function () {
    const result = Warehouse.postReceipt(state(), doc());
    assert.throws(function () { Warehouse.postReceipt(result, doc()); });
    assert.throws(function () { Warehouse.postReceipt(Object.assign({}, result, { documents: [] }), doc()); });
    const posted = Warehouse.postReceipt(state({ documents: [doc({ status: "draft" })] }), doc());
    assert.equal(posted.documents.length, 1);
    assert.equal(posted.document.status, "posted");
  });
  check("receipt serials and attachment snapshots do not retain mutable input references", function () {
    const before = state({ items: [item({ serialTracking: true, qty: 0 })] });
    const input = doc({ attachments: [{ name: "Накладна.pdf", meta: { size: 100 } }], lines: [{ itemId: "panel", qty: 2, purchasePrice: 100, serialNumbers: ["SN1", "SN2"] }] });
    const result = Warehouse.postReceipt(before, input);
    input.attachments[0].meta.size = 500;
    input.lines[0].serialNumbers[0] = "CHANGED";
    assert.deepEqual(result.items[0].serialNumbers, ["SN1", "SN2"]);
    assert.equal(result.document.attachments[0].meta.size, 100);
    assert.throws(function () { Warehouse.postReceipt(result, doc({ id: "receipt-2", lines: [{ itemId: "panel", qty: 1, purchasePrice: 10, serialNumbers: ["sn1"] }] })); });
    assert.throws(function () { Warehouse.postReceipt(before, doc({ lines: [{ itemId: "panel", qty: 2, purchasePrice: 10, serialNumbers: ["SN1"] }] })); });
  });
  check("stocktake records signed differences, cost snapshots and reason", function () {
    const before = state();
    const result = Warehouse.postStocktake(before, doc({ reason: "Фактичний перерахунок", lines: [{ itemId: "panel", countedQty: 8 }, { itemId: "cable", countedQty: 102.5 }] }));
    assert.equal(result.items[0].qty, 8);
    assert.equal(result.items[1].qty, 102.5);
    assert.equal(result.movements[0].type, "adjustment");
    assert.equal(result.movements[0].qty, -2);
    assert.equal(result.movements[0].delta, -2);
    assert.equal(result.movements[0].unitCost, 105);
    assert.equal(result.movements[1].delta, 2.5);
    assert.equal(before.items[0].qty, 10);
  });
  check("stocktake validates all rows and reason before changes", function () {
    const before = state();
    const snapshot = JSON.stringify(before);
    assert.throws(function () { Warehouse.postStocktake(before, doc({ lines: [{ itemId: "panel", countedQty: 0 }] })); });
    assert.throws(function () { Warehouse.postStocktake(before, doc({ reason: "Перерахунок", lines: [{ itemId: "panel", countedQty: 8 }, { itemId: "cable", countedQty: -1 }] })); });
    assert.equal(JSON.stringify(before), snapshot);
  });
  check("reservations reduce available stock but not physical quantities", function () {
    const before = { items: [item()], reservations: [] };
    const result = Warehouse.reserve(before, { id: "r1", projectId: "project1", itemId: "panel", qty: 6 });
    assert.equal(result.items[0].qty, 10);
    assert.equal(Warehouse.reservedQty(result.reservations, "panel"), 6);
    assert.equal(Warehouse.availableQty(result.items[0], result.reservations), 4);
    assert.equal(Warehouse.availableQty(result.items[0], result.reservations, "project1"), 10);
    assert.equal(Warehouse.availableQty(result.items[0], result.reservations, "other"), 4);
    assert.equal(before.reservations.length, 0);
    assert.throws(function () { Warehouse.reserve(result, { id: "r2", projectId: "project2", itemId: "panel", qty: 5 }); });
    assert.throws(function () { Warehouse.reserve(result, { id: "r1", projectId: "project1", itemId: "panel", qty: 1 }); });
  });
  check("reservation fulfilment is partial, FIFO and isolated to the right project", function () {
    const reservations = [{ id: "r1", projectId: "p1", itemId: "panel", qty: 3 }, { id: "r2", projectId: "p1", itemId: "panel", qty: 4 }, { id: "r3", projectId: "p2", itemId: "panel", qty: 2 }];
    const result = Warehouse.consumeReservation(reservations, "panel", "p1", 5);
    assert.deepEqual(result.map(function (r) { return [r.id, r.qty]; }), [["r2", 2], ["r3", 2]]);
    assert.equal(reservations[0].qty, 3);
    assert.equal(Warehouse.releaseReservation(reservations, "r2").length, 2);
  });
  check("stock filters include zero, reserved and low available quantities", function () {
    const items = [item({ minQty: 5 }), item({ id: "empty", qty: 0 })];
    const reservations = [{ id: "r1", itemId: "panel", projectId: "p1", qty: 6 }];
    assert.equal(Warehouse.filterItems(items, { availability: "reserved" }, reservations).length, 1);
    assert.equal(Warehouse.filterItems(items, { availability: "available" }, reservations).length, 1);
    assert.equal(Warehouse.filterItems(items, { availability: "out" }, reservations).length, 1);
    assert.equal(Warehouse.filterItems(items, { availability: "low" }, reservations).length, 2);
  });
  check("stocktake cannot silently consume reserved stock", function () {
    const before = state({ reservations: [{ id: "r1", itemId: "panel", projectId: "p1", qty: 8 }] });
    assert.throws(function () { Warehouse.postStocktake(before, doc({ reason: "Перерахунок", lines: [{ itemId: "panel", countedQty: 5 }] })); });
  });
  check("no-change stocktake keeps its document without fake movement", function () {
    const result = Warehouse.postStocktake(state(), doc({ reason: "Залишки збігаються", lines: [{ itemId: "panel", countedQty: 10 }] }));
    assert.equal(result.documents.length, 1);
    assert.equal(result.movements.length, 0);
    assert.equal(result.document.total, 0);
  });
  check("malformed serial arrays and ambiguous timestamps fail without changes", function () {
    const before = state();
    assert.throws(function () { Warehouse.postReceipt(before, doc({ createdAt: "2026-10-24T10:00" })); });
    assert.throws(function () { Warehouse.postReceipt(before, doc({ createdAt: "2026-02-30T10:00:00Z" })); });
    assert.throws(function () { Warehouse.postReceipt(before, doc({ lines: [{ itemId: "panel", qty: 1, purchasePrice: 100, serialNumbers: "SN1" }] })); });
    assert.equal(before.items[0].qty, 10);
  });

  check("clearing optional numeric characteristics persists an explicit zero", function () {
    const result = Warehouse.saveCatalog([item({ powerW: 450, minQty: 4 })], { id: "panel", powerW: "", minQty: "" })[0];
    assert.equal(result.powerW, 0);
    assert.equal(result.minQty, 0);
    assert.equal(result.qty, 10);
    assert.equal(result.purchasePrice, 100);
  });
  check("zero retail price synchronizes the legacy sales alias", function () {
    const result = Warehouse.saveCatalog([item({ retailPrice: 200, salePrice: 200 })], { id: "panel", retailPrice: "0" })[0];
    assert.equal(result.retailPrice, 0);
    assert.equal(result.salePrice, 0);
  });
  check("unit cannot change after movements, reservations or object issues even at zero central stock", function () {
    const cable = item({ id: "cable", name: "Кабель", unit: "м", qty: 0 });
    const input = { id: "cable", unit: "шт" };
    assert.throws(function () { Warehouse.saveCatalog([cable], input, { movements: [{ itemId: "cable", qty: 10.5 }] }); });
    assert.throws(function () { Warehouse.saveCatalog([cable], input, { reservations: [{ itemId: "cable", qty: 1 }] }); });
    assert.throws(function () { Warehouse.saveCatalog([cable], input, { projects: [{ materials: [{ warehouseItemId: "cable", issuedQty: 10.5 }] }] }); });
    assert.equal(Warehouse.saveCatalog([cable], input, {})[0].unit, "шт");
  });

  return checks;
}

module.exports = runWarehouseCoreTests;
if (require.main === module) console.log("Warehouse core: " + runWarehouseCoreTests() + " checks passed");
