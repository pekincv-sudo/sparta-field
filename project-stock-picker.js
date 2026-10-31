(function (root, factory) {
  "use strict";
  const api = factory(root, typeof module === "object" && module.exports ? require("./warehouse-core.js") : root.SpartaWarehouseCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SpartaProjectStockPicker = api;
})(typeof window !== "undefined" ? window : null, function (root, core) {
  "use strict";
  const safe = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;");
  const id = value => String(value ?? "");
  const number = value => Number(value || 0).toLocaleString("uk-UA", { maximumFractionDigits: 3 });
  const money = (value, currency) => `${Number(value || 0).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${safe(currency)}`;
  const currencyOf = item => String(item?.currency || "UAH").toUpperCase();
  const priceFor = (item, target) => Number(target === "offer" ? item.retailPrice ?? item.installerPrice ?? item.salePrice ?? 0 : item.installerPrice ?? item.salePrice ?? 0);
  let session = null;

  function availabilityFor(item, state, target, projectId) {
    return core.availableQty(item, state.reservations, target === "materials" ? projectId : undefined, state.orderReservations);
  }
  function filterStock(state, filters, target, projectId, currency) {
    return core.filterItems(state.items, { query: filters.query, group: filters.group, brand: filters.brand }, state.reservations, state.orderReservations)
      .filter(item => (filters.otherCurrency || currencyOf(item) === currency) && (!filters.freeOnly || availabilityFor(item, state, target, projectId) > 0));
  }
  function summarize(state, selections, target, projectId, currency) {
    const lines = [], errors = [], shortages = [];
    let total = 0;
    selections.forEach((raw, itemId) => {
      const item = state.items.find(entry => id(entry.id) === id(itemId));
      if (!item || !core.isStockItem(item)) { errors.push("Вибраний товар більше недоступний у каталозі."); return; }
      if (currencyOf(item) !== currency) { errors.push(`«${item.name}»: валюта товару ${currencyOf(item)}, валюта проєкту ${currency}.`); return; }
      try {
        const qty = core.quantity(raw, item.unit);
        lines.push({ itemId: id(item.id), qty });
        total += qty * priceFor(item, target);
        const available = availabilityFor(item, state, target, projectId);
        if (qty > available) shortages.push({ itemId: id(item.id), name: item.name, qty, available, shortage: Math.round((qty - available) * 1000) / 1000, unit: item.unit || "шт" });
      } catch (error) { errors.push(`«${item.name}»: ${error.message}`); }
    });
    return { lines, total, errors, shortages, count: selections.size };
  }
  function actions() {
    if (!core || !root?.SpartaProjectStockActions) throw new Error("Модуль підбору обладнання ще не завантажено. Оновіть сторінку.");
    return root.SpartaProjectStockActions;
  }
  function allowed(ctx, target) { return target === "offer" ? ctx.canQuote : ctx.canPlan || ctx.canMove; }
  function projectContext(projectId, target) {
    const api = actions(), ctx = api.context(), project = api.project(projectId);
    if (!ctx?.ready) throw new Error("Увійдіть до компанії та відкрийте проєкт.");
    if (!project || project.closed) throw new Error("Відкрийте активний проєкт, щоб підібрати обладнання.");
    if (id(ctx.selectedProjectId) !== id(projectId)) throw new Error("Вибраний проєкт змінився. Відкрийте підбір обладнання заново.");
    if (!allowed(ctx, target)) throw new Error("У вас немає доступу до підбору обладнання для цього розділу.");
    return { ctx, project };
  }
  function current(value, capability) {
    if (session !== value) throw new Error("Підбір обладнання закрито.");
    try {
      const fresh = projectContext(value.projectId, value.target);
      if (fresh.ctx.key !== value.contextKey || currencyOf(fresh.project) !== value.currency || (capability && !fresh.ctx[capability])) throw new Error("Доступ або проєкт змінився. Відкрийте підбір обладнання заново.");
      return fresh;
    } catch (error) { if (session === value) reset(); throw error; }
  }
  function reset() {
    const previous = session; session = null;
    if (!previous) return;
    previous.selections.clear(); previous.drafts.clear(); previous.stock = { items: [], reservations: [], orderReservations: [] };
    if (previous.element.open && typeof previous.element.close === "function") previous.element.close();
    previous.element.remove();
  }
  function refreshAccess() {
    if (!session) return true;
    try { current(session); return true; } catch (_) { return false; }
  }
  function specs(item) {
    return [item.brand, item.model, item.powerW ? `${number(item.powerW)} Вт` : "", item.powerKw ? `${number(item.powerKw)} кВт` : "", item.capacityKwh ? `${number(item.capacityKwh)} кВт·год` : "", item.voltageV ? `${number(item.voltageV)} В` : "", item.phases ? `${number(item.phases)} ф.` : "", item.crossSectionMm2 ? `${number(item.crossSectionMm2)} мм²` : "", item.characteristics].filter(Boolean).join(" · ");
  }
  function rowNote(value, item) {
    if (!value.selections.has(id(item.id))) return "";
    try {
      const qty = core.quantity(value.selections.get(id(item.id)), item.unit);
      const free = availabilityFor(item, value.stock, value.target, value.projectId);
      return qty > free ? `У плані на ${number(qty - free)} ${item.unit || "шт"} більше, ніж доступно. Потрібна закупівля або поповнення.` : "";
    } catch (error) { return error.message; }
  }
  function card(value, item) {
    const itemId = id(item.id), selected = value.selections.has(itemId), mismatch = currencyOf(item) !== value.currency;
    const available = availabilityFor(item, value.stock, value.target, value.projectId);
    const reserved = core.reservedQty(value.stock.reservations, item.id, undefined, value.stock.orderReservations);
    const own = value.target === "materials" ? core.reservedQty(value.stock.reservations, item.id, value.projectId) : 0;
    const photo = root.SpartaProductPhotos?.thumbnailHtml(item) || '<span class="psp-photo-placeholder" aria-hidden="true">Фото ще немає</span>';
    const note = rowNote(value, item);
    return `<article class="psp-card${selected ? " is-selected" : ""}${mismatch ? " is-currency-mismatch" : ""}" data-psp-card="${safe(itemId)}"><div class="psp-product">${photo}<div><strong>${safe(item.name)}</strong><span class="psp-muted">${safe(item.sku || "Без артикулу")}</span><span class="psp-specs">${safe(specs(item) || core.categories.find(group => group.id === core.groupFor(item))?.label || item.category)}</span></div></div><div class="psp-stock"><span>Доступно<strong class="${available > 0 ? "psp-positive" : ""}">${number(available)} <small>${safe(item.unit || "шт")}</small></strong></span><span>Резерв<strong>${number(reserved)} <small>${safe(item.unit || "шт")}</small></strong></span><span>Ціна за ${safe(item.unit || "шт")}<strong>${money(priceFor(item, value.target), currencyOf(item))}</strong></span></div><div class="psp-location">${safe(item.location || "Основний склад")}${own ? `<span>Резерв цього проєкту: ${number(own)} ${safe(item.unit || "шт")} — включено в доступне</span>` : ""}</div><div class="psp-card-controls"><label class="psp-check"><input type="checkbox" data-psp-select="${safe(itemId)}" ${selected ? "checked" : ""} ${value.busy || mismatch ? "disabled" : ""}><span>Обрати</span></label><label class="psp-quantity">Кількість, ${safe(item.unit || "шт")}<input type="text" inputmode="decimal" autocomplete="off" data-psp-qty="${safe(itemId)}" aria-label="Кількість: ${safe(item.name)}" value="${safe(value.drafts.get(itemId) ?? "1")}" ${value.busy || mismatch ? "disabled" : ""}></label></div><p class="psp-row-note" data-psp-row-note ${note ? "" : "hidden"}>${safe(note)}</p>${mismatch ? `<p class="psp-currency-warning">Товар у ${safe(currencyOf(item))}, проєкт у ${safe(value.currency)}. Додавання недоступне; конвертація не виконується.</p>` : ""}</article>`;
  }
  function listHtml(value) {
    const items = filterStock(value.stock, value.filters, value.target, value.projectId, value.currency);
    const mismatchCount = core.filterItems(value.stock.items, {}, value.stock.reservations, value.stock.orderReservations).filter(item => currencyOf(item) !== value.currency).length;
    value.visibleIds = new Set(items.map(item => id(item.id)));
    return `<div class="psp-results-meta"><span>Знайдено: <strong>${items.length}</strong></span><span>${value.target === "offer" ? "Роздрібна ціна" : "Ціна монтажника"} · ${safe(value.currency)}</span></div>${items.length ? `<div class="psp-grid">${items.map(item => card(value, item)).join("")}</div>` : `<div class="psp-empty"><strong>${value.busy ? "Завантажуємо обладнання…" : "За цими фільтрами обладнання немає"}</strong>${value.busy ? "" : `<p>Змініть пошук, категорію або зніміть «Тільки вільні».</p>${mismatchCount && !value.filters.otherCurrency ? `<p>Товарів в іншій валюті: ${mismatchCount}. Увімкніть «Показати інші валюти», щоб переглянути їх.</p>` : ""}`}</div>`}`;
  }
  function footerHtml(value) {
    const summary = summarize(value.stock, value.selections, value.target, value.projectId, value.currency);
    const hidden = [...value.selections.keys()].filter(itemId => !value.visibleIds?.has(itemId)).length;
    const ctx = actions().context(), canAdd = value.target === "offer" ? ctx.canQuote : ctx.canPlan;
    const single = summary.lines.length === 1 && summary.count === 1 && !summary.errors.length ? summary.lines[0] : null;
    const item = single && value.stock.items.find(entry => id(entry.id) === single.itemId);
    const reserveFree = item ? core.availableQty(item, value.stock.reservations, undefined, value.stock.orderReservations) : 0;
    const issueFree = item ? availabilityFor(item, value.stock, "materials", value.projectId) : 0;
    return `<div class="psp-summary"><strong>Обрано позицій: ${summary.count}</strong><b>${money(summary.total, value.currency)}</b><small>${hidden ? `Поза поточним фільтром: ${hidden}. ` : ""}План: не резервує й не списує склад.</small></div>${summary.errors.length ? `<p class="psp-feedback is-error" role="alert">${safe(summary.errors[0])}</p>` : ""}${summary.shortages.length ? `<p class="psp-feedback is-warning">Перевищено доступний залишок у ${summary.shortages.length} поз. Можна додати до плану; для видачі потрібне поповнення.</p>` : ""}<div class="psp-footer-actions">${summary.count ? `<button type="button" class="psp-subtle" data-psp-action="clear" ${value.busy ? "disabled" : ""}>Очистити вибір</button>` : ""}${value.target === "materials" && ctx.canMove ? `<div class="psp-move-actions" aria-label="Операція для однієї вибраної позиції"><button type="button" class="psp-secondary" data-psp-action="reserve" ${value.busy || !single || single.qty > reserveFree ? "disabled" : ""} title="Виберіть одну позицію в межах вільного залишку. Далі відкриється складський документ.">Резерв</button><button type="button" class="psp-secondary" data-psp-action="project" ${value.busy || !single || single.qty > issueFree ? "disabled" : ""} title="Виберіть одну позицію в межах доступного залишку. Далі відкриється документ видачі.">Видати</button></div>` : ""}<button type="button" class="psp-primary" data-psp-action="add" ${value.busy || !canAdd || !summary.count || summary.errors.length ? "disabled" : ""}>${value.busy === "add" ? "Додаємо…" : value.target === "offer" ? "Додати до КП" : "Додати до плану"}</button></div>${value.target === "materials" && ctx.canMove ? '<small class="psp-move-help">Резерв і видача відкриють документ для підтвердження.</small>' : ""}`;
  }
  function noticeHtml(value) {
    return `${value.busy === "load" ? '<p class="psp-feedback" role="status">Оновлюємо залишки…</p>' : ""}${value.error ? `<p class="psp-feedback is-error" role="alert">${safe(value.error)}</p>` : ""}${value.notice ? `<p class="psp-feedback is-success" role="status">${safe(value.notice)}</p>` : ""}`;
  }
  function updateFooter(value) {
    if (session !== value) return;
    const footer = value.element.querySelector("[data-psp-footer]");
    if (footer) footer.innerHTML = footerHtml(value);
  }
  function updateList(value) {
    if (session !== value) return;
    const list = value.element.querySelector("[data-psp-list]");
    if (list) list.innerHTML = listHtml(value);
    updateFooter(value);
  }
  function currencyInfo(value) {
    return `${safe(value.currency)} · ${value.filters.otherCurrency ? "інші валюти лише для перегляду; " : ""}без конвертації · ${value.target === "materials" ? "доступно з резервом цього проєкту" : "доступно без усіх резервів"}`;
  }
  function render(value) {
    if (session !== value) return;
    const brands = [...new Set(core.filterItems(value.stock.items, {}).map(item => item.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, "uk"));
    value.element.innerHTML = `<div class="psp-shell"><header class="psp-header"><div class="psp-heading"><div><h2 id="projectStockPickerTitle">${value.target === "offer" ? "Додати обладнання до КП" : "Обладнання для проєкту"}</h2><p class="psp-project-title">${safe(value.title)}</p></div><button type="button" class="psp-close psp-secondary" data-psp-action="close" aria-label="Закрити підбір обладнання">×</button></div><label class="psp-search"><span class="psp-sr-only">Пошук обладнання</span><input type="search" data-psp-filter="query" placeholder="Назва, модель, артикул, бренд, характеристики" value="${safe(value.filters.query)}" autocomplete="off" ${value.busy ? "disabled" : ""}></label><div class="psp-categories" aria-label="Категорії обладнання"><button type="button" data-psp-group="" aria-pressed="${!value.filters.group}">Усе обладнання</button>${core.categories.map(group => `<button type="button" data-psp-group="${safe(group.id)}" aria-pressed="${value.filters.group === group.id}">${safe(group.label)}</button>`).join("")}</div><div class="psp-filters"><label class="psp-brand"><span class="psp-sr-only">Бренд</span><select data-psp-filter="brand" ${value.busy ? "disabled" : ""}><option value="">Усі бренди</option>${brands.map(brand => `<option value="${safe(brand)}" ${value.filters.brand === brand ? "selected" : ""}>${safe(brand)}</option>`).join("")}</select></label><label class="psp-check"><input type="checkbox" data-psp-filter="freeOnly" ${value.filters.freeOnly ? "checked" : ""}><span>Тільки вільні</span></label><label class="psp-check"><input type="checkbox" data-psp-filter="otherCurrency" ${value.filters.otherCurrency ? "checked" : ""}><span>Показати інші валюти</span></label><button type="button" class="psp-refresh psp-subtle" data-psp-action="refresh" ${value.busy ? "disabled" : ""} aria-label="Оновити залишки">↻ Оновити</button></div><p class="psp-currency-info">${currencyInfo(value)}</p><div data-psp-notice aria-live="polite">${noticeHtml(value)}</div></header><section class="psp-list" data-psp-list aria-label="Складське обладнання">${listHtml(value)}</section><footer class="psp-footer" data-psp-footer>${footerHtml(value)}</footer></div>`;
  }
  async function load(value) {
    if (value.busy && value.busy !== "load") return;
    try {
      current(value); value.busy = "load"; value.error = ""; render(value);
      const state = await actions().stock({ refresh: true });
      current(value);
      if (!state || !Array.isArray(state.items)) throw new Error("Не вдалося отримати склад. Спробуйте оновити залишки.");
      value.stock = state;
    } catch (error) { if (session === value) value.error = error.message; }
    finally { if (session === value) { value.busy = ""; render(value); } }
  }
  async function add(value) {
    if (value.busy || !value.selections.size) return;
    try {
      current(value, value.target === "offer" ? "canQuote" : "canPlan");
      const summary = summarize(value.stock, value.selections, value.target, value.projectId, value.currency);
      if (summary.errors.length) throw new Error(summary.errors[0]);
      value.busy = "add"; value.error = ""; value.notice = ""; render(value);
      const result = await actions().add({ projectId: value.projectId, target: value.target, lines: summary.lines });
      current(value, value.target === "offer" ? "canQuote" : "canPlan");
      value.selections.clear(); value.drafts.clear();
      value.notice = result?.message || (value.target === "offer" ? "Обладнання додано до КП. Залишки складу не змінено." : "Обладнання додано до плану матеріалів. Залишки складу не змінено.");
    } catch (error) { if (session === value) value.error = error.message; }
    finally { if (session === value) { value.busy = ""; render(value); } }
  }
  async function move(value, type) {
    if (value.busy || value.target !== "materials") return;
    let handoffKey = null;
    try {
      current(value, "canMove");
      const summary = summarize(value.stock, value.selections, value.target, value.projectId, value.currency);
      if (summary.errors.length || summary.lines.length !== 1 || summary.count !== 1) throw new Error("Виберіть одну позицію та вкажіть коректну кількість.");
      const line = summary.lines[0], item = value.stock.items.find(entry => id(entry.id) === line.itemId);
      const available = type === "reserve" ? core.availableQty(item, value.stock.reservations, undefined, value.stock.orderReservations) : availabilityFor(item, value.stock, "materials", value.projectId);
      if (line.qty > available) throw new Error("Недостатньо доступного залишку. Оновіть склад або змініть кількість.");
      const payload = { projectId: value.projectId, itemId: line.itemId, qty: line.qty, type };
      // Native dialogs must not stack; the action opens the existing confirmation.
      const api = actions(); handoffKey = value.contextKey; reset();
      await api.move(payload);
    } catch (error) {
      if (session === value) { value.error = error.message; render(value); }
      else if (!session && handoffKey && actions().context().key === handoffKey && typeof root?.alert === "function") root.alert(error.message);
    }
  }
  function onInput(value, event) {
    if (session !== value || value.busy) return;
    try { current(value); } catch (_) { return; }
    const input = event.target;
    if (input.dataset?.pspFilter === "query") { value.filters.query = input.value; updateList(value); return; }
    const itemId = input.dataset?.pspQty;
    if (itemId == null) return;
    const item = value.stock.items.find(entry => id(entry.id) === itemId);
    if (!item || currencyOf(item) !== value.currency) return;
    value.drafts.set(itemId, input.value); value.selections.set(itemId, input.value); value.notice = "";
    const row = input.closest("[data-psp-card]");
    row?.classList.add("is-selected");
    const checkbox = row?.querySelector("[data-psp-select]"); if (checkbox) checkbox.checked = true;
    const note = row?.querySelector("[data-psp-row-note]"); if (note) { note.textContent = rowNote(value, item); note.hidden = !note.textContent; }
    updateFooter(value);
  }
  function onChange(value, event) {
    if (session !== value || value.busy) return;
    try { current(value); } catch (_) { return; }
    const input = event.target, filter = input.dataset?.pspFilter;
    if (filter && filter !== "query") {
      value.filters[filter] = filter === "brand" ? input.value : input.checked;
      if (filter === "otherCurrency") {
        const text = value.element.querySelector(".psp-currency-info");
        if (text) text.innerHTML = currencyInfo(value);
      }
      updateList(value); return;
    }
    const itemId = input.dataset?.pspSelect;
    if (itemId == null) return;
    const item = value.stock.items.find(entry => id(entry.id) === itemId);
    if (!item || currencyOf(item) !== value.currency) return;
    if (input.checked) value.selections.set(itemId, value.drafts.get(itemId) ?? "1"); else value.selections.delete(itemId);
    value.notice = ""; updateList(value);
  }
  function onClick(value, event) {
    const button = event.target.closest?.("[data-psp-action], [data-psp-group]");
    if (!button || button.disabled || session !== value) return;
    const action = button.dataset.pspAction;
    if (action === "close") { reset(); return; }
    if (value.busy) return;
    try { current(value); } catch (_) { return; }
    if (button.dataset.pspGroup != null) {
      value.filters.group = button.dataset.pspGroup;
      value.element.querySelectorAll("[data-psp-group]").forEach(node => node.setAttribute("aria-pressed", String(node.dataset.pspGroup === value.filters.group)));
      updateList(value); return;
    }
    if (action === "clear") { value.selections.clear(); value.drafts.clear(); value.notice = ""; updateList(value); }
    if (action === "refresh") void load(value);
    if (action === "add") void add(value);
    if (action === "reserve" || action === "project") void move(value, action);
  }
  async function openDialog(options = {}) {
    const target = options.target === "materials" ? "materials" : "offer", projectId = id(options.projectId);
    const { ctx, project } = projectContext(projectId, target); reset();
    const element = root.document.createElement("dialog"); element.id = "projectStockPickerDialog"; element.className = "psp-dialog";
    element.setAttribute("aria-labelledby", "projectStockPickerTitle");
    const value = { element, projectId, target, contextKey: ctx.key, title: project.title, currency: currencyOf(project), stock: { items: [], reservations: [], orderReservations: [] }, filters: { query: "", group: "", brand: "", freeOnly: true, otherCurrency: false }, selections: new Map(), drafts: new Map(), visibleIds: new Set(), busy: "", error: "", notice: "" };
    session = value;
    element.addEventListener("cancel", event => { event.preventDefault(); if (session === value) reset(); });
    element.addEventListener("close", () => { if (session === value) reset(); });
    element.addEventListener("click", event => onClick(value, event));
    element.addEventListener("input", event => onInput(value, event));
    element.addEventListener("change", event => onChange(value, event));
    root.document.body.append(element); render(value); element.showModal();
    await load(value);
    if (session === value) value.element.querySelector('[data-psp-filter="query"]')?.focus();
  }
  async function open(options = {}) {
    try { await openDialog(options); }
    catch (error) { if (typeof root?.alert === "function") root.alert(error.message); }
  }
  return Object.freeze({ open, reset, refreshAccess, filterStock, availabilityFor, summarize, priceFor });
});
