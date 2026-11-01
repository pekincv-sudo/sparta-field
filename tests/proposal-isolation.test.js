"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");

module.exports = function runProposalIsolationTests() {
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const implementations = new Map([...source.matchAll(/^function\s+([\w$]+)\([^]*?^\}/gm)].map(match => [match[1], match[0]]));
  let now = "2026-11-01T10:00:00.000Z", project, saves = 0, renders = 0;
  const alerts = [], sections = [], checks = [];
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
  class FormValues { constructor(values) { this.values = values; } get(key) { return Object.hasOwn(this.values, key) ? this.values[key] : null; } }
  const context = vm.createContext({
    Date: Clock, crypto: { randomUUID }, FormData: FormValues,
    cloudState: { ready: true, memberRole: "owner" }, window: { SPARTA_LOCAL_WORKSPACE: { enabled: false } },
    warehouseItems: [{ id: "catalog-inverter", name: "Current catalogue name", qty: 0, purchasePrice: 800, retailPrice: 1200, currency: "USD" }],
    warehouseReservations: [{ itemId: "catalog-inverter", projectId: "other", qty: 2 }],
    warehouseMovements: [{ id: "existing-movement", qty: 1 }],
    cashEntries: [{ id: "existing-payment", amountMinor: 12345, sourceType: "project" }],
    companyContacts: { name: "SPARTA power", location: "Office", phone: "+380000000000", email: "office@example.test" },
    selectedProject: () => project,
    saveProjects() { saves++; }, render() { renders++; }, showSection(section) { sections.push(section); },
    alert(message) { alerts.push(message); },
  });
  for (const name of ["emptyProjectFinance", "normalizeProjectFinance", "canManageProjectFinance", "requireProjectRole", "escapeAttribute", "money", "offerLineTotals", "addCommercialOfferLine", "saveCommercialOfferTotals", "commercialOfferDocumentMarkup", "renderCommercialOfferStage"]) {
    assert.ok(implementations.has(name), `Production function ${name} exists`);
    vm.runInContext(implementations.get(name), context);
  }
  const deleteBlock = source.match(/  const deleteOfferLineButton = event\.target\.closest\("\[data-delete-offer-line\]"\);[^]*?\n  \}\n\n/);
  assert.ok(deleteBlock, "Production quote delete handler exists");
  vm.runInContext(`function deleteQuoteLine(event) {\n${deleteBlock[0]}\n}`, context);

  const clone = value => JSON.parse(JSON.stringify(value));
  const check = (name, callback) => { callback(); checks.push(name); };
  const baseProject = () => ({
    id: "proposal-isolation", currency: "USD", title: "Station", address: "Address", clientName: "Client", status: "proposal",
    materials: [{ id: "installed", name: "Actual material", qty: 3, actualQty: 2, purchasePrice: 555, salePrice: 777 }],
    history: [{ title: "Existing history" }], photos: [{ category: "Касовий чек", caption: "INTERNAL-RECEIPT-SENTINEL" }],
    finance: clone(context.normalizeProjectFinance({ contractPrice: 24680, installationPrice: 4321, crewPayroll: 765, advancePaid: 654,
      expenses: [{ name: "INTERNAL-EXPENSE-SENTINEL", amount: 321 }],
      equipment: [{ name: "Booked equipment", qty: 1, unit: "шт", purchasePrice: 90, salePrice: 100 }],
      offerUpdatedAt: "2026-10-01T00:00:00.000Z", offerLines: [{ id: "quoted-catalogue", warehouseItemId: "catalog-inverter", catalogItemId: "catalog-inverter", sku: "FROZEN-SKU", brand: "Frozen Brand", model: "Frozen Model", name: "Frozen catalogue title", category: "Інвертори", currency: "USD", sourceCurrency: "UAH", unit: "шт", qty: 2, purchasePrice: 137.91, salePrice: 987.65, note: "FROZEN-SPECIFICATION" }] })),
  });
  const reset = () => { project = baseProject(); context.cloudState.memberRole = "owner"; saves = 0; renders = 0; alerts.length = 0; sections.length = 0; };
  const actualState = () => clone({ project: { ...project, finance: Object.fromEntries(Object.entries(project.finance).filter(([key]) => !["offerLines", "offerUpdatedAt", "offerInstallationPrice"].includes(key))) }, stock: context.warehouseItems, reservations: context.warehouseReservations, movements: context.warehouseMovements, cash: context.cashEntries });
  const lineForm = (changes = {}) => ({ name: "  Independent cable  ", unit: " м ", qty: "12.5", salePrice: "4.2", purchasePrice: "2.1", note: "  Client detail  ", ...changes });
  const deleteLine = index => context.deleteQuoteLine({ target: { closest: () => ({ dataset: { deleteOfferLine: String(index) } }) } });

  reset();
  check("A manual quote line saves custom details and fractional quantity without touching contract, costs, stock or cash", () => {
    const before = actualState();
    context.addCommercialOfferLine(lineForm());
    const line = project.finance.offerLines.at(-1);
    assert.equal(project.finance.offerLines.length, 2);
    assert.equal(line.name, "Independent cable"); assert.equal(line.unit, "м"); assert.equal(line.qty, 12.5);
    assert.equal(line.salePrice, 4.2); assert.equal(line.purchasePrice, 2.1); assert.equal(line.note, "Client detail");
    assert.equal(line.currency, "USD"); assert.ok(line.id.startsWith("offer-"));
    assert.deepEqual(actualState(), before);
    assert.equal(project.finance.offerUpdatedAt, now); assert.equal(saves, 1); assert.equal(renders, 1); assert.deepEqual(sections, ["objectDetail"]);
  });
  check("Editing a catalogue quote preserves its frozen identity and allows explicit zero prices", () => {
    reset(); const before = actualState(); const original = clone(project.finance.offerLines[0]);
    now = "2026-11-01T11:00:00.000Z";
    context.addCommercialOfferLine(lineForm({ lineId: original.id, name: "Revised description", unit: "шт", qty: "5", purchasePrice: "0", salePrice: "0" }));
    const line = project.finance.offerLines[0];
    assert.equal(project.finance.offerLines.length, 1); assert.equal(line.id, original.id); assert.equal(line.qty, 5);
    assert.equal(line.name, "Revised description"); assert.equal(line.salePrice, 0); assert.equal(line.purchasePrice, 0);
    for (const key of ["warehouseItemId", "catalogItemId", "sku", "brand", "model", "sourceCurrency", "category"]) assert.equal(line[key], original[key], key);
    assert.deepEqual(actualState(), before); assert.equal(project.finance.offerUpdatedAt, now); assert.equal(saves, 1);
  });
  check("Catalogue changes do not refresh the saved quote name, specification, quantity or prices", () => {
    reset(); const frozen = clone(project.finance.offerLines[0]); const before = JSON.stringify(project);
    context.warehouseItems[0].name = "Completely different catalogue title";
    context.warehouseItems[0].retailPrice = 999999; context.warehouseItems[0].purchasePrice = 888888;
    const totals = context.offerLineTotals(project), html = context.renderCommercialOfferStage(project);
    assert.equal(totals.equipmentSale, 1975.3); assert.equal(totals.equipmentPurchase, 275.82);
    assert.match(html, /Frozen catalogue title/); assert.match(html, /FROZEN-SPECIFICATION/); assert.doesNotMatch(html, /Completely different catalogue title/);
    assert.deepEqual(clone(context.normalizeProjectFinance(project.finance).offerLines[0]), frozen);
    assert.equal(JSON.stringify(project), before);
  });
  check("A legacy warehouse-linked quote retains its stored details and gains only catalogue provenance", () => {
    const legacy = { id: "legacy", warehouse_item_id: "catalog-inverter", name: "Legacy frozen name", qty: 3, purchase_price: 5.25, sale_price: 7.5, unit: "шт", note: "Legacy specification" };
    const before = JSON.stringify(legacy), normalized = context.normalizeProjectFinance({ offer_lines: [legacy] }).offerLines[0];
    assert.equal(normalized.catalogItemId, "catalog-inverter"); assert.equal(normalized.warehouseItemId, "catalog-inverter");
    assert.equal(normalized.name, legacy.name); assert.equal(normalized.note, legacy.note); assert.equal(normalized.purchasePrice, 5.25); assert.equal(normalized.salePrice, 7.5); assert.equal(normalized.qty, 3);
    assert.equal(JSON.stringify(legacy), before);
  });
  check("Invalid manual quantities, prices, names and units are rejected without saving or mutations", () => {
    const invalid = [{ qty: "0" }, { qty: "-1" }, { qty: "NaN" }, { qty: "Infinity" }, { qty: "1.0001" }, { salePrice: "-0.01" }, { salePrice: "Infinity" }, { purchasePrice: "-1" }, { purchasePrice: "NaN" }, { qty: "1e20" }, { salePrice: "1e20" }, { name: "   " }, { name: "x".repeat(1001) }, { unit: "" }, { unit: "x".repeat(21) }];
    for (const values of invalid) {
      reset(); const before = JSON.stringify(project), peripheral = actualState();
      context.addCommercialOfferLine(lineForm(values));
      assert.equal(JSON.stringify(project), before, JSON.stringify(values)); assert.deepEqual(actualState(), peripheral);
      assert.equal(saves, 0); assert.equal(renders, 0); assert.equal(alerts.length, 1);
    }
  });
  check("A stale edited line cannot silently create or overwrite another quote line", () => {
    reset(); const before = JSON.stringify(project);
    context.addCommercialOfferLine(lineForm({ lineId: "no-longer-exists" }));
    assert.equal(JSON.stringify(project), before); assert.equal(saves, 0); assert.match(alerts[0], /Позиція змінилася/);
  });
  check("Quote installation is saved separately from contract installation, payroll and all actual finances", () => {
    reset(); const before = actualState();
    context.saveCommercialOfferTotals({ installationPrice: "125.75" });
    assert.equal(project.finance.offerInstallationPrice, 125.75); assert.equal(project.finance.installationPrice, 4321);
    assert.deepEqual(actualState(), before); assert.equal(project.finance.offerUpdatedAt, now); assert.equal(saves, 1);
    assert.equal(context.offerLineTotals(project).installationPrice, 125.75); assert.equal(context.offerLineTotals(project).totalSale, 2101.05);
  });
  check("Explicit zero quote installation overrides the legacy fallback without changing the contract", () => {
    reset(); const before = actualState();
    assert.equal(context.offerLineTotals(project).installationPrice, 4321);
    context.saveCommercialOfferTotals({ installationPrice: "0" });
    assert.equal(context.offerLineTotals(project).installationPrice, 0); assert.equal(context.offerLineTotals(project).totalSale, 1975.3);
    assert.deepEqual(actualState(), before);
  });
  check("Legacy quote totals use existing installation only until an independent quote estimate is saved", () => {
    reset(); const legacy = { ...project, finance: { ...project.finance, offerInstallationPrice: undefined } };
    assert.equal(context.offerLineTotals(legacy).totalSale, 6296.3);
    assert.equal(context.offerLineTotals({ ...legacy, finance: { ...legacy.finance, offerInstallationPrice: 100 } }).totalSale, 2075.3);
    assert.equal(context.offerLineTotals({ ...legacy, finance: { ...legacy.finance, offerInstallationPrice: 0 } }).totalSale, 1975.3);
    assert.equal(context.offerLineTotals({ finance: {} }).totalSale, 0);
  });
  check("First quote edits freeze the legacy installation estimate against later contract changes", () => {
    for (const action of [() => context.addCommercialOfferLine(lineForm()), () => deleteLine(0)]) {
      reset(); action();
      assert.equal(project.finance.offerInstallationPrice, 4321);
      project.finance.installationPrice = 9999;
      assert.equal(context.offerLineTotals(project).installationPrice, 4321);
    }
  });
  check("Negative, nonfinite and unsafe installation estimates are rejected atomically", () => {
    for (const value of ["-1", "Infinity", "NaN", "1e20"]) {
      reset(); const before = JSON.stringify(project);
      context.saveCommercialOfferTotals({ installationPrice: value });
      assert.equal(JSON.stringify(project), before); assert.equal(saves, 0); assert.equal(alerts.length, 1);
    }
  });
  check("Combined unsafe totals and mixed currencies reject quote edits and installation saves atomically", () => {
    for (const mismatch of [false, true]) {
      for (const action of [() => context.addCommercialOfferLine(lineForm({ qty: "1", salePrice: "20000000000000" })), () => context.saveCommercialOfferTotals({ installationPrice: "20000000000000" })]) {
        reset();
        Object.assign(project.finance.offerLines[0], mismatch ? { currency: "UAH" } : { qty: 1, salePrice: 80000000000000 });
        const before = JSON.stringify(project);
        action(); assert.equal(JSON.stringify(project), before); assert.equal(saves, 0); assert.equal(alerts.length, 1);
      }
    }
  });
  check("Deleting a quote line changes its revision but leaves actual contract, materials, inventory and cash untouched", () => {
    reset(); const before = actualState();
    deleteLine(0);
    assert.equal(project.finance.offerLines.length, 0); assert.equal(project.finance.offerUpdatedAt, now); assert.equal(saves, 1);
    assert.deepEqual(actualState(), before);
  });
  check("Nonfinancial staff cannot add, edit, delete or change quote installation through direct handlers", () => {
    for (const role of ["engineer", "warehouse", "brigadier", "installer", "viewer"]) {
      for (const action of [() => context.addCommercialOfferLine(lineForm()), () => context.addCommercialOfferLine(lineForm({ lineId: "quoted-catalogue" })), () => context.saveCommercialOfferTotals({ installationPrice: "200" }), () => deleteLine(0)]) {
        reset(); context.cloudState.memberRole = role; const before = JSON.stringify(project), finance = project.finance;
        action(); assert.equal(JSON.stringify(project), before, role); assert.equal(project.finance, finance); assert.equal(saves, 0); assert.equal(renders, 0); assert.equal(alerts.length, 1);
      }
    }
  });
  check("The client PDF contains quote descriptions, client prices and quote installation without procurement, payroll or expenses", () => {
    reset(); project.finance.offerInstallationPrice = 111.22;
    const before = JSON.stringify(project), html = context.commercialOfferDocumentMarkup(project);
    assert.match(html, /Frozen catalogue title/); assert.match(html, /FROZEN-SPECIFICATION/); assert.match(html, /111,22 USD/);
    assert.match(html, /987,65 USD/); assert.match(html, /2\s086,52 USD/);
    assert.doesNotMatch(html, /137,91|275,82|765,00|321,00|4\s321,00|24\s680,00|INTERNAL-EXPENSE|INTERNAL-RECEIPT|Закупів|Собіварт|Зарплат/);
    assert.equal(JSON.stringify(project), before);
  });
  return { passed: checks.length, checks };
};
