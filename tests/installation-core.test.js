"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Installation = require("../installation-core.js");
const Warehouse = require("../warehouse-core.js");

function runInstallationCoreTests() {
  const checks = [];
  const check = (name, callback) => { callback(); checks.push(name); };
  const copy = (value) => JSON.parse(JSON.stringify(value));
  function state() {
    return {
      revision: 8,
      items: [
        { id: "panel", name: "Панель", sku: "PV1", category: "Фотомодулі", unit: "шт", currency: "USD", qty: 10, purchasePrice: 120, deliveryCost: 5, extraCost: 5, installerPrice: 180, retailPrice: 200, serialNumbers: [] },
        { id: "cable", name: "Кабель", sku: "DC6", category: "Кабелі", unit: "м", currency: "USD", qty: 20, purchasePrice: 1, deliveryCost: 0, extraCost: 0, installerPrice: 2 },
      ],
      projects: [
        { id: "site", title: "Станція", currency: "USD", status: "in_progress", installationDate: "2026-10-27", workChecklist: { panels_install: false, client_briefing: false },
          materials: [{ warehouseItemId: "panel", name: "Панель", sku: "PV1", unit: "шт", currency: "USD", plannedQty: 5, issuedQty: 5, actualQty: 2, purchasePriceSnapshot: 100, salePriceSnapshot: 150, note: "Зберегти примітку" }],
          finance: { contractPrice: 1000, installationPrice: 100, advancePaid: 200, offerLines: [{ id: "quote", catalogItemId: "panel", qty: 20, salePrice: 170 }], expenses: [{ amount: 7 }] } },
        { id: "other-site", title: "Інший об’єкт", currency: "USD", materials: [] },
      ],
      reservations: [{ id: "own", projectId: "site", itemId: "panel", qty: 2 }, { id: "other", projectId: "other-site", itemId: "panel", qty: 3 }],
      orderReservations: [{ id: "buyer", buyerId: "buyer", itemId: "panel", qty: 1 }],
      documents: [{ id: "old", type: "project", status: "posted", projectId: "site", lines: [{ itemId: "panel", qty: 5 }] }],
      movements: [{ id: "old-move", type: "project", documentId: "old", projectId: "site", itemId: "panel", qty: 5, unitCost: 100, materialSalePrice: 150 }],
      cash: { balance: 200, entries: [{ id: "advance", amount: 200 }] },
    };
  }
  const input = (qty = 5, overrides = {}) => ({ projectId: "site", completedOn: "2026-10-30", today: "2026-11-01", recordedAt: "2026-11-01T08:00:00Z", actor: { id: "owner", name: "Власник", access_token: "must-not-copy" }, lines: [{ itemId: "panel", qty }], ...overrides });
  const physical = (value, itemId = "panel") => value.items.find((item) => item.id === itemId).qty;
  const material = (value) => value.projects[0].materials[0];
  function rejectsUnchanged(value, options, pattern) {
    const before = copy(value);
    assert.throws(() => Installation.complete(value, options), pattern);
    assert.deepEqual(value, before, "A rejected batch must not change its input state");
  }

  check("Previously issued 5, actual 2, completion 5 consumes only 3 without touching physical stock", () => {
    const before = state(), original = copy(before);
    const next = Installation.complete(before, input());
    assert.equal(physical(next), 10);
    assert.equal(material(next).issuedQty, 5);
    assert.equal(material(next).actualQty, 5);
    const movements = next.movements.filter((entry) => entry.documentId === next.document.id);
    assert.equal(movements.length, 1);
    assert.equal(movements[0].type, "consume");
    assert.equal(movements[0].qty, 3);
    assert.equal(movements[0].unitCost, 100);
    assert.equal(movements[0].materialSalePrice, 150);
    assert.deepEqual(before, original, "Input objects are never mutated");
  });

  check("Completion 6 issues exactly 1 and consumes 4 while preserving weighted historical acquisition cost", () => {
    const next = Installation.complete(state(), input(6));
    assert.equal(physical(next), 9);
    assert.equal(material(next).issuedQty, 6);
    assert.equal(material(next).actualQty, 6);
    assert.equal(material(next).purchasePriceSnapshot, 105);
    assert.equal(material(next).salePriceSnapshot, 155);
    const issue = next.movements.find((entry) => entry.type === "project" && entry.documentId === next.document.id);
    const consume = next.movements.find((entry) => entry.type === "consume" && entry.documentId === next.document.id);
    assert.equal(issue.qty, 1); assert.equal(issue.unitCost, 130); assert.equal(issue.materialSalePrice, 180);
    assert.equal(consume.qty, 4); assert.equal(consume.unitCost, 100); assert.equal(consume.materialSalePrice, 150);
    assert.deepEqual(next.items[0], { ...state().items[0], qty: 9 }, "An issue must not revalue central stock");
  });

  check("First issue and consumption use current warehouse cost and one immutable completion document", () => {
    const before = state(); before.projects[0].materials = [];
    const next = Installation.complete(before, input(3));
    assert.equal(physical(next), 7);
    assert.equal(material(next).issuedQty, 3); assert.equal(material(next).actualQty, 3);
    assert.equal(material(next).purchasePriceSnapshot, 130); assert.equal(material(next).salePriceSnapshot, 180);
    const movements = next.movements.filter((entry) => entry.documentId === next.document.id);
    assert.deepEqual(movements.map((entry) => [entry.type, entry.qty, entry.unitCost]), [["project", 3, 130], ["consume", 3, 130]]);
    assert.ok(movements.every((entry) => entry.documentNumber === next.document.number));
    assert.equal(next.document.type, "consume"); assert.equal(next.document.status, "posted");
    assert.equal(next.document.kind, "installation_completion");
    assert.equal(next.document.projectId, "site"); assert.equal(next.document.completedOn, "2026-10-30");
    assert.equal(next.document.recordedAt, "2026-11-01T08:00:00.000Z");
    assert.deepEqual(next.document.actor, { id: "owner", name: "Власник" });
    assert.equal(JSON.stringify(next.document).includes("must-not-copy"), false);
    assert.deepEqual(next.document.finalLines.map((line) => [line.itemId, line.qty]), [["panel", 3]]);
    assert.equal(next.document.id, Installation.documentId("site"));
  });

  check("A recorded completion is idempotent even if another document id or edited quantities are sent", () => {
    const once = Installation.complete(state(), input(5));
    const twice = Installation.complete(once, input(8, { id: "second-attempt" }));
    assert.equal(twice.alreadyCompleted, true);
    assert.equal(twice.documents.length, once.documents.length);
    assert.equal(twice.movements.length, once.movements.length);
    assert.deepEqual(twice.projects, once.projects);
    assert.deepEqual(twice.items, once.items);
    assert.equal(twice.document.id, once.document.id);
    assert.equal(once.alreadyCompleted, false);
    const record = Installation.completion(twice, "site");
    record.completedOn = "2025-01-01";
    assert.equal(Installation.completion(twice, "site").completedOn, "2026-10-30", "Readers receive a copy of immutable history");
  });

  check("Already fully consumed materials get a date-only completion with no stock movement", () => {
    const before = state(); material(before).actualQty = 5;
    const next = Installation.complete(before, input());
    assert.deepEqual(next.movements, before.movements);
    assert.deepEqual(next.items, before.items);
    assert.equal(next.document.finalLines[0].consumedQty, 0);
    assert.equal(next.document.completedOn, "2026-10-30");
  });

  check("Own reservations are usable and consumed; other project and buyer holds remain untouched", () => {
    const before = state();
    const summary = Installation.summarizePlan(before, input(11));
    assert.equal(summary.lines[0].availableQty, 6); assert.equal(summary.lines[0].issueQty, 6);
    const next = Installation.complete(before, input(11));
    assert.equal(physical(next), 4);
    assert.deepEqual(next.reservations, [before.reservations[1]]);
    assert.deepEqual(next.orderReservations, before.orderReservations);
    assert.equal(material(next).actualQty, 11);
    rejectsUnchanged(state(), input(12), /Недостатньо вільного залишку/);
  });

  check("A shortage in any row rejects the entire batch before a preceding valid issue can change state", () => {
    const before = state();
    rejectsUnchanged(before, input(6, { lines: [{ itemId: "panel", qty: 6 }, { itemId: "cable", qty: 21 }] }), /Недостатньо/);
  });

  check("Final totals cannot erase earlier confirmed usage or omit already installed material", () => {
    rejectsUnchanged(state(), input(1), /меншою за вже підтверджений/);
    rejectsUnchanged(state(), input(1, { lines: [{ itemId: "cable", qty: 1 }] }), /вже змонтований матеріал/);
    const invalid = state(); material(invalid).actualQty = 6;
    rejectsUnchanged(invalid, input(7), /перевищує раніше видану/);
  });

  check("Quote prices, contract, cash, planned visit, checklist and unrelated projects are unchanged", () => {
    const before = state(), next = Installation.complete(before, input(6));
    assert.deepEqual(next.projects[0].finance, before.projects[0].finance);
    assert.deepEqual(next.cash, before.cash);
    assert.deepEqual(next.projects[0].workChecklist, before.projects[0].workChecklist);
    assert.equal(next.projects[0].installationDate, before.projects[0].installationDate);
    assert.equal(next.projects[0].status, before.projects[0].status, "Completion lives in the stock document, not a separate uncommitted status save");
    assert.deepEqual(next.projects[1], before.projects[1]);
    assert.deepEqual(next.documents.find((entry) => entry.id === "old"), before.documents[0]);
    assert.deepEqual(next.movements.find((entry) => entry.id === "old-move"), before.movements[0]);
  });

  check("Different currencies on product, bound material or explicit input cannot be mixed", () => {
    const product = state(); product.items[0].currency = "UAH";
    rejectsUnchanged(product, input(), /Валюта/);
    const bound = state(); material(bound).currency = "UAH";
    rejectsUnchanged(bound, input(), /Валюта/);
    rejectsUnchanged(state(), input(5, { lines: [{ itemId: "panel", qty: 5, currency: "UAH" }] }), /Валюта/);
    const legacy = state(); delete material(legacy).currency;
    rejectsUnchanged(legacy, input(), /Валюта/, "Missing legacy currency must not silently reinterpret UAH as USD");
  });

  check("Unbound material with another currency or unit cannot be silently adopted from the quote", () => {
    for (const mismatch of [{ currency: "UAH", unit: "шт" }, { currency: "USD", unit: "компл" }]) {
      const before = state();
      before.projects[0].materials = [{ warehouseItemId: "", catalogItemId: "panel", name: "Панель", plannedQty: 5, issuedQty: 0, actualQty: 0, ...mismatch }];
      rejectsUnchanged(before, input(), /Валюта|Одиниця/);
    }
  });

  check("Compatible unissued material can be bound without losing notes or overwriting offer lines", () => {
    const before = state();
    before.projects[0].materials = [{ warehouseItemId: "", catalogItemId: "panel", name: "Панель", currency: "USD", unit: "шт", plannedQty: 8, issuedQty: 0, actualQty: 0, purchasePriceSnapshot: 7, salePriceSnapshot: 9, note: "Plan note" }];
    const next = Installation.complete(before, input(3));
    assert.equal(next.projects[0].materials.length, 1);
    assert.equal(material(next).warehouseItemId, "panel"); assert.equal(material(next).plannedQty, 8);
    assert.equal(material(next).note, "Plan note"); assert.equal(material(next).purchasePriceSnapshot, 130);
    assert.equal(material(next).salePriceSnapshot, 180); assert.equal(material(next).actualQty, 3);
    assert.deepEqual(next.projects[0].finance.offerLines, before.projects[0].finance.offerLines);
  });

  check("Unbound previously issued or consumed materials require explicit historical repair", () => {
    for (const field of ["issuedQty", "actualQty"]) {
      const before = state(); material(before).warehouseItemId = ""; material(before).issuedQty = 0; material(before).actualQty = 0; material(before)[field] = 1;
      rejectsUnchanged(before, input(), /без прив’язки до складу|не прив’язаний/);
    }
  });

  check("Bound materials and explicit line units must match the warehouse item", () => {
    const before = state(); material(before).unit = "м";
    rejectsUnchanged(before, input(), /Одиниця/);
    rejectsUnchanged(state(), input(5, { lines: [{ itemId: "panel", qty: 5, unit: "компл" }] }), /Одиниця/);
  });

  check("Fractional cable quantities are supported without allowing fractional pieces or excess precision", () => {
    const before = state(); before.projects[0].materials = [];
    const next = Installation.complete(before, input(1, { lines: [{ itemId: "cable", qty: "2,125" }] }));
    assert.equal(physical(next, "cable"), 17.875);
    assert.equal(material(next).actualQty, 2.125); assert.equal(material(next).issuedQty, 2.125);
    rejectsUnchanged(state(), input(5.1), /ціла кількість/);
    rejectsUnchanged(before, input(1, { lines: [{ itemId: "cable", qty: 2.0001 }] }), /трьох знаків/);
  });

  check("Duplicate rows, missing products, service items and an empty actual list are rejected", () => {
    rejectsUnchanged(state(), input(5, { lines: [{ itemId: "panel", qty: 3 }, { itemId: "panel", qty: 2 }] }), /повторні рядки/);
    rejectsUnchanged(state(), input(5, { lines: [{ itemId: "missing", qty: 1 }] }), /не знайдено/);
    const before = state(); before.items[0].type = "service";
    rejectsUnchanged(before, input(), /фізичного складу/);
    rejectsUnchanged(state(), input(5, { lines: [] }), /фактично змонтоване/);
    const empty = state(); empty.projects[0].materials = [];
    rejectsUnchanged(empty, input(0), /хоча б одну/);
  });

  check("Unsupported serial-tracked stock is rejected before any implicit serial movement", () => {
    for (const tracking of [{ serialTracking: true }, { serialNumber: "SN1" }, { serialNumbers: ["SN1"] }]) {
      const before = state(); Object.assign(before.items[0], tracking);
      rejectsUnchanged(before, input(), /серійний облік/);
    }
  });

  check("Completion date must be a real nonfuture business date and timestamps require timezone", () => {
    for (const completedOn of ["", "2026-02-30", "2026-13-01", "2026-11-02", "2026-10-30T00:00:00Z"]) rejectsUnchanged(state(), input(5, { completedOn }), /дат[ауи]/i);
    rejectsUnchanged(state(), input(5, { recordedAt: "2026-11-01T09:00:00" }), /дата й час/);
    assert.equal(Installation.complete(state(), input(5, { completedOn: "2024-02-29" })).document.completedOn, "2024-02-29");
  });

  check("Multiple historical lines for one stock item keep their cost history and consume the aggregate delta", () => {
    const before = state();
    before.projects[0].materials = [
      { ...material(before), issuedQty: 3, actualQty: 1, purchasePriceSnapshot: 90, salePriceSnapshot: 140 },
      { ...material(before), issuedQty: 2, actualQty: 1, purchasePriceSnapshot: 115, salePriceSnapshot: 165 },
    ];
    const next = Installation.complete(before, input(6));
    const installed = next.projects[0].materials;
    assert.equal(installed.reduce((sum, entry) => sum + entry.actualQty, 0), 6);
    assert.equal(installed.reduce((sum, entry) => sum + entry.issuedQty, 0), 6);
    assert.equal(installed.reduce((sum, entry) => sum + entry.issuedQty * entry.purchasePriceSnapshot, 0), 630);
    assert.equal(installed[1].purchasePriceSnapshot, 115);
    assert.equal(next.movements[1].type, "consume");
    assert.equal(next.movements[1].unitCost, 100);
    assert.equal(next.movements[1].materialSalePrice, 150);
    assert.equal(physical(next), 9);
  });

  check("Missing historical cost snapshots cannot be silently rebuilt from today's catalog price", () => {
    for (const field of ["purchasePriceSnapshot", "salePriceSnapshot"]) {
      const before = state(); delete material(before)[field];
      rejectsUnchanged(before, input(6), /історична/);
    }
  });

  check("Completion identifiers cannot overwrite another posted document or ambiguous completion history", () => {
    rejectsUnchanged(state(), input(5, { id: "old" }), /вже використано/);
    const before = state();
    before.documents.push({ id: "one", kind: "installation_completion", projectId: "site", status: "posted" }, { id: "two", kind: "installation_completion", projectId: "site", status: "posted" });
    rejectsUnchanged(before, input(5), /кілька підтверджень/);
    assert.equal(Installation.completion(state(), "other-site"), null);
  });

  check("UMD browser export runs against the actual warehouse domain module", () => {
    const sandbox = { window: { SpartaWarehouseCore: Warehouse }, Intl, Date };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../installation-core.js"), "utf8"), sandbox);
    assert.ok(sandbox.window.SpartaInstallationCore);
    const next = sandbox.window.SpartaInstallationCore.complete(state(), input());
    assert.equal(physical(next), 10); assert.equal(material(next).actualQty, 5);
    assert.equal(Object.isFrozen(sandbox.window.SpartaInstallationCore), true);
  });

  return { passed: checks.length, checks };
}

module.exports = runInstallationCoreTests;
if (require.main === module) console.log(JSON.stringify(runInstallationCoreTests(), null, 2));
