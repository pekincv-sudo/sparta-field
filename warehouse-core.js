(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SpartaWarehouseCore = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const categories = Object.freeze([
    { id: "panels", label: "Фотомодулі", aliases: ["Фотомодулі", "Панелі", "Сонячні панелі"] },
    { id: "inverters", label: "Інвертори", aliases: ["Інвертори", "Інвертор"] },
    { id: "batteries", label: "Акумулятори", aliases: ["АКБ", "Акумулятори", "Батареї"] },
    { id: "mounting", label: "Кріплення", aliases: ["Кріплення", "Конструкції", "Кріплення та конструкції"] },
    { id: "cables", label: "Кабелі й з’єднання", aliases: ["Кабелі", "Кабель", "Конектори", "Кабелі й з’єднання", "Кабелі та з'єднання"] },
    { id: "protection", label: "Електрозахист і щити", aliases: ["Захист", "Щити", "Електрозахист", "Електрозахист і щити"] },
    { id: "monitoring", label: "Моніторинг та аксесуари", aliases: ["Моніторинг", "Аксесуари", "Моніторинг та аксесуари"] },
    { id: "tools", label: "Інструмент", aliases: ["Інструмент", "Інструменти"] },
    { id: "other", label: "Інше обладнання", aliases: ["Інше", "Комплектуючі", "Інше обладнання"] },
  ].map(function (entry) { Object.freeze(entry.aliases); return Object.freeze(entry); }));
  const serviceCategories = ["роботи", "робота", "послуги", "послуга", "витрати", "витрата", "зарплата", "services", "expenses"];
  const scalarFields = ["name", "category", "sku", "unit", "brand", "model", "barcode", "location", "supplier", "characteristics", "serialNumber", "image", "imageUrl"];
  const nonnegativeFields = ["minQty", "purchasePrice", "deliveryCost", "extraCost", "salePrice", "retailPrice", "installerPrice", "powerW", "powerKw", "capacityKwh", "voltageV", "phases", "crossSectionMm2"];

  function fail(message) { throw new Error(message); }
  function normalizeText(value) {
    return String(value == null ? "" : value).normalize("NFKC").toLocaleLowerCase("uk-UA").replace(/[’`ʼ]/g, "'").replace(/\s+/g, " ").trim();
  }
  function id(value) { return String(value == null ? "" : value).trim(); }
  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === "object") {
      const result = {};
      Object.keys(value).forEach(function (key) { result[key] = clone(value[key]); });
      return result;
    }
    return value;
  }
  function numeric(value, label) {
    if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") fail("Заповніть поле «" + label + "».");
    const result = Number(typeof value === "string" ? value.trim().replace(",", ".") : value);
    if (!Number.isFinite(result) || result < 0 || result > Number.MAX_SAFE_INTEGER / 1000) fail("Некоректне значення «" + label + "».");
    return result;
  }
  function timestamp(value, fallback) {
    if (!value) return fallback || "";
    const raw = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || !Number.isFinite(new Date(raw).getTime())) fail("Некоректна дата й час операції.");
    checkedDate(raw);
    return new Date(raw).toISOString();
  }
  function roundQuantity(value) { return Math.round((value + Number.EPSILON) * 1000) / 1000; }
  function wholeUnit(unit) { return /^(шт\.?|штук[аи]?|компл\.?|комплект[и]?|pcs?|set)$/i.test(String(unit || "шт").trim()); }
  function quantity(value, unit, options) {
    const result = numeric(value, "Кількість");
    if (!(options && options.allowZero) && result <= 0) fail("Кількість має бути більшою за нуль.");
    if (wholeUnit(unit) && !Number.isInteger(result)) fail("Для штук і комплектів потрібна ціла кількість.");
    if (Math.abs(result - roundQuantity(result)) > 1e-9) fail("Кількість може мати не більше трьох знаків після коми.");
    return result;
  }
  function unitCost(item) {
    return numeric(item.purchasePrice == null ? 0 : item.purchasePrice, "Закупівельна ціна") +
      numeric(item.deliveryCost == null ? 0 : item.deliveryCost, "Доставка") +
      numeric(item.extraCost == null ? 0 : item.extraCost, "Додаткові витрати");
  }
  function groupFor(item) {
    const raw = normalizeText(typeof item === "string" ? item : item && item.category);
    const found = categories.find(function (entry) { return entry.id === raw || entry.aliases.some(function (alias) { return normalizeText(alias) === raw; }); });
    return found ? found.id : "other";
  }
  function isStockItem(item) {
    return Boolean(item) && !serviceCategories.includes(normalizeText(item.category)) && item.type !== "service" && item.isStockItem !== false;
  }
  function reservedQty(reservations, itemId, projectId) {
    return roundQuantity((reservations || []).reduce(function (sum, reservation) {
      if (id(reservation.itemId) !== id(itemId) || (projectId != null && id(reservation.projectId) !== id(projectId))) return sum;
      return sum + quantity(reservation.qty, "м", { allowZero: true });
    }, 0));
  }
  // A project's own reservation remains available when it receives its goods.
  function availableQty(item, reservations, projectId) {
    const own = projectId == null ? 0 : reservedQty(reservations, item.id, projectId);
    return Math.max(0, roundQuantity(quantity(item.qty == null ? 0 : item.qty, item.unit, { allowZero: true }) - reservedQty(reservations, item.id) + own));
  }
  function filterItems(items, filters, reservations) {
    const criteria = filters || {};
    const queryWords = normalizeText(criteria.query).split(" ").filter(Boolean);
    return (items || []).filter(function (item) {
      if (!isStockItem(item)) return false;
      if (criteria.group && criteria.group !== "all" && groupFor(item) !== criteria.group && normalizeText(item.category) !== normalizeText(criteria.group)) return false;
      if (criteria.brand && normalizeText(item.brand) !== normalizeText(criteria.brand)) return false;
      const search = normalizeText([item.name, item.sku, item.category, item.brand, item.model, item.barcode, item.serialNumber,
        (item.serialNumbers || []).join(" "), item.characteristics, item.location, item.powerW, item.powerKw, item.capacityKwh, item.voltageV, item.phases, item.crossSectionMm2].join(" "));
      if (!queryWords.every(function (word) { return search.includes(word); })) return false;
      const physical = Number(item.qty || 0);
      const available = availableQty(item, reservations);
      const availability = criteria.availability;
      if (["in_stock", "stock"].includes(availability) && physical <= 0) return false;
      if (["available", "available_only"].includes(availability) && available <= 0) return false;
      if (["out", "out_of_stock", "zero"].includes(availability) && physical > 0) return false;
      if (availability === "reserved" && reservedQty(reservations, item.id) <= 0) return false;
      if (["low", "low_stock"].includes(availability) && available > Number(item.minQty || 0)) return false;
      return true;
    });
  }

  function validateCatalog(items, input, context) {
    if (!input || typeof input !== "object") fail("Заповніть картку обладнання.");
    const existing = (items || []).find(function (item) { return id(item.id) === id(input.id) && id(input.id); });
    const result = existing ? clone(existing) : { qty: 0 };
    result.id = id(input.id);
    if (!result.id) fail("Товар повинен мати ідентифікатор.");
    scalarFields.forEach(function (field) { if (Object.prototype.hasOwnProperty.call(input, field)) result[field] = String(input[field] == null ? "" : input[field]).trim(); });
    if (!result.name) fail("Вкажіть назву обладнання.");
    result.category = result.category || "Інше";
    result.unit = result.unit || "шт";
    if (!isStockItem(result)) fail("Роботи й витрати не належать до фізичного складу.");
    nonnegativeFields.forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(input, field)) result[field] = input[field] === "" || input[field] == null ? 0 : numeric(input[field], field);
    });
    if (Object.prototype.hasOwnProperty.call(input, "retailPrice")) result.salePrice = result.retailPrice;
    else if (Object.prototype.hasOwnProperty.call(input, "salePrice")) result.retailPrice = result.salePrice;
    if (result.phases != null && ![0, 1, 3].includes(result.phases)) fail("Кількість фаз має бути 1 або 3.");
    if (result.sku && (items || []).some(function (item) { return id(item.id) !== result.id && normalizeText(item.sku) === normalizeText(result.sku); })) fail("Товар із таким артикулом уже існує.");
    if (!result.sku) {
      let suffix = (items || []).length + 1;
      do { result.sku = "SP-" + String(suffix++).padStart(5, "0"); }
      while ((items || []).some(function (item) { return normalizeText(item.sku) === normalizeText(result.sku); }));
    }
    if (Object.prototype.hasOwnProperty.call(input, "serialTracking")) result.serialTracking = Boolean(input.serialTracking);
    // Catalog editing never creates or replaces inventory quantities/cost history.
    result.qty = existing ? quantity(existing.qty == null ? 0 : existing.qty, result.unit, { allowZero: true }) : 0;
    if (existing && input.unit && normalizeText(input.unit) !== normalizeText(existing.unit || "шт")) {
      const history = context || {};
      const hasMovements = (history.movements || []).some(function (movement) { return id(movement.itemId) === result.id; });
      const hasReservations = (history.reservations || []).some(function (reservation) { return id(reservation.itemId) === result.id && Number(reservation.qty) > 0; });
      const hasObjectStock = (history.projects || []).some(function (project) { return (project.materials || []).some(function (material) { return id(material.warehouseItemId) === result.id && Number(material.issuedQty || 0) > 0; }); });
      if (Number(existing.qty || 0) > 0 || hasMovements || hasReservations || hasObjectStock) fail("Не можна змінити одиницю виміру товару із залишком, резервом або історією руху. Створіть окремий товар.");
    }
    if (existing && Number(existing.qty || 0) > 0) ["purchasePrice", "deliveryCost", "extraCost"].forEach(function (field) { result[field] = Number(existing[field] || 0); });
    return result;
  }
  function saveCatalog(items, input, context) {
    const result = validateCatalog(items, input, context);
    const exists = (items || []).some(function (item) { return id(item.id) === result.id; });
    return exists ? items.map(function (item) { return id(item.id) === result.id ? result : item; }) : [result].concat(items || []);
  }
  function checkedDate(value) {
    const raw = id(value);
    if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw)) fail("Вкажіть коректну дату документа.");
    const datePart = raw.slice(0, 10);
    const date = new Date(datePart + "T00:00:00.000Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== datePart || (raw.length > 10 && !Number.isFinite(new Date(raw).getTime()))) fail("Вкажіть коректну дату документа.");
    return raw.length === 10 ? raw : new Date(raw).toISOString();
  }
  function documentHeader(state, doc, type) {
    if (!state || !Array.isArray(state.items) || !doc || typeof doc !== "object") fail("Немає даних складського документа.");
    const documentId = id(doc.id);
    if (!documentId) fail("Документ повинен мати ідентифікатор.");
    if ((state.documents || []).some(function (entry) { return id(entry.id) === documentId && entry.status !== "draft"; }) ||
      (state.movements || []).some(function (entry) { return id(entry.documentId) === documentId; })) fail("Цей документ уже проведено.");
    if (!Array.isArray(doc.lines) || !doc.lines.length) fail("Додайте хоча б одну позицію документа.");
    const result = {
      id: documentId, type: type, status: "posted", number: id(doc.number) || documentId,
      date: checkedDate(doc.date), supplier: id(doc.supplier), note: id(doc.note), reason: id(doc.reason),
      location: id(doc.location), attachments: clone(Array.isArray(doc.attachments) ? doc.attachments : []),
      createdBy: id(doc.createdBy), createdByName: id(doc.createdByName), createdAt: timestamp(doc.createdAt), lines: [],
    };
    result.createdAt = result.createdAt || (result.date.length === 10 ? result.date + "T12:00:00.000Z" : result.date);
    return result;
  }
  function postingResult(state, document, items, movements) {
    return { items: items, movements: movements.concat(state.movements || []),
      documents: [document].concat((state.documents || []).filter(function (entry) { return id(entry.id) !== document.id; })), document: document };
  }
  function movementFor(document, item, line, index, type) {
    return { id: document.id + "-line-" + (index + 1), type: type, documentId: document.id, documentNumber: document.number,
      date: document.date, createdAt: document.createdAt, createdBy: document.createdBy, itemId: item.id, itemName: item.name,
      qty: line.qty, unit: item.unit || "шт", unitCost: line.unitCost, supplier: document.supplier,
      location: document.location || item.location || "", note: document.note || document.reason || "", serialNumbers: clone(line.serialNumbers || []) };
  }
  function postReceipt(state, doc) {
    const document = documentHeader(state, doc, "purchase");
    const items = state.items.map(clone);
    const movements = [];
    const seenItems = new Set();
    const serials = new Set(items.flatMap(function (item) { return (item.serialNumbers || []).concat(item.serialNumber ? [item.serialNumber] : []).map(normalizeText); }));
    doc.lines.forEach(function (raw, index) {
      const item = items.find(function (entry) { return id(entry.id) === id(raw.itemId); });
      if (!item || !isStockItem(item)) fail("Позицію " + (index + 1) + " не знайдено в каталозі обладнання.");
      if (seenItems.has(id(item.id))) fail("Об’єднайте повторні рядки одного товару в документі.");
      seenItems.add(id(item.id));
      const qty = quantity(raw.qty, item.unit);
      const purchasePrice = numeric(raw.purchasePrice, "Закупівельна ціна");
      const deliveryCost = numeric(raw.deliveryCost == null ? 0 : raw.deliveryCost, "Доставка за одиницю");
      const extraCost = numeric(raw.extraCost == null ? 0 : raw.extraCost, "Додаткові витрати за одиницю");
      if (raw.serialNumbers != null && !Array.isArray(raw.serialNumbers)) fail("Серійні номери мають бути списком.");
      const incomingSerials = (raw.serialNumbers || []).map(id).filter(Boolean);
      if (incomingSerials.length && (!wholeUnit(item.unit) || incomingSerials.length !== qty)) fail("Кількість серійних номерів має відповідати кількості товару.");
      if (item.serialTracking && incomingSerials.length !== qty) fail("Заповніть серійний номер кожної одиниці «" + item.name + "».");
      incomingSerials.forEach(function (serial) {
        const normalized = normalizeText(serial);
        if (serials.has(normalized)) fail("Серійний номер «" + serial + "» уже зареєстровано.");
        serials.add(normalized);
      });
      const beforeQty = quantity(item.qty == null ? 0 : item.qty, item.unit, { allowZero: true });
      const afterQty = quantity(roundQuantity(beforeQty + qty), item.unit);
      const line = { itemId: item.id, itemName: item.name, qty: qty, unit: item.unit || "шт", purchasePrice: purchasePrice,
        deliveryCost: deliveryCost, extraCost: extraCost, unitCost: purchasePrice + deliveryCost + extraCost,
        beforeQty: beforeQty, afterQty: afterQty, previousUnitCost: unitCost(item), serialNumbers: incomingSerials };
      ["purchasePrice", "deliveryCost", "extraCost"].forEach(function (field) {
        item[field] = (beforeQty * Number(item[field] || 0) + qty * line[field]) / afterQty;
      });
      item.qty = afterQty;
      if (document.location) item.location = document.location;
      if (document.supplier) item.supplier = document.supplier;
      if (incomingSerials.length) item.serialNumbers = (item.serialNumbers || []).concat(incomingSerials);
      document.lines.push(line);
      movements.push(movementFor(document, item, line, index, "purchase"));
    });
    document.total = document.lines.reduce(function (sum, line) { return sum + line.qty * line.unitCost; }, 0);
    return postingResult(state, document, items, movements);
  }
  function postStocktake(state, doc) {
    const document = documentHeader(state, doc, "stocktake");
    if (!document.reason && !document.note) fail("Вкажіть причину коригування залишків.");
    document.reason = document.reason || document.note;
    const items = state.items.map(clone);
    const movements = [];
    const seenItems = new Set();
    doc.lines.forEach(function (raw, index) {
      const item = items.find(function (entry) { return id(entry.id) === id(raw.itemId); });
      if (!item || !isStockItem(item)) fail("Позицію " + (index + 1) + " не знайдено в каталозі обладнання.");
      if (seenItems.has(id(item.id))) fail("Товар можна перерахувати лише один раз у документі.");
      seenItems.add(id(item.id));
      const beforeQty = quantity(item.qty == null ? 0 : item.qty, item.unit, { allowZero: true });
      const countedQty = quantity(raw.countedQty, item.unit, { allowZero: true });
      const reserved = reservedQty(state.reservations || [], item.id);
      if (countedQty < reserved) fail("Фактичний залишок менший за резерв. Спочатку перегляньте резервування.");
      const delta = roundQuantity(countedQty - beforeQty);
      const line = { itemId: item.id, itemName: item.name, unit: item.unit || "шт", beforeQty: beforeQty,
        countedQty: countedQty, afterQty: countedQty, qty: delta, delta: delta, unitCost: unitCost(item) };
      item.qty = countedQty;
      document.lines.push(line);
      if (delta !== 0) movements.push(Object.assign(movementFor(document, item, line, index, "adjustment"), { delta: delta, beforeQty: beforeQty, afterQty: countedQty, reason: document.reason }));
    });
    document.total = document.lines.reduce(function (sum, line) { return sum + line.delta * line.unitCost; }, 0);
    return postingResult(state, document, items, movements);
  }
  function reserve(state, input) {
    if (!state || !input || !id(input.id) || !id(input.projectId)) fail("Виберіть об’єкт і вкажіть ідентифікатор резерву.");
    const item = (state.items || []).find(function (entry) { return id(entry.id) === id(input.itemId); });
    if (!item || !isStockItem(item)) fail("Товар не знайдено в каталозі обладнання.");
    const qty = quantity(input.qty, item.unit);
    const reservations = state.reservations || [];
    if (reservations.some(function (entry) { return id(entry.id) === id(input.id); })) fail("Резерв із таким ідентифікатором уже існує.");
    if (qty > availableQty(item, reservations)) fail("Недостатньо вільного залишку для резервування.");
    const reservation = { id: id(input.id), itemId: item.id, projectId: id(input.projectId), qty: qty,
      createdAt: timestamp(input.createdAt), createdBy: id(input.createdBy) };
    return { items: state.items, reservations: reservations.concat([reservation]), reservation: reservation };
  }
  function releaseReservation(reservations, reservationId) {
    return (reservations || []).filter(function (entry) { return id(entry.id) !== id(reservationId); });
  }
  function consumeReservation(reservations, itemId, projectId, qty) {
    let remaining = quantity(qty, "м", { allowZero: true });
    return (reservations || []).reduce(function (result, entry) {
      if (id(entry.itemId) !== id(itemId) || id(entry.projectId) !== id(projectId) || remaining <= 0) { result.push(entry); return result; }
      const taken = Math.min(Number(entry.qty), remaining);
      remaining = roundQuantity(remaining - taken);
      const afterQty = roundQuantity(Number(entry.qty) - taken);
      if (afterQty > 0) result.push(Object.assign({}, entry, { qty: afterQty }));
      return result;
    }, []);
  }

  return Object.freeze({ categories: categories, normalizeText: normalizeText, quantity: quantity, unitCost: unitCost,
    groupFor: groupFor, isStockItem: isStockItem, filterItems: filterItems, reservedQty: reservedQty, availableQty: availableQty,
    validateCatalog: validateCatalog, saveCatalog: saveCatalog, postReceipt: postReceipt, postStocktake: postStocktake,
    reserve: reserve, releaseReservation: releaseReservation, consumeReservation: consumeReservation });
});
