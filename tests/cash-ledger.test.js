"use strict";

const assert = require("node:assert/strict");
const Cash = require("../cash-ledger.js");

function runCashLedgerTests() {
  let checks = 0;
  function check(name, fn) { fn(); checks += 1; }
  const now = "2026-10-24T12:00:00.000Z";
  function payment(overrides) {
    return Cash.createEntry(Object.assign({ id: "payment-1", currency: "UAH", companyId: "sparta", projectId: "taras", projectTitle: "Тарас Сусід",
      direction: "income", category: "client_payment", amount: "1000,10", counterparty: "Тарас", purpose: "Аванс за станцію",
      occurredAt: "2026-10-23T10:15:00+03:00", method: "cash", createdBy: "owner" }, overrides), { now: now });
  }

  check("decimal amounts preserve kopecks without floating point rounding", function () {
    assert.equal(Cash.parseAmount("0.29"), 29);
    assert.equal(Cash.parseAmount(" 123456,78 "), 12345678);
    assert.equal(Cash.parseAmount("001.2"), 120);
    assert.equal(Cash.parseAmount(1.01), 101);
    assert.equal(Cash.formatAmount(-12345678, "UAH"), "−123\u00a0456,78 грн");
  });
  check("ambiguous, negative, zero, oversized and overprecise amounts are rejected", function () {
    ["", "0", "-1", "+2", "1,000.00", "1.005", "1e4", "NaN", Infinity, null, "90071992547410.00"].forEach(function (value) {
      assert.throws(function () { Cash.parseAmount(value); });
    });
  });
  check("entry is a frozen scalar snapshot and dates are canonical UTC", function () {
    const raw = { projectTitle: " Тарас Сусід " };
    const entry = payment(raw);
    raw.projectTitle = "Changed";
    assert.equal(entry.projectTitle, "Тарас Сусід");
    assert.equal(entry.occurredAt, "2026-10-23T07:15:00.000Z");
    assert.equal(entry.createdAt, now);
    assert.equal(entry.amountMinor, 100010);
    assert(Object.isFrozen(entry));
    assert.throws(function () { entry.amountMinor = 1; }, TypeError);
  });
  check("invalid category, category direction, dates, method and required fields fail", function () {
    [ { category: "unknown" }, { direction: "expense" }, { category: "opening_balance", direction: "expense" }, { method: "bitcoin" }, { amountMinor: 0.1 }, { amountMinor: 0 },
      { occurredAt: "2026-02-30T10:00:00Z" }, { occurredAt: "2026-10-23T10:00" }, { counterparty: " " }, { projectTitle: "" },
      { companyId: "" }, { purpose: "" }, { createdBy: "" } ].forEach(function (override) {
      assert.throws(function () { payment(override); });
    });
  });
  check("partial payments, refunds and project costs remain distinct", function () {
    const entries = [payment(), payment({ id: "payment-2", amount: "499,90" }),
      payment({ id: "refund", category: "client_refund", direction: "expense", amount: "100" }),
      payment({ id: "labor", category: "labor", direction: "expense", amount: "200" }),
      payment({ id: "material", category: "materials", direction: "expense", amount: "300" }),
      payment({ id: "fuel", category: "other_expense", direction: "expense", amount: "50" }),
      payment({ id: "other-project", projectId: "other", amount: "99" }) ];
    assert.deepEqual(Cash.totals(entries), { incomeMinor: 159900, expenseMinor: 65000, balanceMinor: 94900 });
    assert.deepEqual(Cash.projectTotals(entries, "taras"), { clientPaidMinor: 140000, recordedPayrollMinor: 20000,
      recordedExpensesMinor: 5000, materialsMinor: 30000, otherExpensesMinor: 5000 });
  });
  check("reversal preserves original facts, offsets balance and client paid total", function () {
    const original = payment();
    const reverse = Cash.reversal([original], original, { id: "reverse", now: now, createdBy: "owner", purpose: "Помилкова сума" });
    assert.equal(reverse.reversesId, original.id);
    assert.equal(reverse.direction, "expense");
    assert.equal(reverse.amountMinor, original.amountMinor);
    assert.equal(reverse.projectId, original.projectId);
    assert.equal(reverse.category, original.category);
    assert.equal(Cash.totals([original, reverse]).balanceMinor, 0);
    assert.equal(Cash.projectTotals([original, reverse], "taras").clientPaidMinor, 0);
    assert.equal(original.amountMinor, 100010);
    assert.equal(Cash.validateLedger([reverse, original]).length, 2);
  });
  check("expense reversals remove project costs rather than counting as client payments", function () {
    const original = payment({ id: "labor", category: "labor", direction: "expense", amount: "29,99" });
    const reverse = Cash.reversal([original], original.id, { id: "reverse", now: now, createdBy: "owner", purpose: "Виправлення" });
    const result = Cash.projectTotals([original, reverse], "taras");
    assert.equal(result.recordedPayrollMinor, 0);
    assert.equal(result.clientPaidMinor, 0);
  });
  check("duplicate entries and duplicate, orphaned or tampered reversals fail", function () {
    const original = payment();
    const reverse = Cash.reversal([original], original.id, { id: "reverse", now: now, createdBy: "owner", purpose: "Виправлення" });
    assert.throws(function () { Cash.validateLedger([original, original]); });
    assert.throws(function () { Cash.validateLedger([reverse]); });
    assert.throws(function () { Cash.validateLedger([original, reverse, Object.assign({}, reverse, { id: "again" })]); });
    assert.throws(function () { Cash.validateLedger([original, Object.assign({}, reverse, { amountMinor: 1 })]); });
    assert.throws(function () { Cash.validateLedger([original, Object.assign({}, reverse, { projectTitle: "Інший об’єкт" })]); });
    assert.throws(function () { Cash.reversal([original, reverse], original.id, { id: "again", now: now, createdBy: "owner", purpose: "Again" }); });
    assert.throws(function () { Cash.reversal([original, reverse], reverse.id, { id: "again", now: now, createdBy: "owner", purpose: "Again" }); });
    assert.throws(function () { Cash.reversal([original], "missing", {}); });
  });
  check("date-only filters include an entire Kyiv calendar day independent of host timezone", function () {
    const localStart = new Date("2026-10-22T21:00:00.000Z");
    const nextStart = new Date("2026-10-23T21:00:00.000Z");
    const before = payment({ id: "before", occurredAt: new Date(localStart.getTime() - 1).toISOString() });
    const first = payment({ id: "first", occurredAt: localStart.toISOString() });
    const last = payment({ id: "last", occurredAt: new Date(nextStart.getTime() - 1).toISOString() });
    const after = payment({ id: "after", occurredAt: nextStart.toISOString() });
    const entries = [before, first, last, after];
    assert.deepEqual(Cash.filterEntries(entries, { from: "2026-10-23", to: "2026-10-23" }).map(function (entry) { return entry.id; }), ["last", "first"]);
    assert.deepEqual(entries.map(function (entry) { return entry.id; }), ["before", "first", "last", "after"]);
    assert.throws(function () { Cash.filterEntries(entries, { from: "2026-10-24", to: "2026-10-23" }); });
    assert.throws(function () { Cash.filterEntries(entries, { from: "2026-02-30" }); });
  });
  check("query, project and payment method filters combine", function () {
    const entries = [payment(), payment({ id: "bank", method: "bank" }), payment({ id: "other", projectId: "other" })];
    assert.deepEqual(Cash.filterEntries(entries, { projectId: "taras", method: "bank", direction: "income", query: "СУСІД" }).map(function (entry) { return entry.id; }), ["bank"]);
  });
  check("unassigned project filter includes only general cash entries", function () {
    const entries = [payment(), payment({ id: "general", projectId: null, projectTitle: "", category: "opening_balance" })];
    assert.deepEqual(Cash.filterEntries(entries, { projectId: "__none" }).map(function (entry) { return entry.id; }), ["general"]);
  });
  check("Kyiv datetime conversion follows seasonal offsets without host timezone dependence", function () {
    assert.equal(Cash.parseKyivDateTime("2026-10-24T15:45"), "2026-10-24T12:45:00.000Z");
    assert.equal(Cash.parseKyivDateTime("2026-11-01T15:45"), "2026-11-01T13:45:00.000Z");
    assert.equal(Cash.parseKyivDateTime("2026-10-25T03:30"), "2026-10-25T00:30:00.000Z");
    assert.throws(function () { Cash.parseKyivDateTime("2026-03-29T03:30"); });
    assert.throws(function () { Cash.parseKyivDateTime("2026-02-30T12:00"); });
    assert.throws(function () { Cash.parseKyivDateTime("2026-10-24T24:00"); });
  });
  check("winter date-only filter uses Kyiv +02 and includes both edges", function () {
    const entries = [payment({ id: "before", occurredAt: "2026-10-31T21:59:59.999Z" }),
      payment({ id: "start", occurredAt: "2026-10-31T22:00:00.000Z" }),
      payment({ id: "end", occurredAt: "2026-11-01T21:59:59.999Z" }),
      payment({ id: "after", occurredAt: "2026-11-01T22:00:00.000Z" })];
    assert.deepEqual(Cash.filterEntries(entries, { from: "2026-11-01", to: "2026-11-01" }).map(function (entry) { return entry.id; }), ["end", "start"]);
  });
  check("CSV is UTF-8 BOM semicolon quoted and neutralizes spreadsheet formula injection", function () {
    const csv = Cash.exportCsv([payment({ counterparty: " =SUM(A1:A2)", purpose: 'Оплата; "Тарас"\nза монтаж', projectTitle: "@evil" })]);
    assert(csv.startsWith("\ufeff"));
    assert(csv.includes('"\'=SUM(A1:A2)"'));
    assert(csv.includes('"\'@evil"'));
    assert(csv.includes('"Оплата; ""Тарас""\nза монтаж"'));
    assert(csv.includes('"1000,10"'));
  });
  check("overflow is rejected instead of silently corrupting balances", function () {
    const first = payment({ amountMinor: Number.MAX_SAFE_INTEGER });
    const second = payment({ id: "second", amountMinor: 1 });
    assert.throws(function () { Cash.totals([first, second]); });
  });
  return { passed: checks };
}

module.exports = runCashLedgerTests;
if (require.main === module) console.log(runCashLedgerTests());
