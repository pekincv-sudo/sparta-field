"use strict";
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path").resolve(__dirname, "..");
const cashSource = fs.readFileSync(path + "/cash-ledger.js", "utf8");
const bookSource = fs.readFileSync(path + "/cash-book.js", "utf8");
let harnessUuid = 0;

function harness(storage = new Map(), remote = null, options = {}) {
  const events = {};
  const cashView = { innerHTML: "" };
  const dialog = { close() {} };
  const nav = { classList: { toggle() {} } };
  const localMode = Boolean(options.localMode);
  const state = { client: null, user: { id: localMode ? "local-owner" : "owner-1" }, ready: !localMode,
    memberRole: "owner", companyId: localMode ? "local-sparta" : "company-1" };
  const submit = { disabled: false };
  const error = { textContent: "" };
  const writes = [];
  const fromCalls = [];
  const client = {
    from(table) {
      fromCalls.push(table);
      const request = {
        select() { return request; }, eq() { return request; }, order() { return request; },
        async range() { return remote === null ? { data: null, error: { code: "PGRST205", message: "cash_transactions missing" } } : { data: remote, error: null }; },
        async upsert(row) {
          if (remote === null) return { error: { code: "PGRST205", message: "cash_transactions missing" } };
          writes.push(row.id);
          if (!remote.some((item) => item.id === row.id)) remote.push({ ...row, created_at: "2026-10-24T13:00:00.123456+00:00", created_by: "owner-1" });
          return { error: null };
        },
        async single() { return { data: remote[remote.length - 1], error: null }; },
      };
      return request;
    },
  };
  state.client = client;
  const context = vm.createContext({
    window: { SPARTA_LOCAL_WORKSPACE: { enabled: localMode }, addEventListener() {} }, document: {
      querySelector(selector) {
        if (selector === "#cashView") return cashView;
        if (selector === "#cashEntryDialog") return dialog;
        if (selector === '[data-section="cash"]') return nav;
        return null;
      },
      addEventListener(name, callback) { (events[name] ||= []).push(callback); },
    },
    cloudState: state, portalMode: "installer", projects: [{ id: "taras", currency: "USD", title: "Тарас Сусід", clientName: "Тарас", finance: { advancePaid: 500 } }],
    readJsonStorage(key, fallback) { return storage.has(key) ? JSON.parse(storage.get(key)) : fallback; },
    writeLocalStorage(key, value) { storage.set(key, value); return true; },
    crypto: { randomUUID() { return "00000000-0000-4000-8000-" + String(++harnessUuid).padStart(12, "0"); } },
    FormData: class { constructor(form) { this.data = form.data; } get(key) { return this.data[key] || ""; } },
    renderHome() {}, renderDetail() {}, showSection() {}, money(value) { return value + " грн"; },
    Date, Intl, URL, Blob, setTimeout, Map, console,
  });
  vm.runInContext(cashSource, context);
  vm.runInContext(bookSource, context);
  const book = context.window.SpartaCashBook;
  book.refreshAccess();
  async function post(overrides = {}) {
    const form = {
      id: "cashEntryForm",
      data: { currency: "USD", direction: "income", category: "client_payment", amount: "1000,25", occurredAt: "2026-10-24T12:30", counterparty: "Тарас", projectId: "taras", method: "cash", purpose: "Аванс за станцію", ...overrides },
      querySelector(selector) { return selector === '[type="submit"]' ? submit : error; },
    };
    for (const listener of events.submit) listener({ target: form, preventDefault() {} });
    await book.sync();
    await Promise.resolve();
    return error.textContent;
  }
  return { book, post, state, storage, cashView, writes, fromCalls, context };
}

async function runCashBookIntegrationTests() {
  let checks = 0;
  const local = harness(new Map(), null, { localMode: true });
  assert.equal(local.state.ready, false);
  assert.equal(await local.post(), "");
  assert.equal(local.book.projectTotals("taras").clientPaidMinor, 100025);
  assert.equal(local.fromCalls.length, 0);
  const localStored = JSON.parse(local.storage.get("solarObjectManager.cash.v1.local-sparta"));
  assert.equal(localStored.entries.length, 1);
  assert.equal(localStored.entries[0].companyId, "local-sparta");
  assert.equal(localStored.entries[0].createdBy, "local-owner");
  assert.equal(localStored.entries[0].occurredAt, "2026-10-24T09:30:00.000Z");
  assert.equal(localStored.pendingIds.length, 0);
  assert.match(local.cashView.innerHTML, /Локальна каса\. Дані збережені на цьому комп’ютері\./);
  assert.doesNotMatch(local.cashView.innerHTML, /Очікують синхронізації|На пристрої/);
  checks++;

  const reopenedLocal = harness(local.storage, [], { localMode: true });
  assert.equal(reopenedLocal.book.projectTotals("taras").clientPaidMinor, 100025);
  await reopenedLocal.book.sync();
  assert.equal(reopenedLocal.fromCalls.length, 0);
  checks++;

  const scoped = harness(new Map(), null, { localMode: true });
  assert.equal(await scoped.post({ purpose: "Клієнтський аванс" }), "");
  assert.equal(await scoped.post({ direction: "expense", category: "client_refund", amount: "25", purpose: "Повернення за договором" }), "");
  assert.equal(await scoped.post({ direction: "expense", category: "labor", amount: "400", purpose: "Прихована зарплата" }), "");
  assert.equal(await scoped.post({ direction: "expense", category: "materials", amount: "300", purpose: "Приховані матеріали" }), "");
  const scopeEntries = JSON.parse(scoped.storage.get("solarObjectManager.cash.v1.local-sparta")).entries;
  assert.equal(await scoped.post({ reversesId: scopeEntries.find((entry) => entry.category === "client_payment").id, reason: "Скасування платежу клієнта" }), "");
  assert.equal(await scoped.post({ reversesId: scopeEntries.find((entry) => entry.category === "client_refund").id, reason: "Скасування повернення клієнту" }), "");
  const scopeProject = scoped.context.projects[0];
  const clientMarkup = scoped.book.projectMarkup(scopeProject, { clientOnly: true });
  assert.match(clientMarkup, /<h3>Оплати клієнта<\/h3>/);
  assert.equal((clientMarkup.match(/data-cash-add/g) || []).length, 1);
  assert.match(clientMarkup, /data-cash-client-only>Додати оплату<\/button>/);
  assert.match(clientMarkup, /Клієнтський аванс/);
  assert.match(clientMarkup, /Повернення клієнту/);
  assert.match(clientMarkup, /Повернення за договором/);
  assert.match(clientMarkup, /Сторнування: Скасування платежу клієнта/);
  assert.match(clientMarkup, /Сторнування: Скасування повернення клієнту/);
  assert.doesNotMatch(clientMarkup, /Прихована зарплата|Приховані матеріали|Виплата бригаді|Оплата матеріалів/);
  assert.doesNotMatch(clientMarkup, /Платежі клієнта в журналі|Аванс до запуску журналу|Оплата \/ витрата/);
  assert.match(clientMarkup, /<details class="cash-client-history"><summary>Історія оплат · 4<\/summary>/);
  assert.doesNotMatch(clientMarkup.match(/<details[^>]*>/)[0], /\bopen\b/);
  assert.match(clientMarkup, /data-cash-open-project="taras"/);
  const defaultMarkup = scoped.book.projectMarkup(scopeProject);
  assert.equal(defaultMarkup, scoped.book.projectMarkup(scopeProject, {}));
  assert.match(defaultMarkup, /Прихована зарплата/);
  assert.match(defaultMarkup, /Приховані матеріали/);
  assert.match(defaultMarkup, /Платежі клієнта в журналі/);
  assert.match(defaultMarkup, /\+ Оплата \/ витрата/);
  assert.doesNotMatch(defaultMarkup, /cash-client-history|data-cash-client-only/);
  scoped.state.memberRole = "admin";
  assert.match(scoped.book.projectMarkup(scopeProject, { clientOnly: true }), /Оплати клієнта/);
  scoped.state.memberRole = "installer";
  assert.equal(scoped.book.projectMarkup(scopeProject, { clientOnly: true }), "");
  assert.equal(scoped.book.projectMarkup(scopeProject), "");
  checks++;

  // Both tabs read the empty journal before either saves; no storage event is
  // delivered, so tab B must merge the current persisted ledger during append.
  const sharedLocalStorage = new Map();
  const tabA = harness(sharedLocalStorage, null, { localMode: true });
  const tabB = harness(sharedLocalStorage, null, { localMode: true });
  assert.equal(await tabA.post({ amount: "101.11", purpose: "Оплата у вкладці A" }), "");
  assert.equal(await tabB.post({ amount: "202,22", purpose: "Оплата у вкладці B" }), "");
  const sharedStored = JSON.parse(sharedLocalStorage.get("solarObjectManager.cash.v1.local-sparta"));
  assert.equal(sharedStored.entries.length, 2);
  assert.equal(new Set(sharedStored.entries.map((entry) => entry.id)).size, 2);
  assert.equal(sharedStored.pendingIds.length, 0);
  const reopenedTabs = harness(sharedLocalStorage, null, { localMode: true });
  assert.equal(reopenedTabs.book.projectTotals("taras").clientPaidMinor, 30333);
  assert.equal(tabA.fromCalls.length + tabB.fromCalls.length + reopenedTabs.fromCalls.length, 0);
  checks++;

  const offline = harness();
  assert.equal(await offline.post(), "");
  assert.equal(offline.book.projectTotals("taras").clientPaidMinor, 100025);
  assert.match(offline.cashView.innerHTML, /На пристрої/);
  const stored = JSON.parse([...offline.storage.values()][0]);
  assert.equal(stored.entries.length, 1);
  assert.equal(stored.pendingIds.length, 1);
  checks++;

  const reopened = harness(offline.storage);
  assert.equal(reopened.book.projectTotals("taras").clientPaidMinor, 100025);
  checks++;

  assert.equal(await offline.post({ amount: "50,25", direction: "expense", category: "client_refund", purpose: "Повернення частини авансу" }), "");
  assert.equal(offline.book.projectTotals("taras").clientPaidMinor, 95000);
  checks++;

  const firstId = JSON.parse([...offline.storage.values()][0]).entries[0].id;
  assert.equal(await offline.post({ reversesId: firstId, reason: "Тестове виправлення помилки" }), "");
  assert.equal(offline.book.projectTotals("taras").clientPaidMinor, -5025);
  checks++;

  const liveRows = [];
  const online = harness(offline.storage, liveRows);
  await online.book.sync();
  assert.equal(liveRows.length, 3);
  assert.equal(JSON.parse([...online.storage.values()][0]).pendingIds.length, 0);
  assert.equal(online.book.projectTotals("taras").clientPaidMinor, -5025);
  assert.match(online.cashView.innerHTML, /Журнал синхронізовано/);
  checks++;

  await online.book.sync();
  assert.equal(liveRows.length, 3);
  assert.equal(online.writes.length, 3);
  checks++;

  const competing = harness();
  assert.equal(await competing.post(), "");
  const competingOriginal = JSON.parse([...competing.storage.values()][0]).entries[0];
  assert.equal(await competing.post({ reversesId: competingOriginal.id, reason: "Локальне виправлення" }), "");
  const competingReverse = JSON.parse([...competing.storage.values()][0]).entries[1];
  const toRemote = (entry) => ({ id: entry.id, company_id: entry.companyId, project_client_id: entry.projectId,
    project_title: entry.projectTitle, direction: entry.direction, category: entry.category,
    amount_minor: entry.amountMinor, currency: entry.currency, counterparty: entry.counterparty, purpose: entry.purpose,
    occurred_at: entry.occurredAt, payment_method: entry.method, created_at: entry.createdAt,
    created_by: "owner-1", reverses_id: entry.reversesId });
  const competingRemote = [toRemote(competingOriginal), toRemote({ ...competingReverse,
    id: "00000000-0000-4000-8000-999999999999", purpose: "Підтверджене виправлення на іншому пристрої" })];
  const reconciled = harness(competing.storage, competingRemote);
  await reconciled.book.sync();
  assert.equal(reconciled.book.projectTotals("taras").clientPaidMinor, 0);
  assert.equal(reconciled.writes.length, 0);
  assert.equal(competingRemote.length, 2);
  const reconciledStored = JSON.parse([...reconciled.storage.values()][0]);
  assert.equal(reconciledStored.entries.length, 2);
  assert.equal(reconciledStored.pendingIds.length, 0);
  assert(reconciledStored.entries.some((entry) => entry.id === "00000000-0000-4000-8000-999999999999"));
  assert.match(reconciled.cashView.innerHTML, /іншому пристрої/);
  checks++;

  online.state.memberRole = "installer";
  assert.equal(online.book.projectTotals("taras").clientPaidMinor, 0);
  online.book.renderView();
  assert.equal(online.cashView.innerHTML, "");
  checks++;

  const appSource = fs.readFileSync(path + "/app.js", "utf8");
  const start = appSource.indexOf("function projectFinanceTotals(");
  const end = appSource.indexOf("\nfunction warehouseTotals(", start);
  online.state.memberRole = "owner";
  online.context.normalizeProjectFinance = (finance) => ({ expenses: [], contractPrice: 2000, crewPayroll: 100, ...finance });
  online.context.projectMaterialsWithWarehousePrices = () => [{ currency: "USD", qty: 1, purchasePrice: 700, salePrice: 1000 }];
  vm.runInContext(appSource.slice(start, end), online.context);
  const totals = vm.runInContext("projectFinanceTotals(projects[0])", online.context);
  assert.equal(totals.receivedPayments, 449.75);
  assert.equal(totals.balanceDue, 1550.25);
  assert.equal(totals.profit, 1200);
  checks++;

  local.context.normalizeProjectFinance = online.context.normalizeProjectFinance;
  local.context.projectMaterialsWithWarehousePrices = online.context.projectMaterialsWithWarehousePrices;
  vm.runInContext(appSource.slice(start, end), local.context);
  const localTotals = vm.runInContext("projectFinanceTotals(projects[0])", local.context);
  assert.equal(localTotals.receivedPayments, 1500.25);
  assert.equal(localTotals.balanceDue, 499.75);
  assert.equal(localTotals.profit, 1200);
  assert.equal(local.fromCalls.length, 0);
  checks++;

  return { passed: checks, scenarios: "isolated local mode with zero cloud calls, local reload and Kyiv time, two-tab append retention, offline persistence, refund, reversal, cloud replay, retry deduplication, concurrent reversal reconciliation, role isolation, legacy advance and profitability" };
}
module.exports = runCashBookIntegrationTests;
