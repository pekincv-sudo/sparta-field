"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

async function runWarehouseIntegrationTests(projectDirectory = path.resolve(__dirname, "..")) {
  const app = fs.readFileSync(path.join(projectDirectory, "app.js"), "utf8");
  const uiSource = fs.readFileSync(path.join(projectDirectory, "warehouse-ui.js"), "utf8");
  const core = require(path.join(projectDirectory, "warehouse-core.js"));
  const stateKey = "solarObjectManager.warehouseWorkspace.v31";
  const journalKey = "solarObjectManager.warehouseTransaction.v31";
  const projectKey = "solarObjectManager.projects";
  const storage = new Map();
  const failKeys = new Set();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const item = { id: "panel", name: "Панель", sku: "PV-450", category: "Фотомодулі", qty: 10, unit: "шт", purchasePrice: 100, deliveryCost: 5, extraCost: 0, installerPrice: 150, retailPrice: 170, brand: "Test Brand", model: "P450", powerW: 450, serialNumbers: [] };
  const initialProjects = [{ id: "a", title: "Об’єкт A", status: "in_progress", materials: [] }, { id: "b", title: "Об’єкт B", status: "in_progress", materials: [] }];
  storage.set(projectKey, JSON.stringify(initialProjects));
  storage.set("solarObjectManager.cash.v1.local-sparta", JSON.stringify({ balance: 60900 }));
  const context = {
    window: { SpartaWarehouseCore: core, SPARTA_LOCAL_WORKSPACE: { enabled: true } },
    document: { addEventListener() {} }, navigator: {}, crypto, console, Intl, Date,
    warehouseItems: [clone(item)], warehouseMovements: [], projects: clone(initialProjects),
    cloudState: { user: { id: "local", email: "test@example.invalid" } },
    readLocalStorage(key) { return storage.get(key) ?? null; },
    readJsonStorage(key, fallback) { const value = storage.get(key); return value == null ? fallback : JSON.parse(value); },
    writeLocalStorage(key, value) { if (failKeys.has(key)) return false; storage.set(key, value); return true; },
    ensureProjectCollections(project) { project.materials ||= []; return project; },
  };
  vm.createContext(context);
  const functionSource = (name) => {
    const match = app.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
    assert.ok(match, `Production function ${name} exists`);
    return match[0];
  };
  vm.runInContext(["normalizeProjectId", "normalizeLookupValue", "warehouseUnitCost", "isClosedProjectStatus", "normalizeWarehouseItem", "addWarehouseItemToProjectMaterials"].map(functionSource).join("\n"), context);
  const exportNeedle = "Object.freeze({ render, bootstrap, capture, openForProject, reset, snapshot, transact })";
  assert.ok(uiSource.includes(exportNeedle), "Production warehouse UI export remains discoverable");
  vm.runInContext(uiSource.replace(exportNeedle, "Object.freeze({ render, bootstrap, capture, openForProject, reset, __test: { postMovement, baseDocument, snapshot, persist, transact, ui, recoverJournal, priceInput, renderItemDetail, renderDocumentDetail } })"), context);
  const ui = context.window.SpartaWarehouseUI;
  const hooks = ui.__test;
  const checks = [];
  const check = (name, callback) => { callback(); checks.push(name); };
  const editor = (mode, qty, projectId = "a") => ({ mode, currency: "UAH", id: crypto.randomUUID(), number: mode + "-" + crypto.randomUUID(), date: "2026-10-24", projectId, customer: "Тестовий покупець", supplier: "Тестовий постачальник", location: "Склад", note: "Тест", attachments: [], lines: [{ itemId: "panel", qty: String(qty), purchasePrice: "120", deliveryCost: "", extraCost: "", salePrice: "170", serialNumbers: "" }] });
  const post = (input) => {
    const result = hooks.postMovement(hooks.snapshot(), input);
    hooks.persist(result);
    return result;
  };

  ui.bootstrap();
  check("Issuing identically named products preserves their warehouse IDs and actual usage", () => {
    const inputState = { ...hooks.snapshot(), projects: [{ id: "a", currency: "UAH", status: "in_progress", materials: [
      { warehouseItemId: "another-product", currency: "UAH", name: item.name, sku: item.sku, plannedQty: 5, issuedQty: 5, actualQty: 4, purchasePriceSnapshot: 20, salePriceSnapshot: 30 },
      { warehouseItemId: "panel", currency: "UAH", name: item.name, sku: item.sku, plannedQty: 2, issuedQty: 2, actualQty: 1, purchasePriceSnapshot: 100, salePriceSnapshot: 150 },
    ] }] };
    const untouched = JSON.stringify(inputState.projects[0].materials[0]);
    const result = hooks.postMovement(inputState, editor("project", 1));
    assert.equal(JSON.stringify(result.projects[0].materials[0]), untouched);
    assert.equal(result.projects[0].materials[1].warehouseItemId, "panel");
    assert.equal(result.projects[0].materials[1].issuedQty, 3);
    assert.equal(result.projects[0].materials[1].actualQty, 1);
    assert.equal(context.warehouseItems[0].qty, 10);
  });
  check("Receipt form defaults round weighted prices without revaluing inventory", () => {
    const weighted = 1600 / 13;
    assert.equal(hooks.priceInput(weighted), 123.08);
    assert.equal(weighted, 1600 / 13);
  });
  check("Zero sale and installer prices survive application normalization", () => {
    const normalized = context.normalizeWarehouseItem({ ...item, retailPrice: 0, salePrice: 200, installerPrice: 0 });
    assert.equal(normalized.retailPrice, 0);
    assert.equal(normalized.salePrice, 0);
    assert.equal(normalized.installerPrice, 0);
  });
  check("Bootstrap preserves structured metadata and creates a non-overwriting backup", () => {
    assert.equal(context.warehouseItems[0].powerW, 450);
    assert.ok(storage.has("solarObjectManager.warehouseBackup.before31"));
    const backup = storage.get("solarObjectManager.warehouseBackup.before31");
    ui.bootstrap();
    assert.equal(storage.get("solarObjectManager.warehouseBackup.before31"), backup);
  });

  post(editor("reserve", 4));
  check("Reservation changes available quantity but not physical stock", () => {
    assert.equal(context.warehouseItems[0].qty, 10);
    assert.equal(core.reservedQty(hooks.snapshot().reservations, "panel"), 4);
    assert.equal(core.availableQty(context.warehouseItems[0], hooks.snapshot().reservations), 6);
    assert.equal(context.projects[0].materials.length, 0);
  });
  check("Another object cannot issue somebody else's reserved stock", () => {
    const before = JSON.stringify(hooks.snapshot());
    assert.throws(() => hooks.postMovement(hooks.snapshot(), editor("project", 7, "b")), /Доступно/);
    assert.equal(JSON.stringify(hooks.snapshot()), before);
  });
  post(editor("project", 4));
  check("Own reserved issue releases reserve and does not mark goods installed", () => {
    assert.equal(context.warehouseItems[0].qty, 6);
    const material = context.projects[0].materials[0];
    assert.equal(material.issuedQty, 4);
    assert.equal(material.actualQty, 0);
    assert.equal(material.purchasePriceSnapshot, 105);
    assert.equal(hooks.snapshot().reservations.length, 0);
  });
  post(editor("consume", 2));
  check("Confirmed use changes actual use without reducing central stock twice", () => {
    assert.equal(context.warehouseItems[0].qty, 6);
    assert.equal(context.projects[0].materials[0].issuedQty, 4);
    assert.equal(context.projects[0].materials[0].actualQty, 2);
  });
  check("Over-return rejects installed equipment without partial changes", () => {
    const before = JSON.stringify(hooks.snapshot());
    assert.throws(() => hooks.postMovement(hooks.snapshot(), editor("return", 3)), /ще не використано/);
    assert.equal(JSON.stringify(hooks.snapshot()), before);
  });
  context.warehouseItems[0].purchasePrice = 200;
  ui.capture();
  post(editor("return", 2));
  check("Return values unused goods at historical issue cost and preserves actual use", () => {
    assert.equal(context.warehouseItems[0].qty, 8);
    assert.equal(context.warehouseMovements[0].unitCost, 105);
    assert.equal(context.projects[0].materials[0].issuedQty, 2);
    assert.equal(context.projects[0].materials[0].actualQty, 2);
    assert.equal(context.projects[0].materials[0].purchasePriceSnapshot, 105);
    assert.equal(context.warehouseItems[0].purchasePrice, 180);
  });
  check("Repeated document ID cannot decrement inventory again", () => {
    const doc = context.warehouseMovements[0].documentId;
    const input = editor("project", 1); input.id = doc;
    const before = JSON.stringify(hooks.snapshot());
    assert.throws(() => hooks.postMovement(hooks.snapshot(), input), /уже проведено/);
    assert.equal(JSON.stringify(hooks.snapshot()), before);
  });
  check("Draft fields normalize optional blank costs before receipt posting", () => {
    const doc = hooks.baseDocument(editor("purchase", 2));
    assert.equal(doc.lines[0].deliveryCost, 0);
    assert.equal(doc.lines[0].extraCost, 0);
    const result = core.postReceipt(hooks.snapshot(), doc);
    assert.equal(result.document.type, "purchase");
    assert.equal(result.items[0].qty, 10);
    assert.equal(context.warehouseItems[0].qty, 8);
  });
  check("No stock operation writes or changes the cash ledger", () => {
    assert.equal(storage.get("solarObjectManager.cash.v1.local-sparta"), JSON.stringify({ balance: 60900 }));
  });
  check("Reload reads authoritative inventory and keeps structured product fields", () => {
    context.warehouseItems = [];
    context.warehouseMovements = [];
    ui.bootstrap();
    assert.equal(context.warehouseItems[0].qty, 8);
    assert.equal(context.warehouseItems[0].brand, "Test Brand");
    assert.equal(context.warehouseItems[0].powerW, 450);
    assert.equal(context.warehouseMovements.length, 3);
  });
  check("A full recovery journal rejects new posting before any state mutation", () => {
    failKeys.add(journalKey);
    const before = JSON.stringify(hooks.snapshot());
    assert.throws(() => hooks.persist({ ...hooks.snapshot(), items: [{ ...context.warehouseItems[0], qty: 1 }] }), /не збережено/);
    assert.equal(JSON.stringify(hooks.snapshot()), before);
    failKeys.clear();
  });
  const pendingIssue = hooks.postMovement(hooks.snapshot(), editor("project", 1, "b"));
  failKeys.add(projectKey);
  hooks.persist(pendingIssue);
  check("A failed project mirror leaves a durable joint recovery record", () => {
    const pending = JSON.parse(storage.get(journalKey));
    assert.equal(pending.warehouse.items[0].qty, 7);
    assert.equal(pending.projects[1].materials[0].issuedQty, 1);
    assert.equal(context.warehouseItems[0].qty, 7);
    assert.equal(context.projects[1].materials[0].issuedQty, 1);
  });
  await assert.rejects(hooks.transact((state) => state), /Спочатку звільніть місце/);
  checks.push("New transactions pause while an earlier journal cannot be mirrored");
  failKeys.clear();
  check("Recovery completes inventory and project mirrors together after space is available", () => {
    assert.equal(hooks.recoverJournal(), true);
    assert.equal(storage.get(journalKey), "null");
    assert.equal(JSON.parse(storage.get(projectKey))[1].materials[0].issuedQty, 1);
    assert.equal(JSON.parse(storage.get(stateKey)).items[0].qty, 7);
  });
  context.window.SPARTA_LOCAL_WORKSPACE.enabled = false;
  context.window.SpartaWarehouseCloud = { snapshot: () => ({ items: context.warehouseItems, movements: context.warehouseMovements, reservations: [], documents: [{ id: "draft", type: "purchase", status: "draft", number: "DRAFT", lines: [] }] }) };
  const target = { innerHTML: "" };
  const detail = { innerHTML: "", open: true, setAttribute() {} };
  for (const role of ["engineer", "brigadier", "installer", "viewer"]) {
    context.cloudState.memberRole = role;
    hooks.ui.tab = "stock"; ui.render(target);
    assert.ok(!target.innerHTML.includes('data-wh-action="purchase"'), `${role}: receipt action hidden`);
    assert.ok(!target.innerHTML.includes('data-wh-action="reserve"'), `${role}: reservation action hidden`);
    hooks.ui.tab = "catalog"; ui.render(target);
    assert.ok(!target.innerHTML.includes("data-wh-edit="), `${role}: catalog editing hidden`);
    assert.ok(!target.innerHTML.includes('data-wh-action="new-product"'), `${role}: product creation hidden`);
    hooks.renderItemDetail(detail, "panel");
    assert.ok(!detail.innerHTML.includes("data-wh-edit="), `${role}: detail editing hidden`);
    assert.ok(!detail.innerHTML.includes("data-wh-operation="), `${role}: detail operations hidden`);
    hooks.renderDocumentDetail(detail, "draft");
    assert.ok(!detail.innerHTML.includes("data-wh-resume="), `${role}: draft resuming hidden`);
    await assert.rejects(hooks.transact(() => { throw new Error("Read-only callback must not execute"); }), /доступ до перегляду/);
    assert.throws(() => ui.openForProject("project", { projectId: "a", itemId: "panel" }), /доступ до перегляду/);
  }
  checks.push("Public read-only staff can browse stock/documents but do not see or invoke catalog/posting operations");
  for (const role of ["owner", "admin", "warehouse"]) {
    context.cloudState.memberRole = role;
    hooks.ui.tab = "stock"; ui.render(target);
    assert.ok(target.innerHTML.includes('data-wh-action="purchase"'), `${role}: receipt action available`);
    hooks.ui.tab = "catalog"; ui.render(target);
    assert.ok(target.innerHTML.includes("data-wh-edit="), `${role}: product editing available`);
  }
  checks.push("Owner, admin and warehouse staff retain the catalog and posting actions");
  return { passed: checks.length, checks };
}

if (require.main === module) runWarehouseIntegrationTests(process.argv[2]).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = runWarehouseIntegrationTests;

