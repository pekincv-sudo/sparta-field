"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

module.exports = async function runContractFlowTests() {
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const implementations = new Map([...source.matchAll(/^(?:async )?function\s+([\w$]+)\([^]*?^\}/gm)].map(match => [match[1], match[0]]));
  const documents = require("../project-documents.js");
  const checks = [], alerts = [], writes = [], opened = [];
  let project, selected, nativeChecks, queues, renders, saves, sections, writeOK = true, currentForm;
  const clone = value => JSON.parse(JSON.stringify(value));
  const terms = { installationWarrantyMonths: "12", equipmentWarrantyMonths: "60", advancePercent: "25", remainingPaymentTerms: "Решта після приймання монтажу.", workTerms: "Монтаж 10-12 листопада за погодженням сторін.", performerResponsibilities: "Виконати погоджені роботи та усунути недоліки монтажу, за які відповідає виконавець.", customerResponsibilities: "Надати доступ і здійснити погоджені оплати." };
  class FormValues {
    constructor(form) { this.values = form.values || form; }
    get(key) { return Object.hasOwn(this.values, key) ? this.values[key] : null; }
  }
  const context = vm.createContext({
    FormData: FormValues,
    cloudState: { ready: true, memberRole: "owner", companyId: "company-1", user: { id: "owner-1" }, supportsProjectFinance: true },
    window: { SPARTA_LOCAL_WORKSPACE: { enabled: false }, SpartaProjectDocuments: { model: documents.model, async open(input, options) { documents.model(input); opened.push({ input: clone(input), allowed: options.allowed }); } }, SpartaCashBook: { projectMarkup() { return '<div data-cash-flow="client"></div>'; }, projectTotals() { return { clientPaidMinor: 10000, recordedPayrollMinor: 0, recordedExpensesMinor: 0, materialsMinor: 0 }; } } },
    companyContacts: { name: "SPARTA power", location: "Office", phone: "+380000000000", email: "office@example.test" },
    projects: [], warehouseItems: [{ id: "stock", qty: 50 }], warehouseMovements: [{ id: "movement", qty: 2 }], warehouseReservations: [{ itemId: "stock", projectId: "other", qty: 3 }], cashEntries: [{ id: "cash", amountMinor: 10000 }],
    selectedProject: () => selected,
    projectMaterialsWithWarehousePrices: value => (value.materials || []).map(item => ({ currency: "USD", qty: item.issuedQty, purchasePrice: item.purchasePriceSnapshot, salePrice: item.salePriceSnapshot })),
    renderTabById: () => "", projectFilesFor: () => [],
    writeLocalStorage(key, value) { if (!writeOK) return false; writes.push({ key, value: JSON.parse(value) }); return true; },
    queueCloudSync() { queues++; }, saveProjects() { saves++; }, render() { renders++; }, showSection(value) { sections.push(value); },
    alert(message) { alerts.push(message); },
    document: { querySelector(selector) { assert.equal(selector, "#projectContractForm"); return currentForm; } },
  });
  for (const name of ["emptyProjectFinance", "normalizeProjectFinance", "canManageProjectFinance", "requireProjectRole", "escapeAttribute", "money", "offerLineTotals", "projectContractTerms", "customerDocumentInput", "projectFinanceTotals", "renderContractStage", "saveProjectContract", "saveProjectFinance", "previewProjectDocument", "normalizeProjectId", "projectToDb", "dbProjectToApp"]) {
    assert.ok(implementations.has(name), `Production function ${name} exists`);
    vm.runInContext(implementations.get(name), context);
  }
  const baseProject = () => ({
    id: "contract-test", title: "Станція TEST", currency: "USD", clientName: "Тестовий клієнт", clientPhone: "TEST-PHONE", address: "TEST-ADDRESS", status: "contract", contractNumber: "OLD-1", contractDate: "2026-10-01", workChecklist: {},
    materials: [{ warehouseItemId: "stock", name: "Already issued", issuedQty: 2, actualQty: 1, unit: "шт", purchasePriceSnapshot: 10, salePriceSnapshot: 20 }],
    photos: [{ src: "PRIVATE-PHOTO" }], files: [{ name: "PRIVATE-RECEIPT" }],
    finance: { contractNumber: "OLD-1", contractDate: "2026-10-01", contractPrice: 1200, installationPrice: 111, advancePaid: 90, crewPayroll: 125, expenses: [{ name: "PRIVATE-EXPENSE", amount: 15 }], equipment: [{ name: "PRIVATE-COST", purchasePrice: 100, salePrice: 300, qty: 2 }], contractTerms: clone(terms),
      offerInstallationPrice: 250.05, offerUpdatedAt: "2026-11-01T10:00:00.000Z", offerLines: [{ id: "quote-1", name: "Інвертор TEST", unit: "шт", qty: 2, salePrice: 1300.25, purchasePrice: 900, currency: "USD", note: "Модель ABC" }, { id: "quote-2", name: "Кабель", unit: "м", qty: 1.5, salePrice: 2.35, purchasePrice: 1.1, currency: "USD" }] },
  });
  const reset = () => {
    project = baseProject(); project.finance = clone(context.normalizeProjectFinance(project.finance)); selected = project; context.projects = [project, { id: "unrelated", finance: { contractPrice: 999 } }];
    context.cloudState.ready = true; context.cloudState.memberRole = "owner"; context.cloudState.companyId = "company-1"; context.cloudState.user = { id: "owner-1" };
    writes.length = alerts.length = opened.length = 0; nativeChecks = queues = renders = saves = 0; sections = []; writeOK = true; currentForm = null;
  };
  const form = (changes = {}, valid = true) => ({ values: { contractNumber: " SP-TEST-2 ", contractDate: "2026-11-01", contractPrice: "999999", installationPrice: "999999", ...terms, ...changes }, reportValidity() { nativeChecks++; return valid; } });
  const peripheral = () => clone({ stock: context.warehouseItems, movements: context.warehouseMovements, reservations: context.warehouseReservations, cash: context.cashEntries, materials: project.materials, photos: project.photos, files: project.files });
  const check = (name, callback) => { callback(); checks.push(name); };

  reset();
  check("Contract save derives exact current quoted equipment and work totals while preserving payments, costs and warehouse", () => {
    const before = peripheral(), financeBefore = clone(project.finance), other = JSON.stringify(context.projects[1]);
    context.saveProjectContract(form());
    assert.equal(project.finance.contractPrice, 2854.08); assert.equal(project.finance.installationPrice, 250.05);
    assert.equal(project.contractNumber, "SP-TEST-2"); assert.equal(project.contractDate, "2026-11-01");
    for (const field of ["advancePaid", "crewPayroll", "expenses", "equipment", "offerLines", "offerInstallationPrice", "offerUpdatedAt"]) assert.deepEqual(clone(project.finance[field]), financeBefore[field], field);
    assert.deepEqual(peripheral(), before); assert.equal(JSON.stringify(context.projects[1]), other);
    assert.equal(project.finance.contractSavedBy, "owner-1"); assert.ok(project.finance.contractSavedAt);
    assert.equal(writes.length, 1); assert.equal(writes[0].key, "solarObjectManager.projects");
    assert.equal(writes[0].value[0].finance.contractPrice, 2854.08); assert.equal(queues, 1); assert.equal(saves, 0); assert.equal(renders, 1); assert.deepEqual(sections, ["objectDetail"]); assert.equal(alerts.length, 0);
  });
  check("Saved contract contains a detached customer-only quote snapshot and validated warranty/payment terms", () => {
    reset(); context.saveProjectContract(form());
    const snapshot = project.finance.contractSnapshot, old = JSON.stringify(snapshot);
    assert.equal(snapshot.contractTerms.advancePercent, "25"); assert.equal(project.finance.contractTerms.advancePercent, 25);
    assert.equal(project.finance.contractTerms.advanceAmount, 713.52); assert.equal(project.finance.contractTerms.balanceAmount, 2140.56);
    assert.equal(project.finance.contractTerms.installationWarrantyMonths, 12); assert.equal(project.finance.contractTerms.equipmentWarrantyMonths, 60);
    assert.equal(snapshot.client, "Тестовий клієнт"); assert.equal(snapshot.phone, "TEST-PHONE"); assert.equal(snapshot.address, "TEST-ADDRESS");
    assert.doesNotMatch(old, /purchasePrice|PRIVATE-|advancePaid|crewPayroll|warehouseItemId/);
    project.finance.offerLines[0].salePrice = 5000; project.clientName = "Changed client";
    assert.equal(JSON.stringify(snapshot), old); assert.equal(project.finance.contractPrice, 2854.08);
  });
  check("Viewing contract and preview input does not write, sync, post payments or autosync a changed quote", () => {
    reset(); context.saveProjectContract(form()); project.finance.offerLines[0].salePrice = 1400;
    writes.length = 0; queues = renders = 0; const before = JSON.stringify(context.projects), beforePeripheral = peripheral();
    const input = context.customerDocumentInput(project, "contract"), html = context.renderContractStage(project);
    assert.equal(input.agreed, 3053.58); assert.match(html, /КП змінена/); assert.match(html, /3053,58|3\s053,58/);
    assert.equal(project.finance.contractPrice, 2854.08); assert.equal(project.finance.contractSnapshot.rows[0].price, 1300.25);
    assert.equal(JSON.stringify(context.projects), before); assert.deepEqual(peripheral(), beforePeripheral); assert.equal(writes.length, 0); assert.equal(queues, 0); assert.equal(renders, 0);
  });
  check("Explicitly resaving after quote changes refreshes agreed amount and snapshot without inventing an advance payment", () => {
    reset(); context.saveProjectContract(form()); project.finance.offerLines[0].salePrice = 1400;
    context.saveProjectContract(form({ advancePercent: "0" }));
    assert.equal(project.finance.contractPrice, 3053.58); assert.equal(project.finance.contractSnapshot.rows[0].price, 1400);
    assert.equal(project.finance.contractTerms.advanceAmount, 0); assert.equal(project.finance.advancePaid, 90);
    const html = context.renderContractStage(project); assert.doesNotMatch(html, /КП змінена/); assert.match(html, /Внесення авансу/); assert.match(html, /data-cash-flow="client"/);
  });
  check("Default contract warranty fields are twelve installation months and sixty manufacturer months with no default advance or work date", () => {
    reset(); delete project.finance.contractTerms; const before = JSON.stringify(project), defaults = context.projectContractTerms(project.finance), html = context.renderContractStage(project);
    assert.equal(defaults.installationWarrantyMonths, 12); assert.equal(defaults.equipmentWarrantyMonths, 60); assert.equal(defaults.advancePercent, ""); assert.equal(defaults.workTerms, "");
    assert.match(html, /name="installationWarrantyMonths"[^>]*value="12"/); assert.match(html, /name="equipmentWarrantyMonths"[^>]*value="60"/); assert.match(html, /name="advancePercent"[^>]*value=""/); assert.match(html, /Гарантія виробника/);
    assert.equal(JSON.stringify(project), before); assert.equal(writes.length, 0);
  });
  check("Invalid advance and incomplete warranty, schedule or responsibilities are rejected atomically", () => {
    for (const change of [{ advancePercent: "" }, { advancePercent: "-1" }, { advancePercent: "101" }, { advancePercent: "Infinity" }, { advancePercent: "0.123" }, { installationWarrantyMonths: "0" }, { installationWarrantyMonths: "12.5" }, { equipmentWarrantyMonths: "" }, { workTerms: " " }, { remainingPaymentTerms: "" }, { performerResponsibilities: "" }, { customerResponsibilities: "" }]) {
      reset(); const before = JSON.stringify(context.projects), financeRef = project.finance, beforePeripheral = peripheral();
      context.saveProjectContract(form(change)); assert.equal(JSON.stringify(context.projects), before, JSON.stringify(change)); assert.equal(project.finance, financeRef); assert.deepEqual(peripheral(), beforePeripheral); assert.equal(writes.length, 0); assert.equal(queues, 0); assert.equal(alerts.length, 1);
    }
  });
  check("Contract number and calendar date are validated beyond browser validity", () => {
    for (const change of [{ contractNumber: " " }, { contractNumber: "x".repeat(101) }, { contractDate: "" }, { contractDate: "2026-02-30" }, { contractDate: "2026-1-01" }, { contractDate: "bad" }]) {
      reset(); const before = JSON.stringify(context.projects); context.saveProjectContract(form(change)); assert.equal(JSON.stringify(context.projects), before, JSON.stringify(change)); assert.equal(writes.length, 0); assert.equal(queues, 0); assert.equal(alerts.length, 1);
    }
  });
  check("Missing client name, phone or object address prevents an incomplete contract from being saved", () => {
    for (const field of ["clientName", "clientPhone", "address"]) { reset(); project[field] = " "; const before = JSON.stringify(context.projects); context.saveProjectContract(form()); assert.equal(JSON.stringify(context.projects), before, field); assert.equal(writes.length, 0); assert.equal(queues, 0); assert.equal(alerts.length, 1); }
  });
  check("Native invalid form and missing selected project cannot save a contract", () => {
    reset(); const before = JSON.stringify(context.projects); context.saveProjectContract(form({}, false)); assert.equal(nativeChecks, 1); assert.equal(JSON.stringify(context.projects), before); assert.equal(writes.length, 0);
    selected = null; context.saveProjectContract(form()); assert.equal(writes.length, 0); assert.equal(queues, 0);
  });
  check("Storage failure leaves contract, finance, snapshots and peripheral records completely unchanged", () => {
    reset(); writeOK = false; const before = JSON.stringify(context.projects), financeRef = project.finance, beforePeripheral = peripheral();
    context.saveProjectContract(form()); assert.equal(JSON.stringify(context.projects), before); assert.equal(project.finance, financeRef); assert.deepEqual(peripheral(), beforePeripheral); assert.equal(writes.length, 0); assert.equal(queues, 0); assert.equal(renders, 0); assert.match(alerts[0], /Не вдалося зберегти договір/);
  });
  check("A mixed-currency or empty quote cannot be turned into a saved contract", () => {
    for (const invalid of ["currency", "empty"]) { reset(); if (invalid === "currency") project.finance.offerLines[0].currency = "UAH"; else project.finance.offerLines = []; const before = JSON.stringify(context.projects); context.saveProjectContract(form()); assert.equal(JSON.stringify(context.projects), before); assert.equal(writes.length, 0); assert.equal(alerts.length, 1); }
  });
  check("Only owner or administrator may save contract or internal payroll through production handlers", () => {
    for (const role of ["engineer", "warehouse", "brigadier", "installer", "viewer", "buyer", ""]) {
      for (const operation of [() => context.saveProjectContract(form()), () => context.saveProjectFinance({ values: { crewPayroll: "999" } })]) { reset(); context.cloudState.memberRole = role; const before = JSON.stringify(context.projects); operation(); assert.equal(JSON.stringify(context.projects), before, role); assert.equal(writes.length, 0); assert.equal(queues, 0); assert.equal(saves, 0); assert.equal(nativeChecks, 0); assert.equal(alerts.length, 1); }
    }
    for (const role of ["owner", "admin"]) { reset(); context.cloudState.memberRole = role; context.saveProjectContract(form()); assert.equal(writes.length, 1, role); }
  });
  check("Internal payroll save preserves agreed amount, contract snapshot, actual advance and all other business records", () => {
    reset(); context.saveProjectContract(form()); const before = clone(project.finance), beforePeripheral = peripheral();
    context.saveProjectFinance({ values: { crewPayroll: "321.25", contractPrice: "1", installationPrice: "2", contractNumber: "TAMPERED", contractDate: "2025-01-01" } });
    assert.equal(project.finance.crewPayroll, 321.25); for (const key of Object.keys(before).filter(key => key !== "crewPayroll")) assert.deepEqual(clone(project.finance[key]), before[key], key);
    assert.deepEqual(peripheral(), beforePeripheral); assert.equal(saves, 1);
  });
  check("An explicitly saved zero-value quote stays zero in contract financial totals instead of falling back to issued material prices", () => {
    reset(); project.finance.offerLines.forEach(line => { line.salePrice = 0; }); project.finance.offerInstallationPrice = 0;
    context.saveProjectContract(form({ advancePercent: "0" })); assert.equal(project.finance.contractPrice, 0); assert.equal(project.finance.installationPrice, 0); assert.equal(project.finance.contractTerms.advanceAmount, 0); assert.equal(context.projectFinanceTotals(project).revenue, 0); assert.equal(project.finance.advancePaid, 90); assert.equal(writes.length, 1);
  });
  check("Cloud serialization and reload preserve exact agreed terms and quote snapshot", () => {
    reset(); context.saveProjectContract(form()); const before = JSON.stringify(project), row = context.projectToDb(project);
    const loaded = context.dbProjectToApp({ ...clone(row), id: "cloud-id" });
    assert.deepEqual(clone(loaded.finance.contractTerms), clone(project.finance.contractTerms)); assert.deepEqual(clone(loaded.finance.contractSnapshot), clone(project.finance.contractSnapshot)); assert.equal(loaded.finance.contractPrice, 2854.08); assert.equal(loaded.contractNumber, "SP-TEST-2"); assert.equal(loaded.contractDate, "2026-11-01"); assert.equal(JSON.stringify(project), before);
  });
  reset(); currentForm = form({ advancePercent: "40", contractNumber: "UNSAVED-PREVIEW", workTerms: "Unsaved work dates" }); const beforePreview = JSON.stringify(context.projects);
  await context.previewProjectDocument("contract"); assert.equal(opened.length, 1); assert.equal(opened[0].input.number, "UNSAVED-PREVIEW"); assert.equal(opened[0].input.contractTerms.advancePercent, "40"); assert.equal(opened[0].input.contractTerms.workTerms, "Unsaved work dates"); assert.equal(opened[0].input.agreed, 2854.08); assert.equal(JSON.stringify(context.projects), beforePreview); assert.equal(writes.length, 0); assert.equal(queues, 0); assert.equal(saves, 0); assert.equal(opened[0].allowed(), true); checks.push("Contract preview reads unsaved validated form terms without saving or sending a message");
  const allowed = opened[0].allowed; context.cloudState.companyId = "other-company"; assert.equal(allowed(), false); context.cloudState.companyId = "company-1"; context.cloudState.user = { id: "other-user" }; assert.equal(allowed(), false); context.cloudState.user = { id: "owner-1" }; context.cloudState.memberRole = "installer"; assert.equal(allowed(), false); context.cloudState.memberRole = "owner"; selected = { ...project, id: "other-project" }; assert.equal(allowed(), false); checks.push("Preview actions become unavailable after project, company, user or role changes");
  reset(); currentForm = form({}, false); await context.previewProjectDocument("contract"); assert.equal(opened.length, 0); assert.equal(nativeChecks, 1); assert.equal(writes.length, 0); checks.push("Invalid contract form prevents preview before document generation");
  reset(); context.cloudState.memberRole = "installer"; currentForm = form(); await context.previewProjectDocument("contract"); assert.equal(opened.length, 0); assert.equal(nativeChecks, 0); assert.equal(alerts.length, 1); checks.push("Field staff cannot bypass the contract preview finance guard");
  return { passed: checks.length, checks };
};
