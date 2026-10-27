"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
function runTests(directory = path.resolve(__dirname, "..")) {
const core = require(path.join(directory, "warehouse-core.js"));
const api = require(path.join(directory, "inventory-import.js")).create(core);
const clone = (value) => JSON.parse(JSON.stringify(value));
const empty = () => ({ items: [], movements: [], documents: [], reservations: [], projects: [], orderReservations: [] });
const item = (overrides = {}) => ({ name: "Панель 550 Вт", sku: "PV-550", unit: "шт", category: "Фотомодулі", currency: "UAH", purchasePrice: 1000, installerPrice: 1100, retailPrice: 1200, wholesalePrice: null, qty: 100, sourceRow: "2", ...overrides });
const manifest = (items, sourceHash = "a".repeat(64)) => ({ sourceName: "Номенклатура СЕС.csv", sourceHash, items });
const options = { date: "2026-10-27" };
const checks = [];
function check(label, fn) { fn(); checks.push(label); }

check("semicolon CSV handles BOM, quoted semicolons/commas, literal quotes, decimal commas, zero and blank prices", () => {
  const csv = '\uFEFFname;sku;unit;category;currency;purchasePrice;installerPrice;retailPrice;wholesalePrice;qty;sourceRow\r\n"Панель; 550, ""Вт""";PV;шт;Фотомодулі;UAH;0;;"12,50"; ;100;7\r\n';
  const rows = api.parseCsv(csv);
  assert.equal(rows[0].name, 'Панель; 550, "Вт"');
  assert.equal(rows[0].purchasePrice, 0);
  assert.equal(rows[0].installerPrice, null);
  assert.equal(rows[0].retailPrice, 12.5);
  assert.equal(rows[0].wholesalePrice, null);
  assert.equal(rows[0].qty, 100);
  assert.throws(() => api.parseCsv("name;qty\nPV;100"), /заголовки/);
  assert.throws(() => api.parseCsv(csv.slice(0, csv.indexOf("\r\n") + 2) + '"bad'), /Незакриті/);
});

check("280 independent 100-unit new goods post atomically with complete document and movement trails", () => {
  const before = empty(), saved = clone(before);
  const rows = Array.from({ length: 280 }, (_, index) => item({ name: "Панель " + index, sku: "PV-" + index, sourceRow: String(index + 2), unit: index % 7 ? "шт" : "м" }));
  const result = api.plan(before, manifest(rows), options);
  assert.deepEqual(before, saved);
  assert.equal(result.summary.totalQty, 28000);
  assert.equal(result.summary.newItems, 280);
  assert.equal(result.state.items.length, 280);
  assert.equal(result.state.movements.length, 280);
  assert.equal(result.state.documents.length, 1);
  assert.ok(result.state.items.every((entry) => entry.qty === 100));
  assert.ok(result.state.documents[0].lines.every((line) => line.qty === 100));
  assert.equal(result.state.documents[0].supplier, "");
  assert.equal(result.state.documents[0].type, "purchase");
  assert.equal(result.summary.valuationIncomplete, false);
});

check("existing reserved goods gain 100 while exact cost components, tiers, metadata, projects and holds survive", () => {
  const before = empty();
  before.items.push({ ...item(), id: "existing", qty: 17, purchasePrice: 10, deliveryCost: 2, extraCost: 3, installerPrice: 31, retailPrice: 33, salePrice: 33, wholesalePrice: 29, brand: "Recorded", location: "Shelf A", custom: { nested: true } });
  before.reservations.push({ id: "project-hold", itemId: "existing", projectId: "project", qty: 8 });
  before.orderReservations.push({ id: "buyer-hold", itemId: "existing", qty: 3 });
  before.projects.push({ id: "project", materials: [{ issuedQty: 4 }] });
  before.documents.push({ id: "history", status: "posted", lines: [] });
  before.movements.push({ id: "historic", documentId: "history", itemId: "existing", qty: 17 });
  const saved = clone(before), result = api.plan(before, manifest([item({ purchasePrice: 999, installerPrice: 888, retailPrice: 777 })]), options);
  assert.deepEqual(before, saved);
  assert.deepEqual(result.state.items[0], { ...saved.items[0], qty: 117 });
  for (const field of ["projects", "reservations", "orderReservations"]) assert.deepEqual(result.state[field], saved[field]);
  assert.deepEqual(result.state.documents.find((doc) => doc.id === "history"), saved.documents[0]);
  assert.deepEqual(result.state.movements.find((movement) => movement.id === "historic"), saved.movements[0]);
  assert.equal(result.summary.rows[0].route, "stocktake");
  assert.equal(result.summary.rows[0].unitCost, 15);
  assert.equal(result.state.documents[0].total, 1500);
});

check("missing NEW acquisition cost becomes explicit unknown valuation without copying sales price; zero is known", () => {
  const result = api.plan(empty(), manifest([item({ purchasePrice: null }), item({ name: "Панель zero", sku: "ZERO", purchasePrice: 0, sourceRow: "3" })]), options);
  const unknown = result.state.items.find((entry) => entry.sku === "PV-550");
  const zero = result.state.items.find((entry) => entry.sku === "ZERO");
  assert.equal(unknown.purchasePrice, 0);
  assert.equal(unknown.purchasePriceKnown, false);
  assert.equal(unknown.retailPrice, 1200);
  assert.equal(zero.purchasePriceKnown, true);
  assert.equal(result.summary.unknownCostNewItems, 1);
  assert.equal(result.summary.knownCostNewItems, 1);
  assert.equal(result.summary.valuationIncomplete, true);
  assert.equal(result.state.documents.find((doc) => doc.type === "stocktake").valuationIncomplete, true);
  assert.equal(result.state.documents.find((doc) => doc.type === "purchase").valuationIncomplete, false);
});

check("mixed currencies and routes stay in separate fixed-currency documents", () => {
  const rows = [item(), item({ name: "UAH unknown", sku: "UAH-unknown", purchasePrice: null }), item({ name: "USD known", sku: "USD-known", currency: "USD" }), item({ name: "USD unknown", sku: "USD-unknown", currency: "USD", purchasePrice: null })];
  const result = api.plan(empty(), manifest(rows), options);
  assert.equal(result.state.documents.length, 4);
  assert.deepEqual(Object.keys(result.summary.currencies).sort(), ["UAH", "USD"]);
  for (const doc of result.state.documents) for (const line of doc.lines) assert.equal(line.currency, doc.currency);
});

check("replay returns unchanged state; partial, colliding and changed manifests are rejected", () => {
  const source = manifest([item(), item({ name: "Unknown", sku: "UNKNOWN", purchasePrice: null })]);
  const result = api.plan(empty(), source, options);
  const replay = api.plan(result.state, source, options);
  assert.equal(replay.alreadyImported, true);
  assert.equal(replay.state, result.state);
  assert.deepEqual(replay.summary, result.summary);
  assert.throws(() => api.plan(result.state, manifest([item({ qty: 101 })]), options), /інший або неповний/);
  const partial = clone(result.state); partial.documents.pop();
  assert.throws(() => api.plan(partial, source, options), /неповну|неповний/);
  const collision = empty(); collision.documents.push({ id: result.summary.documentIds[0], status: "posted" });
  assert.throws(() => api.plan(collision, source, options), /інший або неповний/);
  const tampered = clone(result.state); tampered.documents[0].importManifestSignature = "different";
  assert.throws(() => api.plan(tampered, source, options), /інший або неповний/);
});

check("exact source duplicates add 100 once; conflicting prices, SKUs and mappings fail the whole batch", () => {
  const result = api.plan(empty(), manifest([item(), item({ sourceRow: "3" })]), options);
  assert.equal(result.summary.duplicatesMerged, 1);
  assert.equal(result.summary.totalQty, 100);
  assert.throws(() => api.plan(empty(), manifest([item(), item({ sourceRow: "3", purchasePrice: 999 })]), options), /Суперечливий дубль/);
  assert.throws(() => api.plan(empty(), manifest([item(), item({ sourceRow: "3", sku: "OTHER" })]), options), /Суперечливий дубль/);
  const before = empty(); before.items = [{ ...item(), id: "a", qty: 1 }, { ...item({ name: "Other" }), id: "b", qty: 1 }];
  assert.throws(() => api.plan(before, manifest([item()]), options), /Неоднозначна/);
});

check("currency/unit ambiguity, archived/serial items and late invalid rows leave originals untouched", () => {
  for (const overrides of [{ currency: "USD" }, { unit: "компл" }, { archived: true }, { serialTracking: true }, { type: "service" }]) {
    const before = empty(); before.items = [{ ...item(), id: "existing", qty: 4, ...overrides }];
    const saved = clone(before);
    assert.throws(() => api.plan(before, manifest([item()]), options));
    assert.deepEqual(before, saved);
  }
  const before = empty(), saved = clone(before);
  assert.throws(() => api.plan(before, manifest([item(), item({ name: "Bad", sku: "BAD", category: "Послуги", sourceRow: "3" })]), options), /Послуги/);
  assert.deepEqual(before, saved);
  const ambiguous = empty(); ambiguous.items = [{ ...item(), id: "one", sku: "ONE" }, { ...item(), id: "two", sku: "TWO" }];
  assert.throws(() => api.plan(ambiguous, manifest([item({ sku: "NEW" })]), options), /Неоднозначна/);
});

check("untrusted JSON cannot supply stock, document history, metadata, cash or scripts", () => {
  const source = manifest([item({ id: "forged", qty: 100, serialTracking: false, purchasePriceKnown: false, type: "service", supplier: "Invented", cash: { amount: 999 } })]);
  Object.assign(source, { state: { items: [{ qty: 999 }] }, documents: [{ id: "fake" }], cashTransactions: [{ amount: 999 }] });
  const result = api.plan(empty(), source, options);
  assert.equal(result.state.items[0].qty, 100);
  assert.notEqual(result.state.items[0].id, "forged");
  assert.equal(result.state.items[0].type, undefined);
  assert.equal(result.state.items[0].purchasePriceKnown, true);
  assert.equal(result.state.items[0].cash, undefined);
  assert.equal(result.state.cashTransactions, undefined);
  assert.equal(result.state.documents.some((doc) => doc.id === "fake"), false);
  for (const invalid of [{ name: '<script>alert(1)</script>' }, { name: { html: "bad" } }, { qty: true }, { qty: 0 }, { qty: 100.5 }, { qty: 1000000001 }, { purchasePrice: Infinity }, { purchasePrice: -1 }, { sourceRow: {} }]) assert.throws(() => api.plan(empty(), manifest([item(invalid)]), options));
  assert.throws(() => api.plan(empty(), manifest([item()]), { date: "2026-02-30" }), /дату/);
});

check("full workspace payload over 10 MB rejects atomically", () => {
  const before = empty(); before.documents.push({ id: "large", status: "posted", note: "x".repeat(10000000) });
  const saved = clone(before);
  assert.throws(() => api.plan(before, manifest([item()]), options), /10 МБ/);
  assert.deepEqual(before, saved);
});

return { passed: checks.length, checks };
}
module.exports = runTests;
if (require.main === module) console.log(JSON.stringify(runTests(),null,2));
