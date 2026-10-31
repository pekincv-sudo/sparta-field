"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

module.exports = async function runProjectStockActionsTests(directory = path.resolve(__dirname, "..")) {
  const source = fs.readFileSync(path.join(directory, "project-stock-actions.js"), "utf8");
  const cloudSource = fs.readFileSync(path.join(directory, "warehouse-cloud.js"), "utf8");
  const appSource = fs.readFileSync(path.join(directory, "app.js"), "utf8");
  const core = require(path.join(directory, "warehouse-core.js"));
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const equal = (actual, expected, message) => assert.deepEqual(clone(actual), clone(expected), message);
  const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
  const rejects = (callback, code) => assert.rejects(callback, (error) => error.code === code);
  const items = [
    { id: "pv", name: "Панель", category: "Фотомодулі", unit: "шт", currency: "USD", qty: 10, purchasePrice: 50, deliveryCost: 2, extraCost: 1, retailPrice: 90, installerPrice: 75, salePrice: 85 },
    { id: "pv-other", name: "Панель", category: "Фотомодулі", unit: "шт", currency: "USD", qty: 4, purchasePrice: 20, retailPrice: 0, installerPrice: 30, salePrice: 35 },
    { id: "cable", name: "Кабель", category: "Кабелі", unit: "м", currency: "USD", qty: 100, purchasePrice: 1, retailPrice: 3, installerPrice: 2 },
    { id: "uah", name: "Інвертор", category: "Інвертори", unit: "шт", currency: "UAH", qty: 5, purchasePrice: 1000, retailPrice: 1500 },
    { id: "service", name: "Монтаж", type: "service", category: "Роботи", unit: "шт", currency: "USD", qty: 1, purchasePrice: 1 },
  ];
  const material = { name: "Панель", warehouseItemId: "pv", currency: "USD", unit: "шт", plannedQty: 4, issuedQty: 2, actualQty: 1, purchasePriceSnapshot: 40, salePriceSnapshot: 70, note: "Keep material note" };
  const initialProject = { id: "project", title: "Станція", currency: "USD", status: "proposal", materials: [material],
    finance: { installationPrice: 100, offerLines: [{ id: "old", warehouseItemId: "pv", name: "Old quote", category: "Фотомодулі", currency: "USD", qty: 1, unit: "шт", purchasePrice: 10, salePrice: 20, note: "Keep quote note" }] } };

  async function fixture(options = {}) {
    const storage = new Map();
    const calls = { reads: 0, writes: 0, queue: 0, renders: 0, roles: 0, opens: [], locks: 0 };
    let readHook = null;
    let loseResponse = false;
    let rejectWrite = false;
    let storageFailure = false;
    const requestIds = new Set();
    const server = { revision: 1, state: { version: 1, items: clone(items), reservations: [{ id: "own", itemId: "pv", projectId: "project", qty: 3 }, { id: "other", itemId: "pv", projectId: "other-project", qty: 2 }], documents: [], movements: [] },
      orderReservations: [{ id: "buyer", itemId: "pv", qty: 1 }], projectMaterials: [{ id: "project", token: "m1", materials: [clone(material)] }] };
    const state = { ready: true, user: { id: "owner" }, companyId: "company", memberRole: options.role || "owner", audience: options.audience || "staff", sessionLoading: false };
    const client = { async rpc(name, payload) {
      if (name === "sparta_warehouse_read") { calls.reads++; if (readHook) await readHook(calls.reads); return { data: clone(server), error: null }; }
      assert.equal(name, "sparta_warehouse_write"); calls.writes++;
      if (requestIds.has(payload.p_request_id)) return { data: clone(server), error: null };
      if (rejectWrite) return { data: null, error: { code: "40001", message: "Concurrent change" } };
      if (payload.p_expected_revision !== server.revision) return { data: null, error: { code: "40001", message: "Revision changed" } };
      equal(payload.p_state, server.state, "Planning must not change physical stock, holds, documents or movements");
      for (const update of payload.p_project_updates) {
        const entry = server.projectMaterials.find((project) => project.id === update.id);
        if (update.token !== entry.token) return { data: null, error: { code: "40001", message: "Materials changed" } };
        entry.materials = clone(update.materials); entry.token = crypto.randomUUID();
      }
      server.revision++;
      requestIds.add(payload.p_request_id);
      if (loseResponse) { loseResponse = false; return { data: null, error: { message: "Network response lost" } }; }
      return { data: clone(server), error: null };
    } };
    state.client = client;
    const window = { SPARTA_LOCAL_WORKSPACE: { enabled: Boolean(options.local), companyId: "local-sparta" }, SpartaWarehouseCore: core,
      SpartaWarehouseUI: { snapshot: () => clone({ ...server.state, orderReservations: server.orderReservations }), openForProject(type, value) { calls.opens.push({ type, ...clone(value) }); } } };
    const sandbox = { window, cloudState: state, cloudContextRevision: 1, selectedProjectId: "project", portalMode: "installer", projects: [clone(initialProject)],
      warehouseItems: [], warehouseMovements: [], crypto: crypto.webcrypto, normalizeWarehouseItem: clone,
      writeLocalStorage(key, value) { if (storageFailure) return false; storage.set(key, value); return true; },
      readJsonStorage(key, fallback) { return storage.has(key) ? JSON.parse(storage.get(key)) : fallback; },
      queueCloudSync() { calls.queue++; }, renderDetail() { calls.renders++; }, applyProjectRoleControls() { calls.roles++; },
      isClosedProjectStatus(status) { return ["completed", "passport_issued", "service"].includes(status); },
      navigator: { locks: { async request(name, callback) { assert.equal(name, "sparta-local-warehouse-v31"); calls.locks++; return callback(); } } },
    };
    vm.createContext(sandbox);
    for (const name of ["emptyProjectFinance", "normalizeProjectFinance", "offerLineTotals", "syncCommercialOfferContractPrice"]) {
      const match = appSource.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
      assert.ok(match, `Production helper ${name} exists`); vm.runInContext(match[0], sandbox);
    }
    vm.runInContext(cloudSource, sandbox);
    vm.runInContext(source, sandbox);
    if (!options.local) await window.SpartaWarehouseCloud.load();
    else storage.set("solarObjectManager.projects", JSON.stringify(sandbox.projects));
    return { api: window.SpartaProjectStockActions, sandbox, state, server, calls, storage, window,
      hook(callback) { readHook = callback; }, failStorage() { storageFailure = true; }, failWrite() { rejectWrite = true; }, loseResponse() { loseResponse = true; } };
  }
  const checks = [];
  const check = async (name, callback) => { await callback(); checks.push(name); };
  const offer = (itemId = "pv", qty = 1) => ({ projectId: "project", target: "offer", lines: [{ itemId, qty }] });
  const plan = (itemId = "pv", qty = 1) => ({ projectId: "project", target: "materials", lines: [{ itemId, qty }] });

  await check("Capabilities isolate staff roles, buyer/client views and loading sessions before any read or write", async () => {
    for (const role of ["engineer", "warehouse", "viewer", "installer"]) {
      const f = await fixture({ role }); const before = f.calls.reads;
      await rejects(() => f.api.add(offer()), "PROJECT_STOCK_ACCESS"); assert.equal(f.calls.reads, before); assert.equal(f.calls.writes, 0);
      assert.equal(f.api.context().canPlan, role === "engineer"); assert.equal(f.api.context().canMove, role === "warehouse");
      if (["viewer", "installer"].includes(role)) { await rejects(() => f.api.stock(), "PROJECT_STOCK_ACCESS"); assert.equal(f.calls.reads, before); }
    }
    for (const change of [(f) => { f.state.audience = "buyer"; }, (f) => { f.sandbox.portalMode = "client"; }, (f) => { f.state.sessionLoading = true; }, (f) => { f.state.ready = false; }]) {
      const f = await fixture(); change(f); const before = f.calls.reads;
      assert.equal(f.api.context().ready, false); assert.equal(f.api.project("project"), null);
      await rejects(() => f.api.add(plan()), "PROJECT_STOCK_ACCESS"); assert.equal(f.calls.reads, before);
    }
  });
  await check("Quote batch validation is atomic for missing/service/wrong-currency and invalid quantities", async () => {
    for (const invalid of [{ itemId: "missing", qty: 1 }, { itemId: "service", qty: 1 }, { itemId: "uah", qty: 1 }, { itemId: "pv", qty: 0.5 }, { itemId: "cable", qty: 0.0001 }, { itemId: "pv", qty: -1 }, { itemId: "pv", qty: "NaN" }]) {
      const f = await fixture(); const before = clone(f.sandbox.projects[0].finance);
      await assert.rejects(f.api.add({ ...offer(), lines: [{ itemId: "pv", qty: 1 }, invalid] }));
      equal(f.sandbox.projects[0].finance, before); assert.equal(f.calls.queue, 0); assert.equal(f.calls.writes, 0);
    }
  });
  await check("Quote additions use fresh prices, preserve historical lines and intentional zero, and do not consume stock", async () => {
    const f = await fixture(); const stockBefore = clone(f.server.state); const oldQuote = clone(f.sandbox.projects[0].finance.offerLines[0]);
    f.server.state.items[0].retailPrice = 95;
    const result = await f.api.add({ ...offer(), lines: [{ itemId: "pv", qty: 12 }, { itemId: "pv-other", qty: 1 }, { itemId: "cable", qty: "0,125" }] });
    const finance = f.sandbox.projects[0].finance;
    equal(finance.offerLines[0], oldQuote); assert.equal(finance.offerLines[1].purchasePrice, 53); assert.equal(finance.offerLines[1].salePrice, 95);
    assert.equal(finance.offerLines[2].salePrice, 0); assert.equal(finance.offerLines[3].qty, 0.125);
    assert.equal(finance.contractPrice, 20 + 12 * 95 + 0.125 * 3 + 100); assert.equal(result.count, 3);
    assert.match(result.message, /Залишки складу не змінені/); assert.equal(f.calls.writes, 0); assert.equal(f.calls.queue, 1);
    stockBefore.items[0].retailPrice = 95; equal(f.server.state, stockBefore);
    assert.equal(JSON.parse(f.storage.get("solarObjectManager.projects"))[0].finance.offerLines.length, 4); assert.equal(f.calls.renders, 1); assert.equal(f.calls.roles, 1);
  });
  await check("Material planning is atomic, adds by warehouse ID and preserves issued quantities and historical snapshots", async () => {
    const f = await fixture({ role: "engineer" }); const before = clone(f.server.state);
    const result = await f.api.add({ ...plan(), lines: [{ itemId: "pv", qty: 20 }, { itemId: "pv-other", qty: 1 }, { itemId: "pv-other", qty: 2 }] });
    const materials = f.server.projectMaterials[0].materials;
    equal(materials[0], { ...material, plannedQty: 24 });
    assert.equal(materials.length, 2); assert.equal(materials[1].warehouseItemId, "pv-other"); assert.equal(materials[1].plannedQty, 3);
    assert.equal(materials[1].issuedQty, 0); assert.equal(materials[1].actualQty, 0); assert.equal(materials[1].salePriceSnapshot, 30);
    assert.equal(f.calls.writes, 1); assert.equal(f.calls.queue, 0); equal(f.server.state, before); assert.equal(result.count, 2);
    equal(f.sandbox.projects[0].materials, materials);
  });
  await check("Planning refuses unsaved material edits and stale material versions without overwriting them", async () => {
    const f = await fixture(); f.sandbox.projects[0].materials[0].plannedQty = 8; const before = f.calls.reads;
    await rejects(() => f.api.add(plan()), "PROJECT_STOCK_CONFLICT"); assert.equal(f.calls.reads, before); assert.equal(f.sandbox.projects[0].materials[0].plannedQty, 8); assert.equal(f.calls.writes, 0);
    const stale = await fixture(); const nextRead = stale.calls.reads + 2;
    stale.hook((count) => { if (count === nextRead) { stale.server.projectMaterials[0].materials[0].plannedQty = 11; stale.server.projectMaterials[0].token = "new-version"; } });
    await assert.rejects(stale.api.add(plan()), /Матеріали об’єкта змінилися/);
    assert.equal(stale.server.projectMaterials[0].materials[0].plannedQty, 11); assert.equal(stale.calls.writes, 0);
  });
  await check("Material batch validation and server rejection never partially apply a plan", async () => {
    const f = await fixture(); const before = clone(f.sandbox.projects[0].materials);
    await assert.rejects(f.api.add({ ...plan(), lines: [{ itemId: "pv", qty: 1 }, { itemId: "uah", qty: 1 }] }));
    equal(f.sandbox.projects[0].materials, before); assert.equal(f.calls.writes, 0);
    f.failWrite(); await assert.rejects(f.api.add(plan()));
    equal(f.server.projectMaterials[0].materials, before); equal(f.sandbox.projects[0].materials, before);
  });
  await check("User, company, role, session revision, selected project and reset changes invalidate pending reads", async () => {
    for (const change of [(f) => { f.state.user.id = "other"; }, (f) => { f.state.companyId = "other"; }, (f) => { f.state.memberRole = "viewer"; },
      (f) => { f.sandbox.cloudContextRevision++; }, (f) => { f.sandbox.selectedProjectId = "another"; }, (f) => { f.api.reset(); }]) {
      const f = await fixture(); const hold = deferred(); f.hook(() => hold.promise); const before = clone(f.sandbox.projects[0].finance);
      const task = f.api.add(offer()); change(f); hold.resolve(); await assert.rejects(task);
      equal(f.sandbox.projects[0].finance, before); assert.equal(f.calls.writes, 0); assert.equal(f.calls.queue, 0);
    }
  });
  await check("Overlapping submissions are rejected and the accepted batch is added exactly once", async () => {
    const f = await fixture(); const hold = deferred(); f.hook(() => hold.promise);
    const first = f.api.add(offer()); await rejects(() => f.api.add(offer()), "PROJECT_STOCK_BUSY"); hold.resolve(); await first;
    assert.equal(f.sandbox.projects[0].finance.offerLines.length, 2); assert.equal(f.calls.queue, 1);
  });
  await check("Closed projects and projects closed during an awaited read cannot receive a quote or plan", async () => {
    for (const target of ["offer", "materials"]) {
      const f = await fixture(); f.sandbox.projects[0].status = "service";
      await rejects(() => f.api.add({ ...offer(), target }), "PROJECT_STOCK_CLOSED"); assert.equal(f.calls.writes, 0); assert.equal(f.calls.queue, 0);
      const pending = await fixture(); const hold = deferred(); pending.hook(() => hold.promise);
      const task = pending.api.add({ ...offer(), target }); pending.sandbox.projects[0].status = "completed"; hold.resolve();
      await rejects(() => task, "PROJECT_STOCK_CLOSED"); assert.equal(pending.calls.writes, 0); assert.equal(pending.calls.queue, 0);
    }
  });
  await check("Movement checks own reserve versus global free and opens a prefilled document without posting", async () => {
    const f = await fixture({ role: "warehouse" }); const before = clone(f.server.state);
    await f.api.move({ projectId: "project", itemId: "pv", qty: 7, type: "project" });
    equal(f.calls.opens, [{ type: "project", projectId: "project", itemId: "pv", qty: 7 }]);
    await rejects(() => f.api.move({ projectId: "project", itemId: "pv", qty: 5, type: "reserve" }), "PROJECT_STOCK_SHORTAGE");
    await f.api.move({ projectId: "project", itemId: "pv", qty: 4, type: "reserve" });
    assert.equal(f.calls.opens.length, 2); assert.equal(f.calls.writes, 0); equal(f.server.state, before);
  });
  await check("Fresh stock, currency, closed projects and changed access block opening a movement", async () => {
    const f = await fixture(); f.server.state.items[0].qty = 5;
    await rejects(() => f.api.move({ projectId: "project", itemId: "pv", qty: 3, type: "project" }), "PROJECT_STOCK_SHORTAGE");
    await rejects(() => f.api.move({ projectId: "project", itemId: "uah", qty: 1, type: "project" }), "PROJECT_STOCK_CURRENCY");
    f.sandbox.projects[0].status = "completed";
    await rejects(() => f.api.move({ projectId: "project", itemId: "pv", qty: 1, type: "reserve" }), "PROJECT_STOCK_CLOSED");
    assert.equal(f.calls.opens.length, 0);
    const changed = await fixture(); const hold = deferred(); changed.hook(() => hold.promise);
    const task = changed.api.move({ projectId: "project", itemId: "pv", qty: 1, type: "project" }); changed.sandbox.selectedProjectId = "other"; hold.resolve();
    await assert.rejects(task); assert.equal(changed.calls.opens.length, 0);
  });
  await check("Unavailable cloud stock has no cached quantity fallback", async () => {
    const f = await fixture(); f.window.SpartaWarehouseCloud.invalidate();
    await rejects(() => f.api.stock({ refresh: false }), "PROJECT_STOCK_READ");
    f.window.SpartaWarehouseCloud = { snapshot: () => ({ items: clone(items), reservations: [] }) };
    await rejects(() => f.api.add(offer()), "PROJECT_STOCK_READ"); assert.equal(f.calls.queue, 0);
  });
  await check("Storage failure rejects quote and local plan before mutating the project", async () => {
    const f = await fixture(); const before = clone(f.sandbox.projects[0].finance); f.failStorage();
    await rejects(() => f.api.add(offer()), "PROJECT_STOCK_STORAGE"); equal(f.sandbox.projects[0].finance, before); assert.equal(f.calls.queue, 0);
    const local = await fixture({ local: true }); const localBefore = clone(local.sandbox.projects[0].materials); local.failStorage();
    await rejects(() => local.api.add(plan()), "PROJECT_STOCK_STORAGE"); equal(local.sandbox.projects[0].materials, localBefore);
  });
  await check("Local targeted persistence preserves newer unrelated fields and rejects conflicting material edits", async () => {
    const f = await fixture({ local: true }); const saved = clone(f.sandbox.projects); saved[0].title = "Newer title from another tab"; saved.push({ id: "other", title: "Keep other project" });
    f.storage.set("solarObjectManager.projects", JSON.stringify(saved));
    await f.api.add(plan()); const after = JSON.parse(f.storage.get("solarObjectManager.projects"));
    assert.equal(after[0].title, saved[0].title); assert.equal(after[1].title, saved[1].title); assert.equal(after[0].materials[0].plannedQty, 5);
    assert.equal(f.sandbox.projects[0].materials[0].issuedQty, 2); assert.equal(f.calls.writes, 0); assert.equal(f.calls.queue, 0); assert.equal(f.calls.locks, 1);
    after[0].materials[0].issuedQty = 3; f.storage.set("solarObjectManager.projects", JSON.stringify(after));
    await rejects(() => f.api.add(plan()), "PROJECT_STOCK_CONFLICT"); assert.equal(f.sandbox.projects[0].materials[0].issuedQty, 2);
  });
  await check("A lost plan response is reconciled by existing RPC idempotency without a second addition", async () => {
    const f = await fixture(); f.loseResponse(); await assert.rejects(f.api.add(plan()), /Network response lost/);
    assert.equal(f.server.projectMaterials[0].materials[0].plannedQty, 5);
    await assert.rejects(f.api.add(plan()), /Попередню операцію підтверджено/);
    assert.equal(f.server.projectMaterials[0].materials[0].plannedQty, 5); assert.equal(f.server.revision, 2);
  });
  return { passed: checks.length, checks };
};

if (require.main === module) module.exports().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error); process.exitCode = 1; });
