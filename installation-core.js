(function (root, factory) {
  "use strict";
  const warehouse = typeof module === "object" && module.exports ? require("./warehouse-core.js") : root && root.SpartaWarehouseCore;
  const api = factory(warehouse);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SpartaInstallationCore = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this, function (warehouse) {
  "use strict";

  const KIND = "installation_completion";
  const copy = (value) => Array.isArray(value) ? value.map(copy) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).map((key) => [key, copy(value[key])])) : value;
  const id = (value) => String(value == null ? "" : value).trim();
  const round = (value) => Math.round((value + Number.EPSILON) * 1000) / 1000;
  function fail(message, code = "INSTALLATION_INVALID") { throw Object.assign(new Error(message), { code }); }
  function currency(value) {
    const result = String(value || "UAH").toUpperCase();
    if (!["USD", "UAH"].includes(result)) fail("Підтримуються валюти USD та UAH.");
    return result;
  }
  function checkedDate(value) {
    const result = id(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) fail("Вкажіть дату виконання монтажу.");
    const date = new Date(result + "T00:00:00.000Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== result) fail("Вкажіть коректну дату виконання монтажу.");
    return result;
  }
  function todayInKyiv() {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (type) => parts.find((entry) => entry.type === type).value;
    return part("year") + "-" + part("month") + "-" + part("day");
  }
  function money(value, label) {
    if ((typeof value !== "number" && typeof value !== "string") || id(value) === "" || !Number.isFinite(Number(value)) || Number(value) < 0) fail("Некоректна " + label + ".");
    return Number(value);
  }
  function validateState(state) {
    if (!warehouse) fail("Модуль складу недоступний.");
    if (!state || !Array.isArray(state.items) || !Array.isArray(state.projects) || !Array.isArray(state.documents) || !Array.isArray(state.movements)) fail("Оновіть дані складу перед підтвердженням монтажу.");
    for (const field of ["reservations", "orderReservations"]) if (state[field] != null && !Array.isArray(state[field])) fail("Оновіть резерви складу перед підтвердженням монтажу.");
  }
  function documentId(projectId) {
    const project = id(projectId);
    if (!project) fail("Оберіть об’єкт монтажу.");
    return "installation-completion-" + encodeURIComponent(project);
  }
  function completion(state, projectId) {
    const project = id(projectId);
    const documents = state && Array.isArray(state.documents) ? state.documents : [];
    const found = documents.filter((entry) => entry.kind === KIND && entry.status === "posted" && id(entry.projectId) === project);
    if (found.length > 1) fail("Знайдено кілька підтверджень монтажу. Перевірте історію об’єкта.", "INSTALLATION_HISTORY");
    return found.length ? copy(found[0]) : null;
  }
  function materialQuantity(material, field, unit) {
    return warehouse.quantity(material[field] == null ? 0 : material[field], unit, { allowZero: true });
  }
  function materialBinding(project, item) {
    const materials = project.materials || [];
    const bound = [];
    materials.forEach((material, index) => { if (id(material.warehouseItemId) === id(item.id)) bound.push(index); });
    if (bound.length) return bound;
    const matches = [];
    materials.forEach((material, index) => {
      if (id(material.warehouseItemId)) return;
      const exactCatalog = id(material.catalogItemId) === id(item.id);
      const matchingSku = id(item.sku) && warehouse.normalizeText(material.sku) === warehouse.normalizeText(item.sku);
      const matchingName = warehouse.normalizeText(material.name) === warehouse.normalizeText(item.name);
      if (!exactCatalog && !matchingSku && !matchingName) return;
      if (currency(material.currency) !== currency(item.currency)) fail("Валюта матеріалу «" + material.name + "» не збігається з товаром складу.", "INSTALLATION_CURRENCY");
      if (warehouse.normalizeText(material.unit || "шт") !== warehouse.normalizeText(item.unit || "шт")) fail("Одиниця матеріалу «" + material.name + "» не збігається з товаром складу.", "INSTALLATION_UNIT");
      if (Number(material.issuedQty || 0) !== 0 || Number(material.actualQty || 0) !== 0) fail("Матеріал «" + material.name + "» має рух без прив’язки до складу. Спочатку перевірте його історію.", "INSTALLATION_BINDING");
      matches.push(index);
    });
    if (matches.length > 1) fail("Кілька матеріалів відповідають товару «" + item.name + "». Уточніть прив’язку до складу.", "INSTALLATION_BINDING");
    return matches;
  }
  function plan(state, input) {
    validateState(state);
    if (!input || !id(input.projectId)) fail("Оберіть об’єкт монтажу.");
    const projectId = id(input.projectId);
    const foundProjects = state.projects.filter((entry) => id(entry.id) === projectId);
    if (foundProjects.length !== 1) fail("Об’єкт монтажу не знайдено або його ідентифікатор повторюється.");
    const project = foundProjects[0];
    if (project.materials != null && !Array.isArray(project.materials)) fail("Оновіть матеріали об’єкта.");
    const projectCurrency = currency(project.currency);
    for (const material of project.materials || []) {
      if (!material || !id(material.name)) fail("Перевірте назви матеріалів об’єкта.", "INSTALLATION_BINDING");
      if (currency(material.currency) !== projectCurrency) fail("Валюта матеріалу «" + material.name + "» не збігається з валютою об’єкта.", "INSTALLATION_CURRENCY");
      for (const field of ["plannedQty", "issuedQty", "actualQty"]) materialQuantity(material, field, material.unit || "шт");
      if (!id(material.warehouseItemId) && (Number(material.issuedQty || 0) > 0 || Number(material.actualQty || 0) > 0)) fail("Матеріал «" + material.name + "» має рух без прив’язки до складу. Спочатку перевірте його історію.", "INSTALLATION_BINDING");
    }
    const completedOn = checkedDate(input.completedOn);
    if (completedOn > checkedDate(input.today || todayInKyiv())) fail("Дата виконання монтажу не може бути в майбутньому.", "INSTALLATION_DATE");
    if (!Array.isArray(input.lines) || !input.lines.length) fail("Додайте фактично змонтоване обладнання.");
    const seen = new Set();
    const lines = input.lines.map((raw) => {
      if (!raw || !id(raw.itemId)) fail("Оберіть кожну позицію зі складу.", "INSTALLATION_BINDING");
      const itemId = id(raw.itemId);
      if (seen.has(itemId)) fail("Об’єднайте повторні рядки одного товару.");
      seen.add(itemId);
      const foundItems = state.items.filter((entry) => id(entry.id) === itemId);
      if (foundItems.length !== 1 || !warehouse.isStockItem(foundItems[0])) fail("Товар не знайдено в номенклатурі фізичного складу.", "INSTALLATION_BINDING");
      const item = foundItems[0];
      if (currency(item.currency) !== projectCurrency || raw.currency != null && currency(raw.currency) !== projectCurrency) fail("Валюта обладнання та об’єкта має збігатися. USD та гривня обліковуються окремо.", "INSTALLATION_CURRENCY");
      const unit = item.unit || "шт";
      if (raw.unit != null && warehouse.normalizeText(raw.unit) !== warehouse.normalizeText(unit)) fail("Одиниця обладнання не збігається з одиницею складу.", "INSTALLATION_UNIT");
      if (item.serialTracking || id(item.serialNumber) || Array.isArray(item.serialNumbers) && item.serialNumbers.length) fail("Для «" + item.name + "» увімкнений серійний облік. Автоматичне завершення без вибору серійних номерів недоступне.", "INSTALLATION_SERIALS");
      const qty = warehouse.quantity(raw.qty, unit, { allowZero: true });
      const indices = materialBinding(project, item);
      let issuedQty = 0, actualQty = 0, originalCost = 0, originalSale = 0;
      indices.forEach((index) => {
        const material = project.materials[index];
        if (currency(material.currency) !== projectCurrency) fail("Валюта матеріалу не збігається з валютою об’єкта.", "INSTALLATION_CURRENCY");
        if (warehouse.normalizeText(material.unit || "шт") !== warehouse.normalizeText(unit)) fail("Одиниця матеріалу не збігається з одиницею складу.", "INSTALLATION_UNIT");
        const issued = materialQuantity(material, "issuedQty", unit), actual = materialQuantity(material, "actualQty", unit);
        materialQuantity(material, "plannedQty", unit);
        if (actual > issued) fail("Фактична кількість перевищує раніше видану. Перевірте історію матеріалу.", "INSTALLATION_HISTORY");
        if (issued > 0) {
          originalCost += issued * money(material.purchasePriceSnapshot, "історична закупівельна ціна");
          originalSale += issued * money(material.salePriceSnapshot, "історична ціна продажу");
        }
        issuedQty = round(issuedQty + issued); actualQty = round(actualQty + actual);
      });
      if (qty < actualQty) fail("Кількість «" + item.name + "» не може бути меншою за вже підтверджений монтаж: " + actualQty + " " + unit + ".", "INSTALLATION_HISTORY");
      const issueQty = round(Math.max(0, qty - issuedQty));
      const consumeQty = round(qty - actualQty);
      const availableQty = warehouse.availableQty(item, state.reservations || [], projectId, state.orderReservations || []);
      if (issueQty > availableQty) fail("Недостатньо вільного залишку «" + item.name + "»: доступно " + availableQty + " " + unit + ", потрібно додатково " + issueQty + ".", "INSTALLATION_STOCK");
      const stockUnitCost = warehouse.unitCost(item);
      const stockSalePrice = money(item.installerPrice ?? item.salePrice ?? 0, "ціна продажу");
      const finalIssued = round(issuedQty + issueQty);
      return { itemId, itemName: item.name, unit, currency: projectCurrency, qty, issuedQty, actualQty, issueQty, consumeQty, availableQty,
        stockUnitCost, stockSalePrice, unitCost: issuedQty > 0 ? originalCost / issuedQty : stockUnitCost,
        salePrice: issuedQty > 0 ? originalSale / issuedQty : stockSalePrice,
        finalUnitCost: finalIssued > 0 ? (originalCost + issueQty * stockUnitCost) / finalIssued : stockUnitCost,
        finalSalePrice: finalIssued > 0 ? (originalSale + issueQty * stockSalePrice) / finalIssued : stockSalePrice,
        materialIndices: indices };
    });
    if (!lines.some((line) => line.qty > 0)) fail("Додайте хоча б одну фактично змонтовану одиницю обладнання.");
    for (const material of project.materials || []) {
      if (Number(material.actualQty || 0) <= 0) continue;
      if (!id(material.warehouseItemId)) fail("Змонтований матеріал «" + material.name + "» не прив’язаний до складу. Перевірте його історію.", "INSTALLATION_BINDING");
      if (!seen.has(id(material.warehouseItemId))) fail("Додайте до підсумкового переліку вже змонтований матеріал «" + material.name + "».", "INSTALLATION_HISTORY");
    }
    return { projectId, projectTitle: project.title || "Об’єкт", currency: projectCurrency, completedOn, lines };
  }
  function summarizePlan(state, input) { return copy(plan(state, input)); }
  function complete(state, input) {
    validateState(state);
    const projectId = id(input && input.projectId);
    if (!projectId || !state.projects.some((entry) => id(entry.id) === projectId)) fail("Оберіть об’єкт монтажу.");
    const previous = completion(state, projectId);
    if (previous) return Object.assign(copy(state), { document: previous, completion: copy(previous), alreadyCompleted: true });
    const summary = plan(state, input);
    const docId = id(input.id) || documentId(projectId);
    if (state.documents.some((entry) => id(entry.id) === docId) || state.movements.some((entry) => id(entry.documentId) === docId)) fail("Ідентифікатор підтвердження вже використано іншим документом.", "INSTALLATION_HISTORY");
    const recordedAt = input.recordedAt || new Date().toISOString();
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(recordedAt) || !Number.isFinite(new Date(recordedAt).getTime())) fail("Некоректна дата й час підтвердження монтажу.");
    checkedDate(recordedAt.slice(0, 10));
    const actor = typeof input.actor === "string" ? { id: input.actor } : input.actor || {};
    const auditActor = { id: id(actor.id) || "local", name: id(actor.name || actor.fullName || actor.email) || "Локальний користувач" };
    const next = copy(state);
    const project = next.projects.find((entry) => id(entry.id) === projectId);
    project.materials = project.materials || [];
    const finalLines = summary.lines.filter((line) => line.qty > 0).map((line) => ({ itemId: line.itemId, itemName: line.itemName, currency: line.currency, unit: line.unit, qty: line.qty,
      issuedBefore: line.issuedQty, actualBefore: line.actualQty, issuedQty: line.issueQty, consumedQty: line.consumeQty,
      unitCost: line.finalUnitCost, salePrice: line.finalSalePrice }));
    const document = { id: docId, number: "МОНТ-" + projectId, type: "consume", kind: KIND, status: "posted", currency: summary.currency,
      projectId, projectTitle: summary.projectTitle, date: summary.completedOn, completedOn: summary.completedOn,
      createdAt: new Date(recordedAt).toISOString(), recordedAt: new Date(recordedAt).toISOString(), createdBy: auditActor.id, createdByName: auditActor.name,
      actor: auditActor, note: "Монтаж виконано", lines: copy(finalLines), finalLines: copy(finalLines), attachments: [] };
    const newMovements = [];
    for (const line of summary.lines) {
      const item = next.items.find((entry) => id(entry.id) === line.itemId);
      const indices = line.materialIndices.slice();
      if (line.issueQty > 0) {
        if (!indices.length) {
          indices.push(project.materials.length);
          project.materials.push({ currency: summary.currency, name: item.name, category: item.category || "Інше", sku: item.sku || "", warehouseItemId: item.id,
            plannedQty: 0, issuedQty: 0, actualQty: 0, purchasePriceSnapshot: line.stockUnitCost, salePriceSnapshot: line.stockSalePrice, unit: line.unit });
        }
        const material = project.materials[indices[0]];
        const priorIssued = Number(material.issuedQty || 0), finalIssued = round(priorIssued + line.issueQty);
        material.purchasePriceSnapshot = (priorIssued * Number(material.purchasePriceSnapshot || 0) + line.issueQty * line.stockUnitCost) / finalIssued;
        material.salePriceSnapshot = (priorIssued * Number(material.salePriceSnapshot || 0) + line.issueQty * line.stockSalePrice) / finalIssued;
        material.warehouseItemId = item.id; material.currency = summary.currency; material.unit = line.unit;
        material.issuedQty = finalIssued; material.plannedQty = Math.max(Number(material.plannedQty || 0), finalIssued);
        item.qty = round(Number(item.qty || 0) - line.issueQty);
        next.reservations = warehouse.consumeReservation(next.reservations || [], item.id, projectId, line.issueQty);
      }
      let remaining = line.consumeQty;
      for (const index of indices) {
        const material = project.materials[index];
        const beforeActual = Number(material.actualQty || 0);
        const delta = Math.min(remaining, round(Number(material.issuedQty || 0) - beforeActual));
        if (delta > 0) material.actualQty = round(beforeActual + delta);
        remaining = round(remaining - delta);
      }
      if (remaining !== 0) fail("Неможливо підтвердити монтаж поза виданим обладнанням.", "INSTALLATION_HISTORY");
      const movement = (type, qty, unitCost, salePrice) => ({ id: docId + "-" + type + "-" + encodeURIComponent(line.itemId), type,
        currency: summary.currency, itemId: item.id, itemName: item.name, projectId, qty, unit: line.unit, unitCost, materialSalePrice: salePrice,
        documentId: docId, documentNumber: document.number, date: document.date, createdAt: document.createdAt, recordedAt: document.recordedAt,
        createdBy: auditActor.id, createdByName: auditActor.name, note: "Монтаж виконано", supplier: item.supplier || "" });
      if (line.issueQty > 0) newMovements.push(movement("project", line.issueQty, line.stockUnitCost, line.stockSalePrice));
      // Existing warehouse RPC checks consume cost against the PREVIOUS issued
      // pool. New issues change the material's weighted snapshot, not history.
      if (line.consumeQty > 0) newMovements.push(movement("consume", line.consumeQty, line.unitCost, line.salePrice));
    }
    next.movements = newMovements.concat(next.movements);
    next.documents.unshift(document);
    return Object.assign(next, { document: copy(document), completion: copy(document), alreadyCompleted: false });
  }

  return Object.freeze({ complete, completion, summarizePlan, documentId });
});
