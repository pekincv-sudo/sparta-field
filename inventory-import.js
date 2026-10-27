(function (root, factory) {
  "use strict";
  const api = factory(root && root.SpartaWarehouseCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SpartaInventoryImport = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this, function create(core) {
  "use strict";
  const headers = ["name", "sku", "unit", "category", "currency", "purchasePrice", "installerPrice", "retailPrice", "wholesalePrice", "qty", "sourceRow"];
  const priceFields = ["purchasePrice", "installerPrice", "retailPrice", "wholesalePrice"];
  const maxNumber = 1000000000;
  const fail = (message) => { throw new Error(message); };
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const normalize = (value) => String(value).normalize("NFKC").toLocaleLowerCase("uk-UA").replace(/[’`ʼ]/g, "'").replace(/\s+/g, " ").trim();
  function text(value, label, maximum, optional) {
    if (typeof value !== "string" && !(optional && value == null)) fail("Некоректне текстове поле: " + label);
    const result = String(value == null ? "" : value).normalize("NFKC").trim();
    if ((!optional && !result) || result.length > maximum || /[\u0000-\u001f\u007f<>]/.test(result) || /(?:javascript\s*:|data\s*:\s*text\/html)/i.test(result)) fail("Некоректне текстове поле: " + label);
    return result;
  }
  function numeric(value, label, optional) {
    if (value == null || value === "" || (typeof value === "string" && !value.trim())) {
      if (optional) return null;
      fail("Заповніть числове поле: " + label);
    }
    if (typeof value !== "number" && typeof value !== "string") fail("Некоректне число: " + label);
    if (typeof value === "string" && !/^\d+(?:[.,]\d+)?$/.test(value.trim())) fail("Некоректне число: " + label);
    const result = Number(typeof value === "string" ? value.trim().replace(",", ".") : value);
    if (!Number.isFinite(result) || result < 0 || result > 999999999999) fail("Некоректне число: " + label);
    return result;
  }
  function row(input, index) {
    if (!input || typeof input !== "object" || Array.isArray(input)) fail("Некоректний рядок імпорту " + (index + 1));
    if (input.sourceRow != null && typeof input.sourceRow !== "string" && (typeof input.sourceRow !== "number" || !Number.isFinite(input.sourceRow))) fail("Некоректний рядок джерела.");
    const result = {
      name: text(input.name, "назва", 240), sku: text(input.sku, "артикул", 100, true),
      unit: text(input.unit, "одиниця", 20), category: text(input.category, "категорія", 100),
      currency: text(input.currency, "валюта", 3).toUpperCase(),
      qty: numeric(input.qty, "кількість"),
      sourceRow: text(input.sourceRow == null ? String(index + 2) : String(input.sourceRow), "рядок джерела", 80),
    };
    if (!["UAH", "USD"].includes(result.currency)) fail("Вкажіть явну валюту UAH або USD.");
    if (!Number.isInteger(result.qty) || result.qty <= 0 || result.qty > maxNumber) fail("Кількість імпорту має бути додатним цілим числом до 1000000000.");
    priceFields.forEach((field) => { result[field] = numeric(input[field], field, true); });
    return result;
  }
  function parseCsv(input) {
    if (typeof input !== "string") fail("CSV має бути текстом UTF-8.");
    const source = input.replace(/^\uFEFF/, "");
    const records = [];
    let record = [], cell = "", quoted = false, closed = false;
    for (let index = 0; index < source.length; index++) {
      const character = source[index];
      if (quoted) {
        if (character === '"' && source[index + 1] === '"') { cell += '"'; index++; }
        else if (character === '"') { quoted = false; closed = true; }
        else cell += character;
      } else if (character === '"') {
        if (cell || closed) fail("Некоректні лапки у CSV.");
        quoted = true;
      } else if (character === ";" || character === "\n" || character === "\r") {
        record.push(cell); cell = ""; closed = false;
        if (character !== ";") {
          if (character === "\r" && source[index + 1] === "\n") index++;
          if (record.some((value) => value !== "")) records.push(record);
          record = [];
        }
      } else {
        if (closed) fail("Зайвий текст після лапок у CSV.");
        cell += character;
      }
    }
    if (quoted) fail("Незакриті лапки у CSV.");
    record.push(cell);
    if (record.some((value) => value !== "")) records.push(record);
    if (!records.length || JSON.stringify(records.shift()) !== JSON.stringify(headers)) fail("Некоректні заголовки CSV: " + headers.join(";"));
    if (!records.length) fail("CSV не містить обладнання.");
    return records.map((values, index) => {
      if (values.length !== headers.length) fail("Некоректна кількість стовпців CSV у рядку " + (index + 2));
      return row(Object.fromEntries(headers.map((header, position) => [header, values[position]])), index);
    });
  }
  function equivalent(a, b) {
    return ["name", "sku", "unit", "category"].every((field) => normalize(a[field]) === normalize(b[field])) &&
      a.currency === b.currency && a.qty === b.qty && priceFields.every((field) => a[field] === b[field]);
  }
  function prepare(input) {
    if (!input || typeof input !== "object" || !Array.isArray(input.items) || !input.items.length || input.items.length > 10000) fail("Додайте від 1 до 10000 позицій імпорту.");
    const sourceName = text(input.sourceName, "назва джерела", 300);
    const sourceHash = text(input.sourceHash, "SHA-256 джерела", 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sourceHash)) fail("Потрібен SHA-256 вихідного файлу.");
    const items = [], names = new Map(), skus = new Map();
    input.items.forEach((raw, index) => {
      const value = row(raw, index), nameKey = normalize(value.name), skuKey = normalize(value.sku);
      const matches = [...new Set([names.get(nameKey), skuKey ? skus.get(skuKey) : null].filter(Boolean))];
      if (matches.length > 1 || (matches.length && !equivalent(matches[0], value))) fail("Суперечливий дубль у джерелі: " + value.name);
      if (matches.length) { matches[0].sourceRows.push(value.sourceRow); return; }
      value.sourceRows = [value.sourceRow]; items.push(value); names.set(nameKey, value);
      if (skuKey) skus.set(skuKey, value);
    });
    items.sort((a, b) => {
      const aKey = JSON.stringify([normalize(a.name), normalize(a.sku), a.currency, normalize(a.unit)]);
      const bKey = JSON.stringify([normalize(b.name), normalize(b.sku), b.currency, normalize(b.unit)]);
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });
    items.forEach((item) => item.sourceRows.sort());
    const signature = JSON.stringify({ version: 1, sourceHash, items });
    return { sourceName, sourceHash, items, signature, rowsRead: input.items.length, batchId: "inventory-import-" + sourceHash };
  }
  function assertSize(state) {
    const payload = { version: 1, items: state.items, movements: state.movements, documents: state.documents, reservations: state.reservations };
    const json = JSON.stringify(payload);
    let bytes = 0, inside = false, escaped = false;
    for (let index = 0; index < json.length; index++) {
      const code = json.charCodeAt(index), character = json[index];
      bytes += code < 128 ? 1 : code < 2048 ? 2 : code >= 0xd800 && code <= 0xdbff && index + 1 < json.length ? (index++, 4) : 3;
      if (inside) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inside = false;
      } else if (character === '"') inside = true;
      else if (character === "," || character === ":") bytes++; // jsonb::text adds a space after separators.
      if (bytes > 10000000) fail("Повний складський пакет перевищує 10 МБ. Імпорт не проведено.");
    }
  }
  function replay(state, batch) {
    const prefix = batch.batchId + "-";
    const found = state.documents.filter((doc) => doc.importSourceHash === batch.sourceHash || String(doc.id).startsWith(prefix));
    const orphan = state.movements.some((movement) => String(movement.documentId).startsWith(prefix) && !state.documents.some((doc) => doc.id === movement.documentId));
    if (orphan) fail("Знайдено неповну історію цього імпорту.");
    if (!found.length) return null;
    const first = found[0], ids = first.importDocumentIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 4 || new Set(ids).size !== ids.length || found.length !== ids.length ||
      found.some((doc) => doc.status !== "posted" || doc.importBatchId !== batch.batchId || doc.importSourceHash !== batch.sourceHash || doc.importManifestSignature !== batch.signature ||
        !ids.includes(doc.id) || JSON.stringify(doc.importDocumentIds) !== JSON.stringify(ids) || !new RegExp("^" + prefix + "(?:UAH|USD)-(?:receipt|stocktake)$").test(doc.id)) ||
      ids.some((documentId) => !found.some((doc) => doc.id === documentId)) || !first.importSummary) fail("Цей файл уже має інший або неповний імпорт. Повторне додавання заборонено.");
    return { state, summary: copy(first.importSummary), alreadyImported: true };
  }
  function plan(original, input, options) {
    if (!core || typeof core.saveCatalog !== "function" || typeof core.postReceipt !== "function" || typeof core.postStocktake !== "function") fail("Модуль складського обліку недоступний.");
    if (!original || !["items", "movements", "documents", "reservations"].every((field) => Array.isArray(original[field]))) fail("Завантажте актуальний хмарний склад.");
    const batch = prepare(input), previous = replay(original, batch);
    if (previous) return previous;
    const date = text(options && options.date, "дата імпорту", 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(new Date(date + "T12:00:00.000Z").getTime()) || new Date(date + "T12:00:00.000Z").toISOString().slice(0, 10) !== date) fail("Вкажіть коректну дату імпорту.");
    let state = copy(original);
    const summary = { batchId: batch.batchId, sourceName: batch.sourceName, sourceHash: batch.sourceHash, rowsRead: batch.rowsRead, uniqueItems: batch.items.length,
      duplicatesMerged: batch.rowsRead - batch.items.length, newItems: 0, existingItems: 0, totalQty: 0, knownCostNewItems: 0, unknownCostNewItems: 0,
      valuationIncomplete: false, documentIds: [], rows: [], currencies: {} };
    const groups = new Map(), mapped = new Set();
    batch.items.forEach((source, index) => {
      if (!core.isStockItem(source)) fail("Послуги й роботи не можна додати до фізичного складу: " + source.name);
      const skuMatches = source.sku ? original.items.filter((item) => normalize(item.sku || "") === normalize(source.sku)) : [];
      const nameMatches = original.items.filter((item) => normalize(item.name || "") === normalize(source.name));
      if (skuMatches.length > 1 || (!skuMatches.length && nameMatches.length > 1) || (skuMatches.length && nameMatches.length && !nameMatches.some((item) => item.id === skuMatches[0].id))) fail("Неоднозначна відповідність на складі: " + source.name);
      let item = skuMatches[0] || nameMatches[0];
      const existing = Boolean(item);
      if (item) {
        if (!core.isStockItem(item) || item.archived === true || item.archived === "true" || item.serialTracking === true || item.serialTracking === "true") fail("Архівний, сервісний або серійний товар потребує окремої перевірки: " + source.name);
        if ((item.currency || "UAH") !== source.currency || normalize(item.unit || "шт") !== normalize(source.unit)) fail("Валюта або одиниця не збігається з карткою: " + source.name);
      } else {
        const itemId = "import-item-" + batch.sourceHash + "-" + (index + 1);
        if (state.items.some((entry) => String(entry.id) === itemId)) fail("Конфлікт ідентифікатора товару імпорту.");
        const card = { id: itemId, name: source.name, sku: source.sku, unit: source.unit, category: source.category, currency: source.currency,
          purchasePrice: source.purchasePrice == null ? 0 : source.purchasePrice, deliveryCost: 0, extraCost: 0,
          installerPrice: source.installerPrice == null ? 0 : source.installerPrice, retailPrice: source.retailPrice == null ? 0 : source.retailPrice,
          wholesalePrice: source.wholesalePrice == null ? 0 : source.wholesalePrice };
        state.items = core.saveCatalog(state.items, card, { movements: state.movements, reservations: state.reservations, projects: state.projects || [] });
        item = state.items.find((entry) => entry.id === itemId);
        item.purchasePriceKnown = source.purchasePrice != null;
        summary.newItems++;
        if (item.purchasePriceKnown) summary.knownCostNewItems++; else summary.unknownCostNewItems++;
      }
      if (mapped.has(String(item.id))) fail("Кілька рядків джерела відповідають одній картці: " + source.name);
      mapped.add(String(item.id));
      if (existing) summary.existingItems++;
      const route = existing || source.purchasePrice == null ? "stocktake" : "receipt";
      const key = source.currency + "-" + route;
      const beforeQty = Number(item.qty || 0), afterQty = core.quantity(beforeQty + source.qty, item.unit);
      if (afterQty > 999999999999) fail("Залишок товару перевищує допустимий розмір.");
      const known = item.purchasePriceKnown !== false;
      const unitCost = core.unitCost(item);
      if (!groups.has(key)) groups.set(key, { currency: source.currency, route, lines: [], valuationIncomplete: false });
      const group = groups.get(key);
      group.lines.push(route === "receipt" ? { itemId: item.id, qty: source.qty, purchasePrice: source.purchasePrice, deliveryCost: 0, extraCost: 0 } : { itemId: item.id, countedQty: afterQty });
      group.valuationIncomplete = group.valuationIncomplete || !known;
      summary.totalQty += source.qty; summary.valuationIncomplete = summary.valuationIncomplete || !known;
      if (!summary.currencies[source.currency]) summary.currencies[source.currency] = { items: 0, qty: 0, value: 0, valuationIncomplete: false };
      const total = summary.currencies[source.currency]; total.items++; total.qty += source.qty; total.value += source.qty * unitCost; total.valuationIncomplete = total.valuationIncomplete || !known;
      summary.rows.push({ itemId: item.id, name: item.name, sku: item.sku, unit: item.unit, currency: source.currency, qty: source.qty, action: existing ? "existing" : "new", route,
        purchasePriceKnown: known, sourcePurchasePrice: source.purchasePrice, unitCost, beforeQty, afterQty, sourceRow: source.sourceRows.join(", ") });
    });
    summary.documentIds = [...groups.keys()].sort().map((key) => batch.batchId + "-" + key);
    for (const key of [...groups.keys()].sort()) {
      const group = groups.get(key), documentId = batch.batchId + "-" + key;
      if (state.documents.some((doc) => doc.id === documentId) || state.movements.some((movement) => movement.documentId === documentId)) fail("Конфлікт документа імпорту.");
      const note = "Початкове додавання запасів із файлу «" + batch.sourceName + "». Закупівля/оплата постачальнику не реєструється; каса не змінюється." +
        (group.valuationIncomplete ? " Частина закупівельних цін невідома; технічний нуль не є підтвердженою собівартістю." : "") +
        (group.route === "stocktake" ? " До поточного залишку додано кількість із файлу; попередні ціни збережено." : " Для нових карток використано явно зазначені закупівельні ціни джерела.");
      const doc = { id: documentId, number: "IMPORT-" + batch.sourceHash.slice(0, 16) + "-" + key, date, currency: group.currency, createdAt: date + "T12:00:00.000Z", note, reason: "Початковий імпорт запасів із файлу", lines: group.lines };
      const result = group.route === "receipt" ? core.postReceipt(state, doc) : core.postStocktake(state, doc);
      Object.assign(result.document, { importBatchId: batch.batchId, importSourceHash: batch.sourceHash, importSourceName: batch.sourceName,
        importManifestSignature: batch.signature, importDocumentIds: summary.documentIds.slice(), importSummary: copy(summary), valuationIncomplete: group.valuationIncomplete });
      state = { ...state, ...result };
    }
    // document is a core return convenience; it is not a workspace collection.
    if (!Object.prototype.hasOwnProperty.call(original, "document")) delete state.document;
    assertSize(state);
    return { state, summary, alreadyImported: false };
  }
  return Object.freeze({ parseCsv, plan, create });
});
