"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

async function runTests(directory = path.resolve(__dirname, "..")) {
  const source = fs.readFileSync(path.join(directory, "warehouse-excel-ui.js"), "utf8");
  const excel = require(path.join(directory, "warehouse-excel-core.js")).create(require(path.join(directory, "warehouse-core.js")));
  const clone = value => JSON.parse(JSON.stringify(value));
  const initial = () => ({ revision: 1, items: [{ id: "panel", name: "Панель", sku: "PV", category: "Панелі", brand: "Brand", model: "M", unit: "шт", currency: "USD", qty: 10, purchasePrice: 100, deliveryCost: 5, extraCost: 1, retailPrice: 200, salePrice: 200, installerPrice: 190, wholesalePrice: 180, minQty: 1, location: "Стелаж" }], movements: [], documents: [], reservations: [], orderReservations: [], projects: [] });
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
  function setup(options = {}) {
    let server = initial(), cache = clone(server), blockLoad = null, readsFailing = 0, pending = null;
    const nodes = [], listeners = {}, calls = { loads: 0, transactions: 0, callbacks: 0, commits: 0, settlements: 0, fileReads: 0, fileWrites: 0, renders: 0, homeRenders: 0, downloads: [], blobs: [], alerts: [] };
    function element(tag) {
      return { tag, innerHTML: "", open: false, listeners: {}, dataset: {}, addEventListener(name, fn) { this.listeners[name] = fn; }, showModal() { this.open = true; }, remove() { this.removed = true; }, click() { if (tag === "a") calls.downloads.push(this.download); } };
    }
    const body = { classList: { contains(name) { return name === "auth-locked" && Boolean(options.locked); } }, append(node) { nodes.push(node); } };
    const cloudState = { ready: true, sessionLoading: false, client: {}, user: { id: "owner" }, companyId: "company", memberRole: options.role || "owner", audience: options.audience || "staff" };
    const warehouse = {
      snapshot() { return clone(cache); },
      async transact(callback) {
        calls.transactions++;
        if (pending) { pending = null; calls.settlements++; cache = clone(server); throw new Error("Попередню операцію підтверджено сервером."); }
        calls.callbacks++;
        const next = callback(clone(server));
        if (options.rejectBeforeCommit) { options.rejectBeforeCommit = false; throw Object.assign(new Error("Server rejected the write"), { code: "40001" }); }
        server = { ...clone(next), revision: server.revision + 1 }; cache = clone(server); calls.commits++;
        if (options.loseResponse) { options.loseResponse = false; pending = true; readsFailing = options.failRecoveryRead ? 1 : 0; throw new Error("Connection lost after commit"); }
        return clone(server);
      },
      render() { calls.renders++; },
    };
    const cloud = { async load() { calls.loads++; if (blockLoad) await blockLoad; if (readsFailing > 0) { readsFailing--; throw new Error("Read unavailable"); } cache = clone(server); return clone(cache); } };
    const codec = { create() { return { read(buffer) { calls.fileReads++; return JSON.parse(new TextDecoder().decode(buffer)); }, write(manifest, snapshot) { calls.fileWrites++; calls.exported = { manifest: clone(manifest), snapshot: clone(snapshot) }; return new TextEncoder().encode(JSON.stringify(manifest)); } }; } };
    const sandbox = { window: { SPARTA_LOCAL_WORKSPACE: { enabled: Boolean(options.local) }, XLSX: {}, SpartaWarehouseExcelCore: excel, SpartaWarehouseExcelFile: codec, SpartaWarehouseUI: warehouse, SpartaWarehouseCloud: cloud }, document: { body, head: { append(node) { nodes.push(node); } }, createElement: element, addEventListener(name, fn) { listeners[name] = fn; } }, cloudState, cloudContextRevision: 1, crypto: { subtle: crypto.webcrypto.subtle, randomUUID: crypto.randomUUID }, TextEncoder, TextDecoder, Uint8Array, Blob, Date, Intl, console, setTimeout() {}, URL: { createObjectURL(blob) { calls.blobs.push(blob); return `blob:${calls.blobs.length}`; }, revokeObjectURL() {} }, renderHome() { calls.homeRenders++; }, alert(message) { calls.alerts.push(message); } };
    vm.createContext(sandbox); vm.runInContext(source, sandbox);
    const ui = sandbox.window.SpartaWarehouseExcelUI;
    const dialog = () => nodes.findLast(node => node.tag === "dialog" && !node.removed);
    const settled = async () => {
      const deadline = Date.now() + 2500;
      await flush();
      while (dialog() && /Читаємо Excel|Зберігаємо зміни|Готуємо файл/.test(dialog().innerHTML) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1));
      assert.ok(!dialog() || !/Читаємо Excel|Зберігаємо зміни|Готуємо файл/.test(dialog().innerHTML), "Excel UI asynchronous action did not settle");
    };
    const click = async (action, disabled = false) => { const target = { disabled, dataset: { whExcel: action }, closest() { return this; } }; listeners.click({ target }); await settled(); };
    const manifest = () => excel.snapshot(server, { exportId: "b7b8b478-59be-4fc4-87d9-c2af6d459420", exportedAt: "2026-10-29T08:30:00.000Z", scope: options.local ? "local" : "company:company" });
    const payload = change => { const original = manifest(), rows = clone(original.rows); if (change) change(rows); return { manifest: original, rows }; };
    const file = (parsed = payload(rows => { rows[0].qty = 12; }), extra = {}) => { const bytes = new TextEncoder().encode(JSON.stringify(parsed)); return { name: "Склад.xlsx", size: bytes.length, async arrayBuffer() { return bytes.buffer; }, ...extra }; };
    const triggerChoose = input => listeners.change({ target: { files: [input], matches(selector) { return selector === "[data-wh-excel-file]"; } } });
    const choose = async input => { triggerChoose(input || file()); await settled(); };
    return { ui, sandbox, cloudState, calls, dialog, click, choose, triggerChoose, settled, payload, file, server: () => server, edit(fn) { fn(server); }, blockLoad(promise) { blockLoad = promise; }, nodes };
  }

  const checks = [], check = async (name, fn) => { await fn(); checks.push(name); };
  await check("Import checks current staff role and session; read-only staff can export and local mode works", async () => {
    for (const role of ["engineer", "installer", "viewer"]) { const f = setup({ role }); await assert.rejects(f.ui.open("import"), /Імпортувати/); assert.equal(f.dialog(), undefined); assert.equal(f.calls.transactions, 0); await f.ui.open("export"); assert.equal(f.calls.downloads.length, 1); }
    for (const options of [{ audience: "buyer" }, { locked: true }]) { const f = setup(options); await assert.rejects(f.ui.open("import"), /Увійдіть/); assert.equal(f.calls.loads, 0); }
    for (const change of [state => { state.ready = false; }, state => { state.sessionLoading = true; }, state => { state.user = null; }, state => { state.companyId = null; }]) { const f = setup(); change(f.cloudState); await assert.rejects(f.ui.open("export"), /Увійдіть/); }
    for (const role of ["owner", "admin", "warehouse"]) { const f = setup({ role }); await f.ui.open("import"); assert.ok(f.dialog()); }
    const local = setup({ local: true, role: "viewer", audience: "buyer" }); await local.ui.open("import"); await local.choose(); await local.click("apply"); assert.equal(local.calls.commits, 1); assert.equal(local.calls.loads, 0);
  });
  await check("Export refreshes cloud stock, downloads an editable projection and never writes", async () => {
    const f = setup(); const before = clone(f.server()); f.edit(state => { state.items[0].qty = 9; }); await f.click("export");
    assert.equal(f.calls.loads, 1); assert.equal(f.calls.fileWrites, 1); assert.match(f.calls.downloads[0], /^SPARTA-залишки-.*\.xlsx$/); assert.equal(f.calls.exported.manifest.rows[0].qty, 9); assert.equal(f.calls.exported.manifest.scope, "company:company"); assert.equal(f.calls.exported.manifest.rows[0].purchasePrice, undefined); assert.equal(f.calls.transactions, 0); assert.equal(f.server().documents.length, 0); assert.deepEqual(f.server().items[0], { ...before.items[0], qty: 9 });
  });
  await check("File type, size and parse errors prevent writes; preview remains isolated and escaped", async () => {
    const f = setup(); await f.click("import");
    for (const extra of [{ name: "old.xls" }, { name: "bad.csv" }, { size: 0 }, { size: 5 * 1024 * 1024 + 1 }]) { await f.choose(f.file(undefined, extra)); assert.match(f.dialog().innerHTML, /Виберіть файл .xlsx/); assert.equal(f.calls.fileReads, 0); await f.click("apply"); assert.equal(f.calls.transactions, 0); }
    await f.choose(f.file(undefined, { async arrayBuffer() { return new TextEncoder().encode("not JSON").buffer; } })); assert.match(f.dialog().innerHTML, /role="alert"/); assert.equal(f.calls.transactions, 0);
    const before = clone(f.server()); await f.choose(f.file(f.payload(rows => { rows[0].name = '<img src=x onerror="evil">'; rows[0].qty = 12; })));
    assert.match(f.dialog().innerHTML, /Оновлених товарів: <b>1<\/b>/); assert.match(f.dialog().innerHTML, /&lt;img/); assert.doesNotMatch(f.dialog().innerHTML, /<img src=x/); assert.equal(f.calls.transactions, 0); assert.deepEqual(f.server(), before);
  });
  await check("Apply uses one fresh transaction, preserves historical costs and recognizes replay", async () => {
    const f = setup(); const input = f.file(f.payload(rows => { rows[0].qty = 12; rows[0].retailPrice = 220; })); await f.ui.open("import"); await f.choose(input); await f.click("apply");
    assert.equal(f.calls.commits, 1); assert.equal(f.server().items[0].qty, 12); assert.equal(f.server().items[0].retailPrice, 220); assert.equal(f.server().items[0].purchasePrice, 100); assert.equal(f.server().documents.length, 1); assert.equal(f.server().movements[0].delta, 2); assert.equal(f.server().documents[0].excelScope, "company:company"); assert.equal(f.calls.renders, 1); assert.equal(f.calls.homeRenders, 1);
    await f.click("apply"); assert.equal(f.calls.commits, 1); await f.click("close"); await f.ui.open("import"); await f.choose(input); assert.match(f.dialog().innerHTML, /Зміни вже збережено/); await f.click("apply"); assert.equal(f.calls.commits, 1);
  });
  await check("Fresh transaction rejects stale edits and newly reserved stock without partial changes", async () => {
    const stale = setup(); await stale.ui.open("import"); await stale.choose(); stale.edit(state => { state.items[0].location = "Concurrent edit"; }); const latest = clone(stale.server()); await stale.click("apply"); assert.equal(stale.calls.commits, 0); assert.deepEqual(stale.server(), latest); assert.match(stale.dialog().innerHTML, /після експорту/);
    const reserved = setup(); await reserved.ui.open("import"); await reserved.choose(reserved.file(reserved.payload(rows => { rows[0].qty = 6; }))); reserved.edit(state => { state.reservations = [{ id: "project", itemId: "panel", qty: 3 }]; state.orderReservations = [{ id: "buyer", itemId: "panel", qty: 4 }]; }); const held = clone(reserved.server()); await reserved.click("apply"); assert.equal(reserved.calls.commits, 0); assert.deepEqual(reserved.server(), held); assert.match(reserved.dialog().innerHTML, /менший за резерв/);
  });
  await check("Reset during file or cloud awaits discards stale work without resurrection or download", async () => {
    const reading = setup(); await reading.ui.open("import"); let releaseFile; const bytes = await reading.file().arrayBuffer(); reading.triggerChoose(reading.file(undefined, { arrayBuffer() { return new Promise(resolve => { releaseFile = resolve; }); } })); await flush(); assert.equal(typeof releaseFile, "function"); reading.ui.reset(); releaseFile(bytes); await flush(); assert.equal(reading.dialog(), undefined); assert.equal(reading.calls.transactions, 0); assert.equal(reading.calls.fileReads, 0);
    const loading = setup(); let releaseLoad; loading.blockLoad(new Promise(resolve => { releaseLoad = resolve; })); const exportWork = loading.ui.open("export"); await flush(); loading.ui.reset(); releaseLoad(); await exportWork; assert.equal(loading.dialog(), undefined); assert.equal(loading.calls.downloads.length, 0);
  });
  await check("Account, company, revision and role changes invalidate import before a write", async () => {
    for (const change of [f => { f.cloudState.user.id = "other"; }, f => { f.cloudState.companyId = "other"; }, f => { f.sandbox.cloudContextRevision++; }, f => { f.cloudState.memberRole = "viewer"; }]) { const f = setup(); await f.ui.open("import"); await f.choose(); change(f); await f.click("apply"); assert.equal(f.calls.commits, 0); assert.equal(f.calls.transactions, 0); assert.equal(f.dialog(), undefined); }
    const f = setup(); await f.ui.open("import"); let release; f.blockLoad(new Promise(resolve => { release = resolve; })); f.triggerChoose(f.file()); await flush(); f.cloudState.user.id = "other"; release(); await f.settled(); assert.equal(f.calls.transactions, 0); assert.doesNotMatch(f.dialog()?.innerHTML || "", /data-wh-excel="apply"/);
  });
  await check("A lost response reconciles committed history and pending retry never repeats the callback", async () => {
    const recovered = setup({ loseResponse: true }); await recovered.ui.open("import"); await recovered.choose(); await recovered.click("apply"); assert.equal(recovered.calls.commits, 1); assert.match(recovered.dialog().innerHTML, /Зміни вже збережено/); await recovered.click("apply"); assert.equal(recovered.calls.commits, 1);
    const pending = setup({ loseResponse: true, failRecoveryRead: true }); await pending.ui.open("import"); await pending.choose(); await pending.click("apply"); assert.equal(pending.calls.commits, 1); assert.match(pending.dialog().innerHTML, /Перевірити та завершити/); await pending.click("apply"); assert.equal(pending.calls.settlements, 1); assert.equal(pending.calls.callbacks, 1); assert.equal(pending.calls.commits, 1); assert.equal(pending.server().items[0].qty, 12); assert.match(pending.dialog().innerHTML, /Зміни вже збережено/);
    const rejected = setup({ rejectBeforeCommit: true }); await rejected.ui.open("import"); await rejected.choose(); await rejected.click("apply"); assert.equal(rejected.calls.commits, 0); assert.match(rejected.dialog().innerHTML, /Server rejected/); assert.doesNotMatch(rejected.dialog().innerHTML, /Перевірити та завершити/);
  });
  return { passed: checks.length, checks };
}

module.exports = runTests;
if (require.main === module) runTests(process.argv[2]).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
