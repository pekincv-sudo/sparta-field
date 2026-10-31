"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function runTests(directory = path.resolve(__dirname, "..")) {
  const source = fs.readFileSync(path.join(directory, "project-stock-picker.js"), "utf8");
  const core = require(path.join(directory, "warehouse-core.js"));
  const helpers = require(path.join(directory, "project-stock-picker.js"));
  const clone = value => JSON.parse(JSON.stringify(value));
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
  function stock() {
    return { items: [
      { id: "panel", name: "Фотомодуль Solar 580", sku: "PV-580", category: "Панелі", brand: "Solar", model: "M580", characteristics: "двосторонній N-Type", powerW: 580, unit: "шт", currency: "USD", qty: 10, retailPrice: 100, installerPrice: 80, location: "Стелаж А" },
      { id: "inverter", name: "Інвертор Hybrid", sku: "INV-6", category: "Інвертори", brand: "Deye", model: "SUN-6K", characteristics: "гібридний 48В", unit: "шт", currency: "USD", qty: 4, retailPrice: 300, installerPrice: 250 },
      { id: "cable", name: "Кабель PV", sku: "CAB-6", category: "Кабелі", brand: "Solar", crossSectionMm2: 6, unit: "м", currency: "USD", qty: 0, retailPrice: 2, installerPrice: 1 },
      { id: "uah", name: 'АКБ <img src=x onerror="evil">', sku: "UAH-1", category: "АКБ", brand: "Other", unit: "шт", currency: "UAH", qty: 50, retailPrice: 1000 },
      { id: "service", name: "Роботи", category: "Роботи", unit: "шт", currency: "USD", qty: 1, retailPrice: 999 },
    ], reservations: [{ id: "own", itemId: "panel", projectId: "p", qty: 3 }, { id: "other", itemId: "panel", projectId: "other", qty: 2 }], orderReservations: [{ id: "buyer", itemId: "panel", qty: 2 }], documents: [], movements: [] };
  }
  function setup(options = {}) {
    let state = stock(), loadBlock = null, addBlock = null;
    const nodes = [], calls = { stocks: 0, adds: [], moves: [], alerts: [], photos: [] };
    const ctx = { key: "company:owner:revision1", ready: true, canQuote: true, canPlan: true, canMove: true, selectedProjectId: "p", ...options.context };
    const project = { id: "p", title: 'Об’єкт <script>evil</script>', currency: "USD", closed: false, ...options.project };
    const element = tag => {
      let html = "";
      return { tag, open: false, removed: false, listeners: {}, classList: { add() {} },
        set innerHTML(value) { html = value; }, get innerHTML() { return html; },
        setAttribute() {}, addEventListener(name, fn) { this.listeners[name] = fn; }, showModal() { this.open = true; }, close() { this.open = false; this.listeners.close?.(); }, remove() { this.removed = true; },
        querySelector(selector) {
          const region = selector === "[data-psp-footer]" ? "footer" : selector === "[data-psp-list]" ? "section" : null;
          if (region) return { set innerHTML(value) { html = html.replace(new RegExp(`(<${region}[^>]*>)[\\s\\S]*?(</${region}>)`), (_, start, end) => start + value + end); } };
          if (selector === '[data-psp-filter="query"]') return { focus() {} };
          return null;
        }, querySelectorAll() { return []; },
      };
    };
    const document = { createElement: element, body: { append(node) { nodes.push(node); } } };
    const actions = {
      context() { return { ...ctx }; }, project(projectId) { return String(projectId) === project.id ? clone(project) : null; },
      async stock() { calls.stocks++; if (loadBlock) await loadBlock; return clone(state); },
      async add(payload) { calls.adds.push(clone(payload)); if (addBlock) await addBlock; return { message: "Додано до плану. Залишки не змінено." }; },
      async move(payload) { calls.moves.push({ ...clone(payload), pickerClosed: !dialog() }); },
    };
    const window = { document, alert(message) { calls.alerts.push(message); }, SpartaWarehouseCore: core, SpartaProjectStockActions: actions, SpartaProductPhotos: { thumbnailHtml(item) { calls.photos.push(item.id); return '<span class="sp-product-photo" aria-hidden="true"></span>'; } } };
    const sandbox = { window, document, console, Map, Set, Intl };
    vm.createContext(sandbox); vm.runInContext(source, sandbox);
    const ui = window.SpartaProjectStockPicker, dialog = () => nodes.findLast(node => !node.removed);
    const open = async target => { await ui.open({ projectId: "p", target: target || "offer" }); await flush(); };
    const dispatch = (type, target) => dialog()?.listeners[type]?.({ target });
    const click = async (action, extra = {}) => { const target = { disabled: false, dataset: { pspAction: action, ...extra }, closest() { return this; } }; dispatch("click", target); await flush(); };
    const choose = async (itemId, checked = true) => { dispatch("change", { dataset: { pspSelect: itemId }, checked }); await flush(); };
    const filter = async (name, value) => { dispatch(name === "query" ? "input" : "change", { dataset: { pspFilter: name }, value, checked: Boolean(value) }); await flush(); };
    const qty = async (itemId, value) => { dispatch("input", { dataset: { pspQty: itemId }, value, closest() { return null; } }); await flush(); };
    return { ui, ctx, project, calls, dialog, open, click, choose, filter, qty, edit(fn) { fn(state); }, snapshot: () => clone(state), blockLoad(value) { loadBlock = value; }, blockAdd(value) { addBlock = value; } };
  }
  const checks = [], check = async (name, fn) => { await fn(); checks.push(name); };
  await check("Search covers model, SKU, brand and specifications while category and currency scopes compose", async () => {
    const state = stock(), filters = { query: "solar n-type 580", group: "panels", brand: "Solar", freeOnly: true, otherCurrency: false };
    assert.deepEqual(helpers.filterStock(state, filters, "offer", "p", "USD").map(item => item.id), ["panel"]);
    assert.deepEqual(helpers.filterStock(state, { ...filters, query: "PV-580 M580" }, "offer", "p", "USD").map(item => item.id), ["panel"]);
    assert.equal(helpers.filterStock(state, { ...filters, group: "inverters" }, "offer", "p", "USD").length, 0);
    assert.equal(helpers.filterStock(state, { query: "", freeOnly: false, otherCurrency: true }, "offer", "p", "USD").length, 4);
  });
  await check("Offer uses global free stock; materials add back only this project's own reservations", async () => {
    const state = stock(), panel = state.items[0];
    assert.equal(helpers.availabilityFor(panel, state, "offer", "p"), 3);
    assert.equal(helpers.availabilityFor(panel, state, "materials", "p"), 6);
    state.items[0].qty = 7;
    assert.equal(helpers.filterStock(state, { freeOnly: true }, "offer", "p", "USD").some(item => item.id === "panel"), false);
    assert.equal(helpers.filterStock(state, { freeOnly: true }, "materials", "p", "USD").some(item => item.id === "panel"), true);
  });
  await check("Totals preserve explicit zero prices, validate units and warn without rejecting plans over stock", async () => {
    const state = stock(); state.items[0].retailPrice = 0;
    assert.equal(helpers.priceFor(state.items[0], "offer"), 0);
    assert.equal(helpers.priceFor(state.items[0], "materials"), 80);
    let summary = helpers.summarize(state, new Map([["panel", "11"]]), "offer", "p", "USD");
    assert.equal(summary.errors.length, 0); assert.equal(summary.shortages[0].shortage, 8); assert.equal(summary.lines[0].qty, 11); assert.equal(summary.total, 0);
    summary = helpers.summarize(state, new Map([["panel", "1,5"], ["cable", "1,125"]]), "materials", "p", "USD");
    assert.equal(summary.errors.length, 1); assert.equal(summary.lines[0].qty, 1.125); assert.equal(summary.total, 1.125);
    for (const raw of ["", "0", "-1", "Infinity", "1.0001"]) assert.ok(helpers.summarize(state, new Map([["cable", raw]]), "materials", "p", "USD").errors.length);
    assert.match(helpers.summarize(state, new Map([["uah", "1"]]), "offer", "p", "USD").errors[0], /валюта/);
  });
  await check("Opening refreshes stock, defaults to free same-currency equipment, escapes text and cancels without writes", async () => {
    const f = setup(), before = f.snapshot(); await f.open();
    assert.equal(f.calls.stocks, 1); assert.match(f.dialog().innerHTML, /data-psp-filter="freeOnly" checked/); assert.match(f.dialog().innerHTML, /data-psp-card="panel"/);
    assert.doesNotMatch(f.dialog().innerHTML, /data-psp-card="(?:uah|cable|service)"/); assert.match(f.dialog().innerHTML, /&lt;script&gt;/); assert.doesNotMatch(f.dialog().innerHTML, /<script>/);
    assert.match(f.dialog().innerHTML, /не резервує й не списує/); assert.ok(f.calls.photos.includes("panel"));
    await f.choose("panel"); f.dialog().listeners.cancel({ preventDefault() {} });
    assert.equal(f.dialog(), undefined); assert.equal(f.calls.adds.length, 0); assert.equal(f.calls.moves.length, 0); assert.deepEqual(f.snapshot(), before);
  });
  await check("Selections and exact typed quantities survive search, categories and refreshed availability", async () => {
    const f = setup(); await f.open(); await f.qty("panel", "7");
    await f.filter("query", "SUN-6K"); assert.match(f.dialog().innerHTML, /Поза поточним фільтром: 1/);
    await f.choose("inverter"); await f.click(undefined, { pspGroup: "batteries" });
    assert.match(f.dialog().innerHTML, /Обрано позицій: 2/);
    f.edit(state => { state.items[0].qty = 0; }); await f.click("refresh");
    assert.match(f.dialog().innerHTML, /Обрано позицій: 2/); await f.click("add");
    assert.deepEqual(f.calls.adds[0], { projectId: "p", target: "offer", lines: [{ itemId: "panel", qty: 7 }, { itemId: "inverter", qty: 1 }] });
    assert.equal(f.calls.moves.length, 0); assert.match(f.dialog().innerHTML, /Додано до плану/); assert.match(f.dialog().innerHTML, /Обрано позицій: 0/);
    await f.click("add"); assert.equal(f.calls.adds.length, 1);
  });
  await check("Foreign-currency inventory is view-only and never enters a project's selection or total", async () => {
    const f = setup(); await f.open(); await f.filter("otherCurrency", true);
    assert.match(f.dialog().innerHTML, /data-psp-select="uah"\s+disabled/); assert.match(f.dialog().innerHTML, /АКБ &lt;img/); assert.doesNotMatch(f.dialog().innerHTML, /<img src=x/);
    assert.match(f.dialog().innerHTML, /Товар у UAH, проєкт у USD/);
    await f.choose("uah"); await f.qty("uah", "2"); await f.click("add"); assert.equal(f.calls.adds.length, 0); assert.match(f.dialog().innerHTML, /Обрано позицій: 0/);
  });
  await check("Invalid quantities block add; valid fractional units and shortages remain plan-only", async () => {
    const f = setup(); await f.open("materials"); await f.qty("panel", "1.5"); await f.click("add");
    assert.equal(f.calls.adds.length, 0); assert.match(f.dialog().innerHTML, /ціла кількість/);
    await f.qty("panel", "12"); await f.click("add"); assert.equal(f.calls.adds[0].target, "materials"); assert.equal(f.calls.adds[0].lines[0].qty, 12); assert.equal(f.calls.moves.length, 0);
    await f.filter("freeOnly", false); await f.qty("cable", "1,125"); await f.click("add"); assert.equal(f.calls.adds[1].lines[0].qty, 1.125);
  });
  await check("Materials reserve and issue require one selection, respect hold ownership and close before document handoff", async () => {
    const reserved = setup(); await reserved.open("materials"); await reserved.qty("panel", "4"); await reserved.click("reserve"); assert.equal(reserved.calls.moves.length, 0); assert.match(reserved.dialog().innerHTML, /Недостатньо/);
    await reserved.qty("panel", "3"); await reserved.click("reserve"); assert.deepEqual(reserved.calls.moves[0], { projectId: "p", itemId: "panel", qty: 3, type: "reserve", pickerClosed: true });
    const issued = setup(); await issued.open("materials"); await issued.qty("panel", "6"); await issued.click("project"); assert.deepEqual(issued.calls.moves[0], { projectId: "p", itemId: "panel", qty: 6, type: "project", pickerClosed: true }); assert.equal(issued.calls.adds.length, 0);
    const multiple = setup(); await multiple.open("materials"); await multiple.choose("panel"); await multiple.choose("inverter"); await multiple.click("project"); assert.equal(multiple.calls.moves.length, 0);
    const offer = setup(); await offer.open(); await offer.choose("panel"); await offer.click("project"); assert.equal(offer.calls.moves.length, 0);
  });
  await check("Read-only, closed and changed-project launch attempts do not leave a picker or make calls", async () => {
    for (const options of [{ context: { ready: false } }, { context: { canQuote: false } }, { context: { selectedProjectId: "other" } }, { project: { closed: true } }]) {
      const f = setup(options); await f.open(); assert.equal(f.dialog(), undefined); assert.equal(f.calls.stocks, 0); assert.equal(f.calls.alerts.length, 1);
    }
    const moveOnly = setup({ context: { canPlan: false, canMove: true } }); await moveOnly.open("materials"); await moveOnly.choose("panel"); await moveOnly.click("add"); assert.equal(moveOnly.calls.adds.length, 0); assert.equal(moveOnly.dialog(), undefined);
  });
  await check("Account, company, role, currency and selection changes invalidate idle and pending work", async () => {
    for (const change of [f => { f.ctx.key = "other-user"; }, f => { f.ctx.ready = false; }, f => { f.ctx.canQuote = false; }, f => { f.ctx.selectedProjectId = "other"; }, f => { f.project.currency = "UAH"; }, f => { f.project.closed = true; }]) {
      const f = setup(); await f.open(); await f.choose("panel"); change(f); await f.click("add"); assert.equal(f.calls.adds.length, 0); assert.equal(f.dialog(), undefined);
    }
    const idle = setup(); await idle.open(); idle.ctx.key = "other-company"; assert.equal(idle.ui.refreshAccess(), false); assert.equal(idle.dialog(), undefined);
    const loading = setup(); let release; loading.blockLoad(new Promise(resolve => { release = resolve; })); const work = loading.open(); await flush(); loading.ctx.key = "other-company"; release(); await work; assert.equal(loading.dialog(), undefined);
  });
  await check("Reset during stock or add awaits discards private state without resurrecting a dialog", async () => {
    const f = setup(); let release; f.blockLoad(new Promise(resolve => { release = resolve; })); const work = f.open(); await flush(); f.ui.reset(); release(); await work; assert.equal(f.dialog(), undefined); assert.equal(f.calls.adds.length, 0);
    const saving = setup(); await saving.open(); await saving.choose("panel"); let finish; saving.blockAdd(new Promise(resolve => { finish = resolve; })); await saving.click("add"); saving.ui.reset(); finish(); await flush(); assert.equal(saving.dialog(), undefined); assert.equal(saving.calls.adds.length, 1);
    await saving.open(); assert.match(saving.dialog().innerHTML, /Обрано позицій: 0/); assert.doesNotMatch(saving.dialog().innerHTML, /Додано до плану/);
  });
  return { passed: checks.length, checks };
}
module.exports = runTests;
if (require.main === module) runTests(process.argv[2]).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
