(function (root, factory) {
  "use strict";
  const api = factory(root && root.SpartaWarehouseCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SpartaWarehouseExcelCore = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this, function create(core) {
  "use strict";

  const fields = Object.freeze(["id", "sku", "name", "category", "brand", "model", "unit", "currency", "qty", "retailPrice", "installerPrice", "wholesalePrice", "minQty", "location"]);
  const numericFields = ["qty", "retailPrice", "installerPrice", "wholesalePrice", "minQty"];
  const priceFields = ["retailPrice", "installerPrice", "wholesalePrice"];
  const editableFields = fields.filter((field) => !["id", "unit", "currency"].includes(field));
  const maxNumber = Number.MAX_SAFE_INTEGER / 1000;
  const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const fail = (message) => { throw new Error(message); };
  const copy = (value) => Array.isArray(value) ? value.map(copy) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).map((key) => [key, copy(value[key])])) : value;
  const plain = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || Object.getPrototypeOf(prototype) === null;
  };
  const blank = (value) => value == null || (typeof value === "string" && !value.trim());
  const same = (left, right) => fields.every((field) => left[field] === right[field]);
  const changes = (left, right) => editableFields.filter((field) => left[field] !== right[field]);
  const round = (value) => Math.round((value + Number.EPSILON) * 1000) / 1000;

  function canonical(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (plain(value)) return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
    fail("Некоректна область даних Excel.");
  }
  function requireCore() {
    if (!core || !["saveCatalog", "quantity", "postStocktake", "reservedQty", "isStockItem", "normalizeText"].every((name) => typeof core[name] === "function")) fail("Складський модуль Excel недоступний.");
  }
  function text(value, field, optional) {
    if (value == null && optional) return "";
    if (typeof value !== "string") fail("Некоректний текст у полі «" + field + "».");
    const result = value.trim();
    const limit = field === "id" ? 240 : field === "sku" ? 100 : 1000;
    if ((!optional && !result) || result.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) fail("Некоректний текст у полі «" + field + "».");
    return result;
  }
  function number(value, field, fallback) {
    if (blank(value)) {
      if (fallback !== undefined) return fallback;
      fail("Заповніть числове поле «" + field + "».");
    }
    if (typeof value !== "number" && typeof value !== "string") fail("Некоректне число у полі «" + field + "».");
    if (typeof value === "string" && !/^\d+(?:[.,]\d+)?$/.test(value.trim())) fail("Некоректне число у полі «" + field + "».");
    const result = Number(typeof value === "string" ? value.trim().replace(",", ".") : value);
    if (!Number.isFinite(result) || result < 0 || result > maxNumber) fail("Некоректне число у полі «" + field + "».");
    return result;
  }
  function normalizedRow(input, baseline, source) {
    if (!plain(input)) fail("Некоректний рядок Excel.");
    if (!source && fields.some((field) => !has(input, field))) fail("У рядку Excel відсутні обов’язкові стовпці.");
    const result = {};
    fields.filter((field) => !numericFields.includes(field)).forEach((field) => {
      let value = input[field];
      if (source && blank(value)) value = field === "unit" ? "шт" : field === "currency" ? "UAH" : field === "category" ? "Інше" : "";
      result[field] = text(value, field, !["name", "unit", "currency"].includes(field));
    });
    if (!["UAH", "USD"].includes(result.currency)) fail("Вкажіть валюту UAH або USD.");
    numericFields.forEach((field) => {
      const value = source && field === "retailPrice" && blank(input[field]) ? input.salePrice : input[field];
      result[field] = number(value, field, source ? 0 : baseline ? baseline[field] : 0);
    });
    result.qty = core.quantity(result.qty, result.unit, { allowZero: true });
    result.minQty = core.quantity(result.minQty, result.unit, { allowZero: true });
    return result;
  }
  function checkedContext(context) {
    if (!plain(context) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(context.exportId || "")) fail("Некоректний ідентифікатор експорту Excel.");
    if (typeof context.exportedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(context.exportedAt) || !Number.isFinite(new Date(context.exportedAt).getTime())) fail("Некоректна дата експорту Excel.");
    checkedDate(context.exportedAt.slice(0, 10));
    if (!has(context, "scope") || context.scope == null || context.scope === "") fail("Не вказано область даних Excel.");
    canonical(context.scope);
  }
  function snapshot(state, context) {
    requireCore();
    checkedContext(context);
    if (!state || !Array.isArray(state.items)) fail("Немає даних складу для експорту Excel.");
    const rows = state.items.filter(core.isStockItem).map((item) => normalizedRow(item, null, true));
    const ids = new Set();
    rows.forEach((row) => {
      if (!row.id || ids.has(row.id)) fail("Каталог містить порожні або повторні ідентифікатори товарів.");
      ids.add(row.id);
    });
    return { format: "sparta-warehouse-excel", version: 1, exportId: context.exportId, scope: copy(context.scope), exportedAt: context.exportedAt, rows };
  }
  function checkedDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("Вкажіть коректну дату імпорту Excel.");
    const parsed = new Date(value + "T00:00:00.000Z");
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail("Вкажіть коректну дату імпорту Excel.");
    return value;
  }
  function replay(currentState, manifest, batchHash, scope) {
    const expectedIds = ["USD", "UAH"].map((currency) => "excel-" + batchHash + "-" + currency);
    const docs = (currentState.documents || []).filter((doc) => expectedIds.includes(doc.id) || doc.excelBatchHash === batchHash);
    if (!docs.length) {
      if ((currentState.movements || []).some((movement) => expectedIds.includes(movement.documentId))) fail("Знайдено неповний імпорт Excel. Відновіть складські документи.");
      return null;
    }
    const first = docs[0], documentIds = first.excelDocumentIds;
    if (!Array.isArray(documentIds) || !documentIds.length || new Set(documentIds).size !== documentIds.length || docs.length !== documentIds.length || !first.excelSummary || !documentIds.every((id) => expectedIds.includes(id))) fail("Знайдено інший або неповний імпорт Excel.");
    const signature = canonical(first.excelSummary);
    docs.forEach((doc) => {
      if (!documentIds.includes(doc.id) || docs.filter((entry) => entry.id === doc.id).length !== 1 || doc.status !== "posted" || doc.type !== "stocktake" || doc.excelBatchHash !== batchHash || doc.excelExportId !== manifest.exportId || canonical(doc.excelScope) !== scope || canonical(doc.excelDocumentIds) !== canonical(documentIds) || canonical(doc.excelSummary) !== signature) fail("Знайдено інший або неповний імпорт Excel.");
    });
    return { state: currentState, summary: copy(first.excelSummary), alreadyApplied: true };
  }
  function prepare(manifest, rows, currentState, options) {
    requireCore();
    if (!plain(manifest) || manifest.format !== "sparta-warehouse-excel" || manifest.version !== 1 || !Array.isArray(manifest.rows)) fail("Це не підтримуваний файл складського Excel.");
    checkedContext(manifest);
    if (!plain(options) || !/^[a-f0-9]{64}$/i.test(options.batchHash || "")) fail("Некоректна контрольна сума імпорту Excel.");
    const batchHash = options.batchHash.toLowerCase(), scope = canonical(manifest.scope);
    if (!has(options, "scope") || canonical(options.scope) !== scope) fail("Файл Excel належить іншій компанії або локальному складу.");
    checkedDate(options.date);
    if (!currentState || !Array.isArray(currentState.items) || !Array.isArray(rows) || rows.length > 50000 || manifest.rows.length > 50000) fail("Некоректні дані складу або рядки Excel.");
    const prior = replay(currentState, manifest, batchHash, scope);
    if (prior) return prior;
    const baselines = new Map();
    manifest.rows.forEach((input) => {
      const row = normalizedRow(input, null, false);
      if (!row.id || baselines.has(row.id)) fail("У початковому знімку Excel повторюється ідентифікатор товару.");
      baselines.set(row.id, row);
    });
    const existing = new Map();
    currentState.items.forEach((item) => {
      const id = text(item.id, "id", false);
      if (existing.has(id)) fail("У каталозі повторюється ідентифікатор товару.");
      existing.set(id, item);
    });
    const summary = { totalRows: rows.length, updatedItems: 0, newItems: 0, unchangedItems: 0, deletedRowsIgnored: 0, quantityChanges: 0, metadataChanges: 0, priceChanges: 0, documentIds: [], currencies: {}, rows: [] };
    const plans = [], seen = new Set(), newNames = new Set(), newSkus = new Set();
    rows.forEach((input, index) => {
      if (!plain(input)) fail("Некоректний рядок Excel " + (index + 2) + ".");
      const inputId = text(input.id, "id", true), baseline = inputId ? baselines.get(inputId) : null;
      if (inputId && !baseline) fail("Невідомий ідентифікатор товару в рядку " + (index + 2) + ". Для нового товару залиште ID порожнім.");
      if (inputId && seen.has(inputId)) fail("Один товар повторюється у кількох рядках Excel.");
      if (inputId) seen.add(inputId);
      const target = normalizedRow(input, baseline, false);
      if (baseline && (target.currency !== baseline.currency || target.unit !== baseline.unit)) fail("Змінювати валюту або одиницю наявного товару через Excel не можна.");
      const source = baseline ? existing.get(inputId) : null;
      if (!baseline) {
        const sku = core.normalizeText(target.sku), name = core.normalizeText(target.name);
        if ((sku && newSkus.has(sku)) || newNames.has(name) || currentState.items.some((item) => (sku && core.normalizeText(item.sku) === sku) || core.normalizeText(item.name) === name)) fail("Новий рядок збігається з наявним товаром за артикулом або назвою. Збережіть початковий ID товару.");
        if (sku) newSkus.add(sku);
        newNames.add(name);
        target.id = "excel-item-" + batchHash + "-" + (index + 1);
        if (existing.has(target.id)) fail("Ідентифікатор нового товару вже існує.");
      }
      const requested = baseline ? changes(baseline, target) : editableFields.slice();
      let before = source ? normalizedRow(source, null, true) : baseline || Object.assign({}, target, { qty: 0 });
      let action = !baseline ? "new" : requested.length ? "updated" : "unchanged";
      if (baseline && requested.length) {
        if (!source || !core.isStockItem(source)) fail("Товар «" + target.name + "» змінився або видалений після експорту. Експортуйте свіжий файл.");
        if (same(before, target)) action = "unchanged";
        else if (!same(before, baseline)) fail("Товар «" + target.name + "» змінився після експорту. Експортуйте свіжий файл.");
      }
      if (action !== "unchanged") {
        if (source && before.qty !== target.qty && (source.serialTracking || (Array.isArray(source.serialNumbers) && source.serialNumbers.length) || source.serialNumber)) fail("Кількість серійного товару змінюйте через складський документ із серійними номерами.");
        const reserved = core.reservedQty(currentState.reservations || [], target.id, undefined, currentState.orderReservations || []);
        if (target.qty < reserved) fail("Фактичний залишок менший за резерв об’єктів і покупців.");
        plans.push({ index, target, before, source, action });
      } else summary.unchangedItems++;
      summary.rows.push({ row: index + 2, index, id: target.id, name: target.name, currency: target.currency, action, beforeQty: before.qty, qty: action === "unchanged" ? before.qty : target.qty, delta: action === "unchanged" ? 0 : round(target.qty - before.qty), changedFields: action === "unchanged" ? [] : changes(before, target) });
    });
    summary.deletedRowsIgnored = Array.from(baselines.keys()).filter((id) => !seen.has(id)).length;
    if (!plans.length) return { state: currentState, summary, alreadyApplied: false };
    const state = copy(currentState), groups = new Map();
    // Catalog validation and document posting happen only in this isolated copy.
    plans.forEach((plan) => {
      const input = Object.assign({}, plan.target);
      delete input.qty;
      const saved = core.saveCatalog(state.items, input, state);
      const validated = saved.find((item) => item.id === input.id);
      if (plan.source) {
        const preserved = copy(plan.source);
        editableFields.filter((field) => field !== "qty").forEach((field) => { preserved[field] = validated[field]; });
        preserved.salePrice = validated.salePrice;
        state.items = saved.map((item) => item.id === input.id ? preserved : item);
      } else {
        validated.purchasePrice = 0;
        validated.deliveryCost = 0;
        validated.extraCost = 0;
        validated.purchasePriceKnown = false;
        state.items = saved;
      }
      const actual = normalizedRow(state.items.find((item) => item.id === input.id), null, true);
      actual.qty = plan.target.qty;
      const changedFields = plan.action === "new" ? editableFields.slice() : changes(plan.before, actual), rowSummary = summary.rows[plan.index];
      Object.assign(rowSummary, { id: actual.id, name: actual.name, changedFields });
      if (plan.action === "new") summary.newItems++; else summary.updatedItems++;
      if (plan.before.qty !== actual.qty) summary.quantityChanges++;
      if (changedFields.some((field) => priceFields.includes(field))) summary.priceChanges++;
      if (changedFields.some((field) => !numericFields.includes(field)) || changedFields.includes("minQty")) summary.metadataChanges++;
      if (!groups.has(actual.currency)) groups.set(actual.currency, { lines: [], changes: [], valuationIncomplete: false });
      const group = groups.get(actual.currency);
      group.lines.push({ itemId: actual.id, countedQty: actual.qty });
      group.changes.push({ itemId: actual.id, action: plan.action, changedFields, before: plan.source ? copy(plan.before) : null, after: copy(actual) });
      group.valuationIncomplete = group.valuationIncomplete || state.items.find((item) => item.id === actual.id).purchasePriceKnown === false;
      const totals = summary.currencies[actual.currency] || (summary.currencies[actual.currency] = { changedItems: 0, quantityDelta: 0 });
      totals.changedItems++;
      totals.quantityDelta = round(totals.quantityDelta + rowSummary.delta);
    });
    summary.documentIds = ["USD", "UAH"].filter((currency) => groups.has(currency)).map((currency) => "excel-" + batchHash + "-" + currency);
    ["USD", "UAH"].forEach((currency) => {
      if (!groups.has(currency)) return;
      const group = groups.get(currency), documentId = "excel-" + batchHash + "-" + currency;
      const result = core.postStocktake(state, { id: documentId, number: "Excel-" + batchHash.slice(0, 12) + "-" + currency, date: options.date, currency, reason: "Зміни каталогу та фактичних залишків з Excel", lines: group.lines, createdBy: options.createdBy || "", createdByName: options.createdByName || "", createdAt: options.createdAt || "" });
      Object.assign(result.document, { excelBatchHash: batchHash, excelExportId: manifest.exportId, excelScope: copy(manifest.scope), excelDocumentIds: summary.documentIds.slice(), excelSummary: copy(summary), roundtripChanges: copy(group.changes), valuationIncomplete: group.valuationIncomplete });
      state.items = result.items;
      state.documents = result.documents;
      state.movements = result.movements;
    });
    return { state, summary, alreadyApplied: false };
  }
  return Object.freeze({ create, fields, snapshot, prepare });
});
