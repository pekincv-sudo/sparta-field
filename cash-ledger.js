(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SpartaCash = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const categoryDirections = Object.freeze({
    client_payment: "income", client_refund: "expense", sale_payment: "income", sale_refund: "expense", labor: "expense", materials: "expense",
    other_income: "income", other_expense: "expense", opening_balance: "income",
  });
  const categoryLabels = Object.freeze({
    client_payment: "Оплата клієнта", client_refund: "Повернення клієнту", sale_payment: "Оплата покупця", sale_refund: "Повернення покупцю", labor: "Оплата робіт",
    materials: "Купівля матеріалів", other_income: "Інше надходження", other_expense: "Інша витрата",
    opening_balance: "Початковий залишок",
  });
  const sourceLabels = Object.freeze({ project: "Об’єкт", sale: "Продаж", general: "Інші операції" });
  const methods = Object.freeze(["cash", "bank", "card"]);
  const methodLabels = Object.freeze({ cash: "Готівка", bank: "Банківський рахунок", card: "Картка" });
  const kyivFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

  function fail(message) { throw new Error(message); }
  function safeAdd(a, b) {
    const result = a + b;
    if (!Number.isSafeInteger(result)) fail("Сума перевищує допустиму точність.");
    return result;
  }
  function text(value, field, required, maxLength) {
    const result = value == null ? "" : String(value).trim();
    if (required && !result) fail("Заповніть поле «" + field + "».");
    if (result.length > maxLength) fail("Поле «" + field + "» занадто довге.");
    return result;
  }
  function isoDate(value, field) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
      fail("Некоректна дата «" + field + "»: потрібен час із часовим поясом.");
    }
    const date = new Date(raw);
    const datePart = raw.slice(0, 10);
    const parts = datePart.split("-").map(Number);
    const calendarDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (!Number.isFinite(date.getTime()) || calendarDate.toISOString().slice(0, 10) !== datePart) {
      fail("Некоректна дата «" + field + "».");
    }
    return date.toISOString();
  }

  function kyivParts(instant) {
    const result = {};
    kyivFormatter.formatToParts(new Date(instant)).forEach(function (part) {
      if (["year", "month", "day", "hour", "minute", "second"].includes(part.type)) result[part.type] = Number(part.value);
    });
    return result;
  }
  function calendarStamp(parts) {
    // setUTCFullYear avoids Date.UTC's special interpretation of years 00–99.
    const date = new Date(0);
    date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
    date.setUTCHours(parts.hour || 0, parts.minute || 0, parts.second || 0, 0);
    return date.getTime();
  }
  function parseKyivDateTime(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw);
    if (!match) fail("Вкажіть дату та час у форматі РРРР-ММ-ДДТГГ:ХХ.");
    const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), second: 0 };
    const target = calendarStamp(parts);
    if (new Date(target).toISOString().slice(0, 16) !== raw || parts.hour > 23 || parts.minute > 59) fail("Некоректна дата та час оплати.");
    let candidate = target;
    for (let i = 0; i < 6; i += 1) {
      const delta = target - calendarStamp(kyivParts(candidate));
      if (delta === 0) break;
      candidate += delta;
    }
    if (calendarStamp(kyivParts(candidate)) !== target) fail("Цей місцевий час не існує через переведення годинника в Києві.");
    // If an autumn clock change repeats this minute, use the earlier occurrence.
    const earlier = candidate - 60 * 60 * 1000;
    if (calendarStamp(kyivParts(earlier)) === target) candidate = earlier;
    return new Date(candidate).toISOString();
  }

  // Decimal strings are converted digit-by-digit; no rounding of binary floats.
  function parseAmount(value) {
    if (typeof value !== "string" && typeof value !== "number") fail("Вкажіть суму.");
    const raw = String(value).trim();
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(raw)) fail("Сума має бути додатною, не більше двох знаків після коми.");
    const parts = raw.replace(",", ".").split(".");
    const minor = Number(parts[0]) * 100 + Number((parts[1] || "").padEnd(2, "0"));
    if (!Number.isSafeInteger(minor) || minor <= 0) fail("Сума має бути більшою за нуль і в межах допустимої точності.");
    return minor;
  }

  function formatAmount(amountMinor, currency = "USD") {
    if (!Number.isSafeInteger(amountMinor)) fail("Некоректна сума в мінімальних одиницях валюти.");
    const absolute = Math.abs(amountMinor);
    const whole = Math.floor(absolute / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
    return (amountMinor < 0 ? "−" : "") + whole + "," + String(absolute % 100).padStart(2, "0") + (currencyCode(currency) === "USD" ? " USD" : " грн");
  }

  function currencyCode(value, fallback = "UAH") {
    const code = String(value || fallback).toUpperCase();
    if (!["USD", "UAH"].includes(code)) fail("Підтримуються валюти USD та UAH.");
    return code;
  }

  // The returned snapshot contains scalar values only and cannot be edited.
  function validateEntry(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("Некоректна операція.");
    const category = text(entry.category, "Категорія", true, 40);
    const direction = text(entry.direction, "Тип операції", true, 20);
    const method = text(entry.method, "Спосіб оплати", true, 20);
    const reversesId = text(entry.reversesId, "Сторнована операція", false, 200) || null;
    if (!Object.prototype.hasOwnProperty.call(categoryDirections, category)) fail("Невідома категорія операції.");
    if (direction !== "income" && direction !== "expense") fail("Невідомий тип операції.");
    if (!reversesId && categoryDirections[category] && categoryDirections[category] !== direction) {
      fail("Категорія не відповідає типу операції.");
    }
    if (!methods.includes(method)) fail("Невідомий спосіб оплати.");
    if (!Number.isSafeInteger(entry.amountMinor) || entry.amountMinor <= 0) fail("Некоректна сума в мінімальних одиницях валюти.");
    const projectId = text(entry.projectId, "Об’єкт", false, 200) || null;
    const saleOrderId = text(entry.saleOrderId, "Замовлення покупця", false, 200) || null;
    const sourceType = text(entry.sourceType, "Напрям каси", false, 20) || (saleOrderId ? "sale" : projectId ? "project" : "general");
    if (!Object.prototype.hasOwnProperty.call(sourceLabels, sourceType)) fail("Невідомий напрям каси.");
    if ((sourceType === "project" && (!projectId || saleOrderId)) || (sourceType === "sale" && (!saleOrderId || projectId)) || (sourceType === "general" && (projectId || saleOrderId))) fail("Напрям каси не відповідає об’єкту або замовленню.");
    if (!saleOrderId && [entry.saleOrderNumber, entry.buyerId, entry.buyerName].some(function (value) { return value != null && String(value).trim(); })) fail("Дані покупця мають бути прив’язані до замовлення продажу.");
    if (["sale_payment", "sale_refund"].includes(category) && sourceType !== "sale") fail("Оплата покупця має бути прив’язана до замовлення продажу.");
    if (sourceType === "sale" && !["sale_payment", "sale_refund", "other_expense", "other_income"].includes(category)) fail("Для продажу виберіть оплату, повернення або іншу операцію продажу.");
    const normalized = {
      sourceType,
      saleOrderId,
      saleOrderNumber: text(entry.saleOrderNumber, "Номер замовлення", Boolean(saleOrderId), 200),
      buyerId: text(entry.buyerId, "Покупець", Boolean(saleOrderId), 200) || null,
      buyerName: text(entry.buyerName, "Ім’я покупця", Boolean(saleOrderId), 300),
      id: text(entry.id, "ID", true, 200),
      companyId: text(entry.companyId, "Компанія", true, 200),
      projectId: projectId,
      projectTitle: text(entry.projectTitle, "Назва об’єкта", Boolean(projectId), 300),
      direction: direction,
      category: category,
      amountMinor: entry.amountMinor,
      currency: currencyCode(entry.currency),
      counterparty: text(entry.counterparty, "Від кого / кому", true, 300),
      purpose: text(entry.purpose, "Призначення платежу", true, 2000),
      occurredAt: isoDate(entry.occurredAt, "Дата оплати"),
      method: method,
      createdAt: isoDate(entry.createdAt, "Дата внесення запису"),
      createdBy: text(entry.createdBy, "Автор запису", true, 300),
      reversesId: reversesId,
    };
    if (normalized.id === reversesId) fail("Операція не може сторнувати сама себе.");
    return Object.freeze(normalized);
  }

  function createEntry(input, options) {
    const opts = options || {};
    return validateEntry(Object.assign({}, input, {
      id: input.id || opts.id,
      currency: currencyCode(input.currency, "USD"),
      amountMinor: input.amountMinor == null ? parseAmount(input.amount) : input.amountMinor,
      createdAt: input.createdAt || opts.now,
    }));
  }

  function validateLedger(entries) {
    if (!Array.isArray(entries)) fail("Журнал має бути списком операцій.");
    const normalized = entries.map(validateEntry);
    const byId = new Map();
    const reversed = new Set();
    normalized.forEach(function (entry) {
      if (byId.has(entry.id)) fail("У журналі повторюється ID операції.");
      byId.set(entry.id, entry);
    });
    normalized.forEach(function (entry) {
      if (!entry.reversesId) return;
      const original = byId.get(entry.reversesId);
      if (!original || original.reversesId) fail("Не знайдено початкову операцію для сторнування.");
      if (reversed.has(original.id)) fail("Операція вже сторнована.");
      if (entry.companyId !== original.companyId || entry.projectId !== original.projectId || entry.projectTitle !== original.projectTitle ||
          entry.sourceType !== original.sourceType || entry.saleOrderId !== original.saleOrderId || entry.saleOrderNumber !== original.saleOrderNumber || entry.buyerId !== original.buyerId || entry.buyerName !== original.buyerName ||
          entry.category !== original.category || entry.amountMinor !== original.amountMinor || entry.currency !== original.currency ||
          entry.direction === original.direction || entry.method !== original.method) {
        fail("Сторнування не відповідає початковій операції.");
      }
      reversed.add(original.id);
    });
    return Object.freeze(normalized);
  }

  function totals(entries, currency) {
    const codes = new Set(entries.map((entry) => currencyCode(entry.currency)));
    if (!currency && codes.size > 1) fail("Підсумки USD та гривні потрібно рахувати окремо.");
    const selected = currencyCode(currency || [...codes][0], "USD");
    const result = { incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 };
    entries.forEach(function (raw) {
      const entry = validateEntry(raw);
      if (entry.currency !== selected) return;
      const key = entry.direction === "income" ? "incomeMinor" : "expenseMinor";
      result[key] = safeAdd(result[key], entry.amountMinor);
      result.balanceMinor = safeAdd(result.balanceMinor, entry.direction === "income" ? entry.amountMinor : -entry.amountMinor);
    });
    return Object.freeze(result);
  }

  function projectTotals(entries, projectId, currency) {
    const codes = new Set(entries.filter((entry) => entry.projectId === String(projectId)).map((entry) => currencyCode(entry.currency)));
    if (!currency && codes.size > 1) fail("Платежі об’єкта мають різні валюти.");
    currency = currency || [...codes][0] || "USD";
    const result = { clientPaidMinor: 0, recordedPayrollMinor: 0, recordedExpensesMinor: 0, materialsMinor: 0, otherExpensesMinor: 0 };
    entries.forEach(function (raw) {
      const entry = validateEntry(raw);
      if (!projectId || entry.projectId !== String(projectId)) return;
      if (entry.currency !== currencyCode(currency)) fail("Валюта платежу не збігається з валютою об’єкта.");
      const income = entry.direction === "income" ? entry.amountMinor : -entry.amountMinor;
      if (entry.category === "client_payment" || entry.category === "client_refund") result.clientPaidMinor = safeAdd(result.clientPaidMinor, income);
      if (entry.category === "labor") result.recordedPayrollMinor = safeAdd(result.recordedPayrollMinor, -income);
      if (entry.category === "materials") result.materialsMinor = safeAdd(result.materialsMinor, -income);
      if (entry.category === "other_expense") result.recordedExpensesMinor = safeAdd(result.recordedExpensesMinor, -income);
    });
    result.otherExpensesMinor = result.recordedExpensesMinor;
    return Object.freeze(result);
  }

  function sourceTotals(entries, currency) {
    const result = { all: totals(entries, currency) };
    Object.keys(sourceLabels).forEach(function (sourceType) {
      result[sourceType] = totals(entries.map(validateEntry).filter(function (entry) { return entry.sourceType === sourceType; }), currency);
    });
    return Object.freeze(result);
  }

  function saleTotals(entries, orderId, currency) {
    const selected = entries.map(validateEntry).filter(function (entry) { return entry.saleOrderId === String(orderId); });
    const codes = new Set(selected.map(function (entry) { return entry.currency; }));
    if (!currency && codes.size > 1) fail("Платежі замовлення мають різні валюти.");
    const code = currencyCode(currency || [...codes][0], "USD");
    let paidMinor = 0, expenseMinor = 0;
    selected.forEach(function (entry) {
      if (entry.currency !== code) fail("Валюта платежу не збігається з валютою замовлення.");
      const signed = entry.direction === "income" ? entry.amountMinor : -entry.amountMinor;
      if (["sale_payment", "sale_refund"].includes(entry.category)) paidMinor = safeAdd(paidMinor, signed);
      else expenseMinor = safeAdd(expenseMinor, -signed);
    });
    return Object.freeze({ paidMinor, expenseMinor });
  }

  function reversal(entries, originalOrId, options) {
    const ledger = validateLedger(entries);
    const id = typeof originalOrId === "string" ? originalOrId : originalOrId && originalOrId.id;
    const original = ledger.find(function (entry) { return entry.id === id; });
    if (!original) fail("Початкову операцію не знайдено у журналі.");
    if (original.reversesId) fail("Не можна сторнувати операцію сторнування.");
    if (ledger.some(function (entry) { return entry.reversesId === original.id; })) fail("Операція вже сторнована.");
    const opts = options || {};
    const entry = createEntry(Object.assign({}, original, {
      id: opts.id,
      direction: original.direction === "income" ? "expense" : "income",
      purpose: text(opts.purpose, "Причина сторнування", true, 2000),
      occurredAt: opts.occurredAt || opts.now,
      createdAt: opts.now,
      createdBy: opts.createdBy,
      reversesId: original.id,
    }));
    if (ledger.some(function (existing) { return existing.id === entry.id; })) fail("Такий ID операції вже існує.");
    return entry;
  }

  function rangeTime(value, isEnd) {
    if (!value) return null;
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const parts = raw.split("-").map(Number);
      const stamp = calendarStamp({ year: parts[0], month: parts[1], day: parts[2] });
      const date = new Date(stamp);
      if (date.toISOString().slice(0, 10) !== raw) fail("Некоректний період журналу.");
      if (isEnd) {
        date.setUTCDate(date.getUTCDate() + 1);
        return new Date(parseKyivDateTime(date.toISOString().slice(0, 10) + "T00:00")).getTime() - 1;
      }
      return new Date(parseKyivDateTime(raw + "T00:00")).getTime();
    }
    return new Date(isoDate(raw, "Період")).getTime();
  }

  function filterEntries(entries, filters) {
    const options = filters || {};
    const from = rangeTime(options.from, false);
    const to = rangeTime(options.to, true);
    if (from != null && to != null && from > to) fail("Початок періоду має бути до його закінчення.");
    const query = String(options.query || "").trim().toLocaleLowerCase("uk-UA");
    return entries.map(validateEntry).filter(function (entry) {
      const occurredAt = new Date(entry.occurredAt).getTime();
      if (options.projectId === "__none" ? Boolean(entry.projectId) : options.projectId && entry.projectId !== String(options.projectId)) return false;
      if (options.sourceType && options.sourceType !== "all" && entry.sourceType !== options.sourceType) return false;
      if (options.saleOrderId && entry.saleOrderId !== String(options.saleOrderId)) return false;
      if (options.direction && options.direction !== "all" && entry.direction !== options.direction) return false;
      if (options.currency && entry.currency !== currencyCode(options.currency)) return false;
      if (options.method && options.method !== "all" && entry.method !== options.method) return false;
      if (from != null && occurredAt < from || to != null && occurredAt > to) return false;
      return !query || [entry.counterparty, entry.purpose, entry.projectTitle, entry.saleOrderNumber, entry.buyerName, entry.id].join(" ").toLocaleLowerCase("uk-UA").includes(query);
    }).sort(function (a, b) {
      return b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
    });
  }

  function csvCell(value) {
    let raw = String(value == null ? "" : value);
    // Spreadsheet formulas may begin after whitespace; prefix untrusted text.
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(raw) || /^[\t\r\n]/.test(raw)) raw = "'" + raw;
    return '"' + raw.replace(/"/g, '""') + '"';
  }
  function decimalAmount(minor) { return Math.floor(minor / 100) + "," + String(minor % 100).padStart(2, "0"); }
  function exportCsv(entries) {
    const rows = [["ID", "Дата оплати (UTC)", "Тип", "Категорія", "Сума", "Валюта", "Спосіб оплати", "Від кого / кому", "Призначення", "ID об’єкта", "Об’єкт", "Дата запису (UTC)", "Автор", "Сторнує ID", "Напрям", "ID замовлення", "Номер замовлення", "Покупець"]];
    entries.forEach(function (raw) {
      const entry = validateEntry(raw);
      rows.push([entry.id, entry.occurredAt, entry.direction === "income" ? "Надходження" : "Витрата", categoryLabels[entry.category], decimalAmount(entry.amountMinor), entry.currency, methodLabels[entry.method], entry.counterparty, entry.purpose, entry.projectId || "", entry.projectTitle, entry.createdAt, entry.createdBy, entry.reversesId || "", sourceLabels[entry.sourceType], entry.saleOrderId || "", entry.saleOrderNumber, entry.buyerName]);
    });
    return "\ufeff" + rows.map(function (row) { return row.map(csvCell).join(";"); }).join("\r\n") + "\r\n";
  }

  return Object.freeze({ parseAmount: parseAmount, formatAmount: formatAmount, parseKyivDateTime: parseKyivDateTime, validateEntry: validateEntry,
    createEntry: createEntry, validateLedger: validateLedger, totals: totals, projectTotals: projectTotals, sourceTotals: sourceTotals, saleTotals: saleTotals,
    reversal: reversal, filterEntries: filterEntries, exportCsv: exportCsv,
    sourceLabels: sourceLabels, categoryDirections: categoryDirections, categoryLabels: categoryLabels, methods: methods, methodLabels: methodLabels });
});
