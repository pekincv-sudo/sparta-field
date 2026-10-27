(function () {
  "use strict";

  const core = window.SpartaWarehouseCore;
  const stateKey = "solarObjectManager.warehouseWorkspace.v31";
  const backupKey = "solarObjectManager.warehouseBackup.before31";
  const journalKey = "solarObjectManager.warehouseTransaction.v31";
  const ui = { tab: "stock", filters: { query: "", group: "", brand: "", availability: "" }, documentQuery: "", documentType: "", notice: "", editor: null, parentEditor: null, busy: false };
  const types = { purchase: "Прихід", opening: "Початкові залишки", project: "Видача на об’єкт", return: "Повернення", sale: "Прямий продаж", reserve: "Резерв", release: "Зняття резерву", stocktake: "Інвентаризація", adjustment: "Коригування", consume: "Використання на об’єкті" };
  const icons = { panels: "▦", inverters: "ϟ", batteries: "▰", mounting: "⌑", cables: "⌁", protection: "◇", monitoring: "◉", tools: "⚒", other: "□" };
  const safe = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;");
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const number = (value) => Number(value || 0).toLocaleString("uk-UA", { maximumFractionDigits: 3 });
  const priceInput = (value) => Number(Number(value || 0).toFixed(2));
  const currencyOf = (item) => item?.currency || "UAH";
  const formatMoney = (value, currency = "USD") => `${Number(value || 0).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === "USD" ? "USD" : "грн"}`;
  const currencySelect = (value, disabled = false) => `<label>Валюта<select name="currency" ${disabled ? "disabled" : ""}>${["USD", "UAH"].map((code) => `<option value="${code}" ${code === value ? "selected" : ""}>${code === "USD" ? "USD — Долар США" : "UAH — Гривня"}</option>`).join("")}</select></label>`;
  const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const uid = (prefix) => `${prefix}-${crypto.randomUUID()}`;
  let container = null;
  let writing = false;
  function canManage() { return Boolean(window.SPARTA_LOCAL_WORKSPACE?.enabled || ["owner", "admin", "warehouse"].includes(cloudState.memberRole)); }
  function requireManage() { if (!canManage()) throw new Error("Ви маєте доступ до перегляду складу. Проводити документи може власник, адміністратор або працівник складу."); }

  function stored() { return readJsonStorage(journalKey, null)?.warehouse || readJsonStorage(stateKey, {}) || {}; }
  function snapshot() {
    if (!window.SPARTA_LOCAL_WORKSPACE?.enabled) return window.SpartaWarehouseCloud?.snapshot() || { items: [], movements: [], documents: [], reservations: [] };
    const value = stored();
    return { items: warehouseItems, movements: warehouseMovements, documents: value.documents || [], reservations: value.reservations || [] };
  }
  function bootstrap() {
    if (!window.SPARTA_LOCAL_WORKSPACE?.enabled || !core) return;
    recoverJournal();
    const saved = stored();
    if (saved.version === 1 && Array.isArray(saved.items) && Array.isArray(saved.movements)) {
      warehouseItems = saved.items.map(normalizeWarehouseItem);
      warehouseMovements = saved.movements;
    }
    if (!readLocalStorage(backupKey) && readLocalStorage("solarObjectManager.cleanStart.v1") !== "true") {
      if (!writeLocalStorage(backupKey, JSON.stringify({ savedAt: new Date().toISOString(), items: warehouseItems, movements: warehouseMovements, projects, workspace: saved }))) {
        ui.notice = "Не вдалося створити копію даних. Перевірте вільне місце браузера перед внесенням операцій.";
      }
    }
  }
  // A recovery record makes stock + object updates recoverable as one logical operation.
  function recoverJournal() {
    const pending = readJsonStorage(journalKey, null);
    if (!pending?.warehouse || pending.version !== 1) return true;
    const record = pending.warehouse;
    warehouseItems = record.items.map(normalizeWarehouseItem);
    warehouseMovements = record.movements;
    if (pending.projects) projects = pending.projects;
    const results = [
      writeLocalStorage(stateKey, JSON.stringify(record)),
      writeLocalStorage("solarObjectManager.warehouseItems", JSON.stringify(record.items)),
      writeLocalStorage("solarObjectManager.warehouseMovements", JSON.stringify(record.movements)),
      pending.projects ? writeLocalStorage("solarObjectManager.projects", JSON.stringify(pending.projects)) : true,
    ];
    if (results.every(Boolean)) return writeLocalStorage(journalKey, "null");
    ui.notice = "Операцію збережено в журналі відновлення, але сховище переповнене. Не вносьте наступну операцію, доки не звільните місце.";
    return false;
  }
  // The single bundle is authoritative. Legacy keys remain mirrors for the rest of the CRM.
  function persist(next) {
    const record = { version: 1, items: next.items, movements: next.movements, documents: next.documents || [], reservations: next.reservations || [], savedAt: new Date().toISOString() };
    const recovery = { version: 1, warehouse: record, ...(next.projects ? { projects: next.projects } : {}) };
    if (!writeLocalStorage(journalKey, JSON.stringify(recovery))) throw new Error("Операцію не збережено. Звільніть пам’ять браузера та спробуйте ще раз.");
    writing = true;
    try {
      recoverJournal();
    } finally { writing = false; }
  }
  function capture() {
    if (writing || !window.SPARTA_LOCAL_WORKSPACE?.enabled || !core) return;
    if (readJsonStorage(journalKey, null)) return;
    const saved = stored();
    writeLocalStorage(stateKey, JSON.stringify({ ...saved, version: 1, items: warehouseItems, movements: warehouseMovements, documents: saved.documents || [], reservations: saved.reservations || [], savedAt: new Date().toISOString() }));
  }
  async function transact(callback) {
    requireManage();
    if (!window.SPARTA_LOCAL_WORKSPACE?.enabled) {
      if (!window.SpartaWarehouseCloud) throw new Error("Хмарний склад не підключено. Операцію не проведено.");
      return window.SpartaWarehouseCloud.transact(callback);
    }
    const run = async () => {
      if (!recoverJournal()) throw new Error("Спочатку звільніть місце в сховищі. Попередня операція захищена журналом відновлення.");
      const saved = stored();
      if (saved.version === 1) { warehouseItems = saved.items.map(normalizeWarehouseItem); warehouseMovements = saved.movements; }
      const current = snapshot();
      const result = await callback(current);
      persist({ ...current, ...result });
      return result;
    };
    return navigator.locks ? navigator.locks.request("sparta-local-warehouse-v31", run) : run();
  }
  function itemById(id) { return warehouseItems.find((item) => String(item.id) === String(id)); }
  function groupLabel(item) { return core.categories.find((group) => group.id === core.groupFor(item))?.label || item.category || "Інше"; }
  function specs(item) {
    return [item.brand, item.model, item.powerW ? `${number(item.powerW)} Вт` : "", item.powerKw ? `${number(item.powerKw)} кВт` : "", item.capacityKwh ? `${number(item.capacityKwh)} кВт·год` : "", item.voltageV ? `${number(item.voltageV)} В` : "", item.phases ? `${item.phases} ф.` : "", item.crossSectionMm2 ? `${number(item.crossSectionMm2)} мм²` : "", item.characteristics].filter(Boolean).join(" · ");
  }
  function productText(item) { return `${item.sku ? item.sku + " · " : ""}${item.name}`; }
  function productMark(item) {
    return `<span class="wh-product-icon" aria-hidden="true">${icons[core.groupFor(item)] || "□"}</span><span><strong class="wh-product-name">${safe(item.name)}</strong><span class="wh-muted">${safe(item.sku || "Без артикулу")} · ${safe(specs(item) || groupLabel(item))}</span></span>`;
  }
  function stockItems() { return warehouseItems.filter(core.isStockItem); }
  function filteredItems() {
    const source = ui.tab === "catalog" ? warehouseItems : stockItems();
    return core.filterItems(source, ui.filters, snapshot().reservations, snapshot().orderReservations);
  }
  function onSite(itemId, projectList = projects) {
    return projectList.reduce((sum, project) => sum + (project.materials || []).filter((line) => String(line.warehouseItemId) === String(itemId)).reduce((total, line) => total + Math.max(0, Number(line.issuedQty || 0) - Number(line.actualQty || 0)), 0), 0);
  }
  function categoryRail() {
    const all = ui.tab === "catalog" ? warehouseItems : stockItems();
    return `<aside class="wh-categories" aria-label="Напрямки обладнання"><button type="button" data-wh-group="" class="${!ui.filters.group ? "is-active" : ""}"><span>Усе обладнання</span><span>${all.length}</span></button>${core.categories.map((group) => `<button type="button" data-wh-group="${safe(group.id)}" class="${ui.filters.group === group.id ? "is-active" : ""}"><span>${icons[group.id] || "□"} ${safe(group.label)}</span><span>${all.filter((item) => core.groupFor(item) === group.id).length}</span></button>`).join("")}</aside>`;
  }
  function toolbar() {
    const brands = [...new Set(warehouseItems.map((item) => item.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, "uk"));
    return `<div class="wh-toolbar"><label class="wh-search"><span>Пошук обладнання</span><input type="search" data-wh-filter="query" value="${safe(ui.filters.query)}" placeholder="Назва, артикул, бренд або серійний номер" /></label><label><span>Наявність</span><select data-wh-filter="availability"><option value="">Усі залишки</option><option value="available" ${ui.filters.availability === "available" ? "selected" : ""}>Є доступні</option><option value="low" ${ui.filters.availability === "low" ? "selected" : ""}>Мало / закінчується</option><option value="zero" ${ui.filters.availability === "zero" ? "selected" : ""}>Немає на складі</option><option value="reserved" ${ui.filters.availability === "reserved" ? "selected" : ""}>Є резерв</option></select></label><label><span>Бренд</span><select data-wh-filter="brand"><option value="">Усі бренди</option>${brands.map((brand) => `<option value="${safe(brand)}" ${ui.filters.brand === brand ? "selected" : ""}>${safe(brand)}</option>`).join("")}</select></label></div>`;
  }
  function stockTable(items) {
    const state = snapshot();
    const rows = items.map((item) => {
      const reserved = core.reservedQty(state.reservations, item.id, undefined, state.orderReservations);
      const available = core.availableQty(item, state.reservations, undefined, state.orderReservations);
      const low = available <= Number(item.minQty || 0);
      return `<tr><td><button type="button" class="wh-product" data-wh-item="${safe(item.id)}">${productMark(item)}</button></td><td class="wh-num">${number(item.qty)} <small>${safe(item.unit)}</small></td><td class="wh-num">${reserved ? number(reserved) : "—"}</td><td class="wh-num"><span class="wh-badge ${low ? "warn" : "good"}">${number(available)}</span></td><td>${safe(item.location || "Основний склад")}</td><td><button type="button" class="wh-row-action" data-wh-item="${safe(item.id)}" aria-label="Відкрити ${safe(item.name)}">→</button></td></tr>`;
    }).join("");
    const cards = items.map((item) => `<article class="wh-stock-card"><button type="button" class="wh-product" data-wh-item="${safe(item.id)}">${productMark(item)}</button><div class="wh-card-quantities"><span>На складі<strong>${number(item.qty)} ${safe(item.unit)}</strong></span><span>Резерв<strong>${number(core.reservedQty(state.reservations, item.id, undefined, state.orderReservations))}</strong></span><span>Доступно<strong>${number(core.availableQty(item, state.reservations, undefined, state.orderReservations))}</strong></span></div><span class="wh-muted">${safe(item.location || "Основний склад")}</span></article>`).join("");
    return `<div class="wh-table-wrap"><table class="wh-table"><thead><tr><th>Обладнання</th><th class="wh-num">На складі</th><th class="wh-num">Резерв</th><th class="wh-num">Доступно</th><th>Зберігання</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><div class="wh-stock-cards">${cards}</div>`;
  }
  function catalogTable(items) {
    return `<div class="wh-table-wrap"><table class="wh-table"><thead><tr><th>Товар / артикул</th><th>Напрямок</th><th>Одиниця</th><th>Роздріб / монтажник / опт</th><th></th></tr></thead><tbody>${items.map((item) => `<tr><td><button type="button" class="wh-product" data-wh-item="${safe(item.id)}">${productMark(item)}</button></td><td>${safe(groupLabel(item))}</td><td>${safe(item.unit)}</td><td>${priceList(item)}</td><td>${canManage() ? `<button type="button" class="wh-row-action" data-wh-edit="${safe(item.id)}">Редагувати</button>` : ""}</td></tr>`).join("")}</tbody></table></div><div class="wh-stock-cards">${items.map((item) => `<article class="wh-stock-card"><button type="button" class="wh-product" data-wh-item="${safe(item.id)}">${productMark(item)}</button><p class="wh-muted">${safe(groupLabel(item))} · ${safe(item.unit)}</p><div class="wh-muted">${priceList(item)}</div>${canManage() ? `<button type="button" class="wh-secondary" data-wh-edit="${safe(item.id)}">Редагувати</button>` : ""}</article>`).join("")}</div>`;
  }
  function allDocuments() {
    const state = snapshot();
    const linked = new Set(state.documents.map((doc) => String(doc.id)));
    const legacy = state.movements.filter((move) => !move.documentId || !linked.has(String(move.documentId))).map((move) => ({ ...move, number: move.documentNumber || `Рух · ${String(move.id).slice(-6)}`, date: (move.createdAt || "").slice(0, 10), status: "posted", legacy: true, lines: [{ ...move }], projectTitle: projects.find((project) => String(project.id) === String(move.projectId))?.title || "" }));
    return [...state.documents, ...legacy].sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
  }
  function renderDocuments() {
    const query = core.normalizeText(ui.documentQuery);
    const docs = allDocuments().filter((doc) => (!ui.documentType || doc.type === ui.documentType) && (!query || core.normalizeText([doc.number, doc.supplier, doc.projectTitle, doc.customer, doc.note, ...(doc.lines || []).map((line) => line.itemName || itemById(line.itemId)?.name)].join(" ")).includes(query)));
    const reservations = snapshot().reservations;
    return `<div class="wh-toolbar"><label class="wh-search"><span>Пошук документів</span><input type="search" data-wh-document-filter="query" value="${safe(ui.documentQuery)}" placeholder="Номер, постачальник, об’єкт, товар" /></label><label><span>Операція</span><select data-wh-document-filter="type"><option value="">Усі операції</option>${Object.entries(types).map(([key, label]) => `<option value="${key}" ${ui.documentType === key ? "selected" : ""}>${label}</option>`).join("")}</select></label></div>${reservations.length ? `<details class="wh-history"><summary>Активні резерви · ${reservations.length}</summary><div class="wh-document-list">${reservations.map((entry) => `<div class="wh-document-card"><div><strong>${safe(itemById(entry.itemId)?.name || entry.itemId)}</strong><p class="wh-muted">${safe(projects.find((project) => String(project.id) === String(entry.projectId))?.title || "Об’єкт")} · ${number(entry.qty)} ${safe(itemById(entry.itemId)?.unit || "")}</p></div>${canManage() ? `<button type="button" class="wh-secondary" data-wh-release="${safe(entry.id)}">Зняти резерв</button>` : ""}</div>`).join("")}</div></details>` : ""}<div class="wh-results">${docs.length} документів · спочатку найновіші</div><div class="wh-document-list">${docs.map((doc) => `<article class="wh-document-card"><button type="button" class="wh-document-open" data-wh-document="${safe(doc.id)}"><span class="wh-document-head"><span><strong>${safe(types[doc.type] || "Рух товару")} · ${safe(doc.number || "Без номера")}</strong><span class="wh-muted">${safe(doc.date || (doc.createdAt || "").slice(0, 10))} · ${safe(doc.projectTitle || doc.customer || doc.supplier || "Основний склад")}</span></span><span class="wh-badge ${doc.status === "draft" ? "warn" : "good"}">${doc.status === "draft" ? "Чернетка" : "Проведено"}</span></span><span class="wh-document-lines">${(doc.lines || []).slice(0, 3).map((line) => `${safe(line.itemName || itemById(line.itemId)?.name || "Товар")} × ${number(doc.type === "stocktake" ? line.countedQty : line.qty ?? 0)}`).join(" · ")}${doc.lines?.length > 3 ? ` · ще ${doc.lines.length - 3}` : ""}</span></button></article>`).join("") || `<div class="wh-empty"><strong>Документів не знайдено</strong><p>Спробуйте інший пошук або створіть перший прихід.</p></div>`}</div>`;
  }
  function render(target = container) {
    if (!target || !core) return;
    container = target;
    if (!window.SPARTA_LOCAL_WORKSPACE?.enabled && !window.SpartaWarehouseCloud?.snapshot()) {
      container.innerHTML = `<section class="wh-app"><h2>Склад</h2><p class="wh-notice" role="alert">Хмарний склад не завантажено. Операції заблоковано, щоб не втратити дані. ${safe(cloudState.message || "Перевірте підключення Supabase.")}</p><button type="button" class="wh-secondary" data-wh-action="reload-stock">Оновити склад</button></section>`;
      return;
    }
    const state = snapshot();
    const stock = stockItems();
    const items = filteredItems();
    container.innerHTML = `<section class="wh-app"><header class="wh-header"><div><p class="eyebrow">Обладнання та матеріали</p><h2>Склад</h2><p class="wh-muted">Знайти. Прийняти. Видати на об’єкт.</p></div>${canManage() ? `<div class="wh-actions"><button type="button" class="wh-primary" data-wh-action="${ui.tab === "catalog" ? "new-product" : "purchase"}">${ui.tab === "catalog" ? "+ Новий товар" : "+ Прихід"}</button><details class="wh-more"><summary class="wh-secondary">Інші операції</summary><div>${[["reserve", "Зарезервувати"], ["project", "Видати на об’єкт"], ["return", "Повернути з об’єкта"], ["consume", "Підтвердити використання"], ["sale", "Прямий продаж"], ["stocktake", "Інвентаризація"], ["new-product", "Створити товар"], ["import-catalog", "Імпорт номенклатури"]].filter(([key]) => key !== "import-catalog" || !window.SPARTA_LOCAL_WORKSPACE?.enabled).map(([key, label]) => `<button type="button" data-wh-action="${key}">${label}</button>`).join("")}</div></details></div>` : `<span class="wh-muted">Перегляд складу</span>`}</header><nav class="wh-tabs" aria-label="Розділи складу" role="tablist">${[["stock", "Залишки"], ["documents", "Документи руху"], ["catalog", "Каталог обладнання"]].map(([key, label]) => `<button type="button" role="tab" aria-selected="${ui.tab === key}" data-wh-tab="${key}" class="${ui.tab === key ? "is-active" : ""}">${label}</button>`).join("")}</nav>${ui.notice ? `<div class="wh-notice success" role="status">${safe(ui.notice)}</div>` : ""}${ui.tab === "documents" ? renderDocuments() : `<div class="wh-metrics"><div class="wh-metric"><span>Позицій на складі</span><strong class="wh-metric-value">${stock.filter((item) => item.qty > 0).length}<small> / ${stock.length}</small></strong></div><div class="wh-metric"><span>Позицій у резерві</span><strong class="wh-metric-value">${stock.filter((item) => core.reservedQty(state.reservations, item.id, undefined, state.orderReservations) > 0).length}</strong></div><div class="wh-metric"><span>Потребують поповнення</span><strong class="wh-metric-value">${stock.filter((item) => core.availableQty(item, state.reservations, undefined, state.orderReservations) <= Number(item.minQty || 0)).length}</strong></div></div>${toolbar()}<div class="wh-layout">${categoryRail()}<div class="wh-content"><div class="wh-results"><span>${items.length} позицій${ui.filters.group ? ` · ${safe(core.categories.find((group) => group.id === ui.filters.group)?.label || "")}` : ""}</span>${ui.filters.query || ui.filters.group || ui.filters.brand || ui.filters.availability ? `<button type="button" class="wh-row-action" data-wh-action="reset-filters">Скинути фільтри</button>` : ""}</div>${items.length ? (ui.tab === "catalog" ? catalogTable(items) : stockTable(items)) : `<div class="wh-empty"><strong>Обладнання не знайдено</strong><p>Змініть пошук чи фільтри або додайте товар до каталогу.</p>${canManage() ? `<button type="button" class="wh-secondary" data-wh-action="new-product">+ Новий товар</button>` : ""}</div>`}</div></div>`}<footer class="wh-footer"><span>Склад · основна валюта USD · гривня обліковується окремо · ${window.SPARTA_LOCAL_WORKSPACE?.enabled ? "локальне збереження" : "збереження у Supabase"}</span></footer></section>`;
  }
  function dialog() {
    let element = document.querySelector("#whDialog");
    if (!element) {
      element = document.createElement("dialog"); element.id = "whDialog"; element.className = "wh-dialog";
      document.body.append(element);
      element.addEventListener("cancel", (event) => { if (ui.busy) event.preventDefault(); else { event.preventDefault(); closeEditor(); } });
    }
    return element;
  }
  function closeEditor() {
    if (ui.busy) return;
    if (ui.parentEditor) { ui.editor = ui.parentEditor; ui.parentEditor = null; renderEditor(); }
    else { ui.editor = null; dialog().close(); }
  }
  function makeNumber(type) {
    const prefix = { purchase: "ПР", stocktake: "ІНВ", reserve: "РЕЗ", project: "ВИД", return: "ПОВ", sale: "ПРОД", consume: "ВИК" }[type] || "ДОК";
    return `${prefix}-${today().replaceAll("-", "")}-${String(snapshot().documents.length + 1).padStart(3, "0")}`;
  }
  function openOperation(type, itemId = "", existing = null) {
    requireManage();
    ui.parentEditor = null;
    ui.editor = existing ? { ...copy(existing), currency: currencyOf(existing), mode: existing.type, pendingFiles: [] } : { currency: itemId ? currencyOf(itemById(itemId)) : "USD", mode: type, id: uid("wd"), number: makeNumber(type), date: today(), supplier: "", projectId: "", customer: "", location: "Основний склад", note: "", reason: "", attachments: [], pendingFiles: [], lines: [{ itemId, qty: "", purchasePrice: itemId ? priceInput(itemById(itemId)?.purchasePrice) : "", salePrice: itemId ? Number(itemById(itemId)?.retailPrice ?? itemById(itemId)?.salePrice ?? 0) : "", deliveryCost: "", extraCost: "", countedQty: "", serialNumbers: "" }] };
    renderEditor();
  }
  function openCatalog(id = "", fromOperation = false) {
    requireManage();
    if (fromOperation) ui.parentEditor = ui.editor; else ui.parentEditor = null;
    const item = id ? itemById(id) : null;
    ui.editor = { mode: "catalog", item: item ? copy(item) : { id: uid("wh"), currency: ui.parentEditor?.currency || "USD", name: "", category: ui.filters.group ? core.categories.find((group) => group.id === ui.filters.group)?.label : "Фотомодулі", sku: "", unit: "шт", brand: "", model: "", minQty: 0, location: "Основний склад", retailPrice: 0, installerPrice: 0, wholesalePrice: 0 } };
    renderEditor();
  }
  function openForProject(type, options = {}) {
    requireManage();
    if (!types[type]) throw new Error("Невідома складська операція.");
    if (!window.SPARTA_LOCAL_WORKSPACE?.enabled && !window.SpartaWarehouseCloud?.snapshot()) throw new Error("Спочатку завантажте хмарний склад.");
    openOperation(type, options.itemId || "");
    ui.editor.projectId = options.projectId || "";
    if (ui.editor.projectId) ui.editor.currency = currencyOf(projects.find((p) => String(p.id) === String(ui.editor.projectId)));
    renderEditor();
  }
  function field(label, name, value = "", type = "text", extra = "") {
    return `<label>${safe(label)}<input name="${safe(name)}" type="${type}" value="${safe(value)}" ${extra} /></label>`;
  }
  function categoryFields(item) {
    const group = core.groupFor(item);
    return `<div class="wh-form-grid">${["panels"].includes(group) ? field("Потужність панелі, Вт", "powerW", item.powerW || "", "number", 'min="0" step="1"') : ""}${["inverters"].includes(group) ? field("Потужність, кВт", "powerKw", item.powerKw || "", "number", 'min="0" step="0.01"') + field("Кількість фаз", "phases", item.phases || "", "number", 'min="1" max="3" step="1"') : ""}${group === "batteries" ? field("Ємність, кВт·год", "capacityKwh", item.capacityKwh || "", "number", 'min="0" step="0.01"') + field("Напруга, В", "voltageV", item.voltageV || "", "number", 'min="0" step="0.01"') : ""}${group === "cables" ? field("Переріз, мм²", "crossSectionMm2", item.crossSectionMm2 || "", "number", 'min="0" step="0.01"') : ""}${field("Інші характеристики", "characteristics", item.characteristics || "")}</div>`;
  }
  function renderCatalogEditor() {
    const item = ui.editor.item;
    return `<div class="wh-notice">Картка описує товар. Кількість змінюється через прихід або інвентаризацію.</div><div class="wh-form-grid">${field("Назва обладнання *", "name", item.name, "text", 'required maxlength="240"')}${field("Артикул", "sku", item.sku, "text", 'placeholder="Згенерується автоматично, якщо порожній"')}<label>Напрямок<select name="category">${core.categories.map((group) => `<option value="${safe(group.label)}" ${core.groupFor(item) === group.id ? "selected" : ""}>${safe(group.label)}</option>`).join("")}</select></label><label>Одиниця виміру<select name="unit">${[...new Set([item.unit, "шт", "м", "компл", "уп", "кг"].filter(Boolean))].map((unit) => `<option value="${safe(unit)}" ${unit === item.unit ? "selected" : ""}>${safe(unit)}</option>`).join("")}</select></label>${currencySelect(currencyOf(item), Boolean(itemById(item.id)))}${field("Бренд", "brand", item.brand || "")}${field("Модель", "model", item.model || "")}</div><section class="wh-help"><h3>Характеристики</h3><div id="whCategoryFields">${categoryFields(item)}</div></section><details class="wh-history"><summary>Ціни, поповнення та зберігання</summary><div class="wh-form-grid">${field(`Роздрібна ціна, ${currencyOf(item)}`, "retailPrice", item.retailPrice ?? item.salePrice ?? 0, "number", 'min="0" step="0.01"')}${field(`Ціна для монтажників, ${currencyOf(item)}`, "installerPrice", item.installerPrice || 0, "number", 'min="0" step="0.01"')}${field(`Оптова ціна, ${currencyOf(item)}`, "wholesalePrice", item.wholesalePrice || 0, "number", 'min="0" step="0.01"')}${field("Мінімальний залишок", "minQty", item.minQty || 0, "number", 'min="0" step="0.001"')}${field("Місце зберігання", "location", item.location || "Основний склад")}${field("Штрихкод", "barcode", item.barcode || "")}</div></details>`;
  }
  function lineRows() {
    const editor = ui.editor;
    const receipt = editor.mode === "purchase";
    const stocktake = editor.mode === "stocktake";
    const values = stockItems().filter((item) => currencyOf(item) === editor.currency);
    return `<div class="wh-line-table">${editor.lines.map((line, index) => {
      const item = itemById(line.itemId);
      return `<div class="wh-line-row"><label class="wh-line-picker">Обладнання ${index + 1}<select name="item-${index}" data-wh-line="${index}" data-wh-line-field="itemId" required><option value="">Оберіть товар</option>${values.map((entry) => `<option value="${safe(entry.id)}" ${String(line.itemId) === String(entry.id) ? "selected" : ""}>${safe(productText(entry))}</option>`).join("")}</select><small class="wh-muted">${item ? `На складі: ${number(item.qty)} ${safe(item.unit)} · доступно: ${number(core.availableQty(item, snapshot().reservations, undefined, snapshot().orderReservations))}` : "Оберіть зі списку або знайдіть товар вище"}</small></label>${stocktake ? `<label>Фактично, ${safe(item?.unit || "од.")}<input data-wh-line="${index}" data-wh-line-field="countedQty" type="number" min="0" step="${["шт", "компл"].includes(item?.unit) ? "1" : "0.001"}" value="${safe(line.countedQty)}" required /><small class="wh-muted">Різниця: ${line.countedQty === "" ? "—" : number(Number(line.countedQty) - Number(item?.qty || 0))}</small></label>` : `<label>Кількість, ${safe(item?.unit || "од.")}<input data-wh-line="${index}" data-wh-line-field="qty" type="number" min="${["шт", "компл"].includes(item?.unit) ? "1" : "0.001"}" step="${["шт", "компл"].includes(item?.unit) ? "1" : "0.001"}" value="${safe(line.qty)}" required /></label>`}${receipt ? `<label>Закупівля / од., ${editor.currency}<input data-wh-line="${index}" data-wh-line-field="purchasePrice" type="number" min="0" step="0.01" value="${safe(line.purchasePrice)}" required /></label>` : editor.mode === "sale" ? `<label>Продаж / од., ${editor.currency}<input data-wh-line="${index}" data-wh-line-field="salePrice" type="number" min="0" step="0.01" value="${safe(line.salePrice || 0)}" /></label>` : ""}${editor.lines.length > 1 ? `<button type="button" class="wh-row-action" data-wh-remove-line="${index}" aria-label="Видалити рядок ${index + 1}">×</button>` : ""}${receipt ? `<details class="wh-line-extra"><summary>Доставка та серійні номери</summary><div class="wh-form-grid"><label>Доставка / од., ${editor.currency}<input data-wh-line="${index}" data-wh-line-field="deliveryCost" type="number" min="0" step="0.01" value="${safe(line.deliveryCost || "")}" /></label><label>Інші витрати / од., ${editor.currency}<input data-wh-line="${index}" data-wh-line-field="extraCost" type="number" min="0" step="0.01" value="${safe(line.extraCost || "")}" /></label><label class="full">Серійні номери — по одному в рядку<textarea data-wh-line="${index}" data-wh-line-field="serialNumbers" rows="2">${safe(Array.isArray(line.serialNumbers) ? line.serialNumbers.join("\n") : line.serialNumbers || "")}</textarea></label></div></details>` : ""}</div>`;
    }).join("")}</div>`;
  }
  function renderOperationEditor() {
    const editor = ui.editor;
    const receipt = editor.mode === "purchase";
    const stocktake = editor.mode === "stocktake";
    const needsProject = ["project", "return", "reserve", "consume"].includes(editor.mode);
    const projectOptions = projects.filter((project) => ["return", "consume"].includes(editor.mode) || !isClosedProjectStatus(project.status));
    const help = { purchase: "Одна накладна — кілька товарів. Оплату постачальнику вносьте окремо в касі.", reserve: "Резерв закріплює обладнання за об’єктом, але фізично воно залишається на складі.", project: "Обладнання передається на об’єкт. Видача ще не означає, що воно змонтоване.", return: "Повертається лише видане, але ще не використане обладнання.", consume: "Підтверджує використання вже виданого обладнання. Центральний склад повторно не зменшується.", stocktake: "Вкажіть фактичну кількість після перерахунку. Різниця буде збережена окремим документом.", sale: "Прямий продаж зменшує доступний залишок. Оплата фіксується окремо в касі." }[editor.mode];
    return `<div class="wh-notice">${safe(help)}</div><div class="wh-form-grid">${currencySelect(editor.currency)}${field("Номер документа", "number", editor.number, "text", "required")}${field("Дата", "date", editor.date, "date", "required")}${receipt ? field("Постачальник *", "supplier", editor.supplier, "text", "required") + field("Місце зберігання", "location", editor.location) : ""}${needsProject ? `<label class="full">Об’єкт *<select name="projectId" required><option value="">Оберіть об’єкт</option>${projectOptions.map((project) => `<option value="${safe(project.id)}" ${String(editor.projectId) === String(project.id) ? "selected" : ""}>${safe(project.title)}</option>`).join("")}</select></label>` : ""}${editor.mode === "sale" ? field("Покупець *", "customer", editor.customer, "text", "required") : ""}${stocktake ? field("Причина / підстава *", "reason", editor.reason, "text", 'required placeholder="Плановий перерахунок, уточнення залишку…"') : ""}</div>${receipt || stocktake ? `<div class="wh-line-search"><label>Швидкий пошук для додавання<input type="search" id="whReceiptSearch" placeholder="Введіть назву, модель або артикул" /></label><div id="whReceiptMatches"></div></div>` : ""}<div id="whLines">${lineRows()}</div>${receipt || stocktake ? `<div class="wh-actions"><button type="button" class="wh-secondary" data-wh-action="add-line">+ Рядок</button>${receipt ? `<button type="button" class="wh-row-action" data-wh-action="new-product-in-receipt">Немає товару? Створити</button>` : ""}</div>` : ""}<details class="wh-history"><summary>Коментар${receipt ? " та накладна / фото" : ""}</summary><div class="wh-form-grid"><label class="full">Коментар<textarea name="note" rows="2">${safe(editor.note || "")}</textarea></label>${receipt ? `<label class="full">Додати документ або фотографії<input id="whAttachments" type="file" multiple accept="image/*,.pdf" /><small class="wh-muted">${window.SPARTA_LOCAL_WORKSPACE?.enabled ? "Файли зберігаються локально на цьому комп’ютері." : "Приватні файли зберігаються у Supabase для вашої компанії."}</small></label><div class="wh-attachments" id="whAttachmentList">${[...(editor.attachments || []), ...(editor.pendingFiles || []).map((file) => ({ fileName: file.name }))].map((file) => `<span>${safe(file.fileName)}</span>`).join("")}</div>` : ""}</div></details>`;
  }
  function totalLabel() {
    const editor = ui.editor;
    if (!editor?.lines || editor.mode !== "purchase") return "";
    return formatMoney(editor.lines.reduce((sum, line) => sum + Number(line.qty || 0) * (Number(line.purchasePrice || 0) + Number(line.deliveryCost || 0) + Number(line.extraCost || 0)), 0), ui.editor.currency);
  }
  function renderEditor() {
    const editor = ui.editor;
    if (!editor) return;
    const element = dialog();
    if (editor.mode === "detail") { renderItemDetail(element, editor.itemId); return; }
    if (editor.mode === "document") { renderDocumentDetail(element, editor.documentId); return; }
    element.setAttribute("aria-label", editor.mode === "catalog" ? "Картка товару" : types[editor.mode] || "Складська операція");
    element.innerHTML = `<form id="whForm"><header class="wh-dialog-head"><div><p class="eyebrow">${editor.mode === "catalog" ? "Каталог обладнання" : "Складський документ"}</p><h2>${editor.mode === "catalog" ? (itemById(editor.item.id) ? "Редагувати товар" : "Новий товар") : safe(types[editor.mode])}</h2></div><button type="button" class="wh-row-action" data-wh-action="close" aria-label="Закрити">×</button></header><div class="wh-dialog-body">${editor.mode === "catalog" ? renderCatalogEditor() : renderOperationEditor()}<p id="whFormError" class="wh-notice error" role="alert" hidden></p></div><footer class="wh-form-footer"><span class="wh-total" id="whReceiptTotal">${totalLabel() ? `Разом: ${totalLabel()}` : ""}</span><div class="wh-actions"><button type="button" class="wh-secondary" data-wh-action="close">Скасувати</button>${editor.mode === "purchase" ? `<button type="button" class="wh-secondary" data-wh-action="save-draft">Зберегти чернетку</button>` : ""}<button type="submit" class="wh-primary">${editor.mode === "catalog" ? "Зберегти товар" : editor.mode === "reserve" ? "Зарезервувати" : "Провести документ"}</button></div></footer></form>`;
    if (!element.open) element.showModal();
  }
  function priceList(item) {
    return [["Роздріб", item.retailPrice ?? item.salePrice], ["Монтажник", item.installerPrice], ["Опт", item.wholesalePrice]].map(([label, value]) => `${label}: ${Number(value) > 0 ? formatMoney(value, currencyOf(item)) : "не задано"}`).join("<br>");
  }
  function renderItemDetail(element, itemId) {
    const item = itemById(itemId);
    if (!item) return;
    const state = snapshot();
    const history = state.movements.filter((move) => String(move.itemId) === String(itemId));
    const reservations = state.reservations.filter((entry) => String(entry.itemId) === String(itemId));
    const orderHolds = (state.orderReservations || []).filter((entry) => String(entry.itemId) === String(itemId));
    element.setAttribute("aria-label", `Товар: ${item.name}`);
    element.innerHTML = `<header class="wh-dialog-head"><div><p class="eyebrow">${safe(groupLabel(item))} · ${safe(item.sku || "Без артикулу")}</p><h2>${safe(item.name)}</h2></div><button type="button" class="wh-row-action" data-wh-action="close" aria-label="Закрити">×</button></header><div class="wh-dialog-body"><p class="wh-muted">${safe(specs(item) || "Характеристики можна додати в картці товару.")}</p><div class="wh-metrics"><div class="wh-metric"><span>На складі, ${safe(item.unit)}</span><strong class="wh-metric-value">${number(item.qty)}</strong></div><div class="wh-metric"><span>Резерв</span><strong class="wh-metric-value">${number(core.reservedQty(state.reservations, itemId, undefined, state.orderReservations))}</strong></div><div class="wh-metric"><span>Доступно</span><strong class="wh-metric-value">${number(core.availableQty(item, state.reservations, undefined, state.orderReservations))}</strong></div></div><div class="wh-detail-grid"><div class="wh-detail-item"><span>Місце</span><strong>${safe(item.location || "Основний склад")}</strong></div><div class="wh-detail-item"><span>На об’єктах, ще не використано</span><strong>${number(onSite(itemId))} ${safe(item.unit)}</strong></div><div class="wh-detail-item"><span>Собівартість одиниці</span><strong>${item.purchasePriceKnown === false ? "Не задано" : formatMoney(warehouseUnitCost(item), currencyOf(item))}</strong></div><div class="wh-detail-item"><span>Ціни продажу</span><strong>${priceList(item)}</strong></div></div>${reservations.length ? `<section class="wh-help"><h3>Резерви під об’єкти</h3>${reservations.map((entry) => `<p>${safe(projects.find((project) => String(project.id) === String(entry.projectId))?.title || "Об’єкт")} — ${number(entry.qty)} ${safe(item.unit)} ${canManage() ? `<button type="button" class="wh-row-action" data-wh-release="${safe(entry.id)}">Зняти резерв</button>` : ""}</p>`).join("")}</section>` : ""}${orderHolds.length ? `<section class="wh-help"><h3>Резерви замовлень покупців</h3>${orderHolds.map((entry) => `<p>${safe(entry.orderNumber || "Замовлення")} — ${number(entry.qty)} ${safe(item.unit)}</p>`).join("")}<small>Змінити резерв можна через замовлення в розділі «Продажі».</small></section>` : ""}<details class="wh-history"><summary>Історія руху · ${history.length}</summary>${history.map((move) => `<div class="wh-detail-item"><span>${safe((move.createdAt || "").slice(0, 10))} · ${safe(types[move.type] || "Рух")}</span><strong>${number(move.qty)} ${safe(item.unit)}</strong><small>${safe(move.documentNumber || move.note || "")}</small></div>`).join("") || `<p class="wh-muted">Операцій ще немає.</p>`}</details>${item.serialNumbers?.length || item.serialNumber ? `<details class="wh-history"><summary>Серійні номери в обліку</summary><p>${safe((item.serialNumbers || [item.serialNumber]).join(" · "))}</p><small class="wh-muted">Історія отриманих номерів; вибір конкретного номера під час видачі — наступний етап.</small></details>` : ""}</div><footer class="wh-form-footer">${canManage() ? `<button type="button" class="wh-secondary" data-wh-edit="${safe(itemId)}">Редагувати товар</button><div class="wh-actions"><button type="button" class="wh-secondary" data-wh-operation="reserve" data-wh-operation-item="${safe(itemId)}">Резерв</button><button type="button" class="wh-secondary" data-wh-operation="project" data-wh-operation-item="${safe(itemId)}">Видати</button><button type="button" class="wh-primary" data-wh-operation="purchase" data-wh-operation-item="${safe(itemId)}">+ Прихід</button></div>` : ""}</footer>`;
    if (!element.open) element.showModal();
  }
  function renderDocumentDetail(element, documentId) {
    const doc = allDocuments().find((entry) => String(entry.id) === String(documentId));
    if (!doc) return;
    element.setAttribute("aria-label", `Документ: ${doc.number}`);
    element.innerHTML = `<header class="wh-dialog-head"><div><p class="eyebrow">${safe(types[doc.type] || "Рух товару")}</p><h2>${safe(doc.number)}</h2></div><button type="button" class="wh-row-action" data-wh-action="close" aria-label="Закрити">×</button></header><div class="wh-dialog-body"><div class="wh-detail-grid"><div class="wh-detail-item"><span>Дата</span><strong>${safe(doc.date || (doc.createdAt || "").slice(0, 10))}</strong></div><div class="wh-detail-item"><span>Статус</span><strong>${doc.status === "draft" ? "Чернетка — залишки не змінені" : "Проведено"}</strong></div><div class="wh-detail-item"><span>Постачальник / об’єкт</span><strong>${safe(doc.projectTitle || doc.customer || doc.supplier || "Основний склад")}</strong></div><div class="wh-detail-item"><span>Вніс</span><strong>${safe(doc.createdByName || "Локальний користувач")}</strong></div></div><div class="table-wrap"><table class="wh-table"><thead><tr><th>Обладнання</th><th>Кількість</th><th>Сума / різниця</th></tr></thead><tbody>${(doc.lines || []).map((line) => `<tr><td>${safe(line.itemName || itemById(line.itemId)?.name || "Товар")}</td><td>${number(doc.type === "stocktake" ? line.countedQty : line.qty ?? 0)} ${safe(line.unit || itemById(line.itemId)?.unit || "")}</td><td>${doc.type === "stocktake" ? number(line.delta ?? (Number(line.countedQty || 0) - Number(line.beforeQty || 0))) : ["purchase", "sale", "project", "return"].includes(doc.type) ? formatMoney(Number(line.qty || 0) * Number(doc.type === "sale" ? line.salePrice || 0 : line.unitCost ?? line.purchasePrice ?? 0), line.currency || doc.currency || "UAH") : "—"}</td></tr>`).join("")}</tbody></table></div>${doc.valuationIncomplete ? `<p class="wh-notice" role="status">Частина початкових залишків не оцінена: закупівельної ціни немає у джерелі. Нуль у технічному обліку не означає безкоштовний товар.</p>` : ""}${doc.note || doc.reason ? `<p class="wh-help">${safe([doc.reason, doc.note].filter(Boolean).join(" · "))}</p>` : ""}${doc.attachments?.length ? `<section class="wh-help"><h3>Документи та фотографії</h3><div class="wh-attachments">${doc.attachments.map((file, index) => `<button type="button" class="wh-secondary" data-wh-open-file="${index}" data-wh-file-document="${safe(doc.id)}">${safe(file.fileName)}</button>`).join("")}</div></section>` : ""}<p class="wh-muted">${doc.status === "draft" ? "Чернетку можна відкрити, доповнити та провести." : "Історію збережено. Зміна картки товару не змінює суми цього документа."}</p></div><footer class="wh-form-footer"><button type="button" class="wh-secondary" data-wh-action="close">Закрити</button>${doc.status === "draft" && canManage() ? `<button type="button" class="wh-primary" data-wh-resume="${safe(doc.id)}">Продовжити чернетку</button>` : ""}</footer>`;
    if (!element.open) element.showModal();
  }
  async function attachments(editor) {
    const saved = [...(editor.attachments || [])];
    for (const file of editor.pendingFiles || []) {
      if (file.size > 20 * 1024 * 1024) throw new Error(`Файл «${file.name}» більший за 20 МБ.`);
      if (window.SPARTA_LOCAL_WORKSPACE?.enabled) {
        const fileKey = `warehouse-${editor.id}-${crypto.randomUUID()}`;
        await putProjectFileBlob(fileKey, file);
        saved.push({ fileKey, fileName: file.name, size: file.size, type: file.type });
      } else saved.push(await window.SpartaWarehouseCloud.uploadAttachment(editor.id, file));
    }
    editor.pendingFiles = []; editor.attachments = saved;
    return saved;
  }
  function baseDocument(editor) {
    return { currency: editor.currency, id: editor.id, type: editor.mode, number: editor.number.trim(), date: editor.date, supplier: editor.supplier?.trim() || "", projectId: editor.projectId || "", customer: editor.customer?.trim() || "", location: editor.location || "Основний склад", note: editor.note?.trim() || "", reason: editor.reason?.trim() || "", createdAt: editor.createdAt || new Date().toISOString(), createdBy: cloudState.user?.id || "local", createdByName: cloudState.user?.email || "Локальний користувач", attachments: editor.attachments || [], lines: editor.lines.map((line) => ({ ...line, deliveryCost: line.deliveryCost || 0, extraCost: line.extraCost || 0, serialNumbers: Array.isArray(line.serialNumbers) ? line.serialNumbers : String(line.serialNumbers || "").split(/\n|,/).map((value) => value.trim()).filter(Boolean) })) };
  }
  function postMovement(state, editor) {
    const line = editor.lines[0];
    const next = copy(state);
    const projectList = copy(state.projects || (window.SPARTA_LOCAL_WORKSPACE?.enabled ? readJsonStorage("solarObjectManager.projects", projects) : projects));
    const item = next.items.find((entry) => String(entry.id) === String(line.itemId));
    if (!item) throw new Error("Оберіть обладнання зі списку.");
    if (currencyOf(item) !== editor.currency) throw new Error("Валюта товару не збігається з валютою документа: " + editor.currency);
    const qty = core.quantity(line.qty, item.unit, { allowZero: false });
    const type = editor.mode;
    if (type === "sale" && (!Number.isFinite(Number(line.salePrice)) || Number(line.salePrice) < 0)) throw new Error("Вкажіть коректну невід’ємну ціну продажу.");
    const project = projectList.find((entry) => String(entry.id) === String(editor.projectId));
    if (["project", "return", "consume", "reserve"].includes(type) && !project) throw new Error("Оберіть об’єкт.");
    if (project && currencyOf(project) !== currencyOf(item)) throw new Error("Валюта об’єкта та обладнання має збігатися. USD та гривня обліковуються окремо.");
    if (["project", "reserve"].includes(type) && isClosedProjectStatus(project.status)) throw new Error("Видача та резерв доступні лише для активних об’єктів.");
    if (type === "sale" && !editor.customer.trim()) throw new Error("Вкажіть покупця.");
    let unitCost = warehouseUnitCost(item);
    let materialSalePrice = Number(item.installerPrice ?? item.salePrice ?? 0);
    if (type === "reserve") {
    const result = core.reserve(next, { id: uid("wr"), projectId: project.id, itemId: item.id, qty, createdAt: new Date().toISOString(), createdBy: cloudState.user?.id || "local" });
      next.reservations = result.reservations;
    } else if (["project", "sale"].includes(type)) {
      const available = core.availableQty(item, next.reservations, type === "project" ? project.id : undefined, next.orderReservations);
      if (qty > available) throw new Error(`Доступно ${number(available)} ${item.unit}. Інше обладнання зарезервоване або відсутнє.`);
      item.qty = Math.round((Number(item.qty) - qty) * 1000) / 1000;
      if (project && type === "project") {
        const existing = (project.materials || []).find((entry) => String(entry.warehouseItemId) === String(item.id) || (item.sku && entry.sku === item.sku) || entry.name === item.name);
        const previousActual = Number(existing?.actualQty || 0);
        addWarehouseItemToProjectMaterials(project, item, qty);
        const material = project.materials.find((entry) => String(entry.warehouseItemId) === String(item.id));
        material.actualQty = previousActual;
        next.reservations = core.consumeReservation(next.reservations, item.id, project.id, qty);
      }
    } else {
      const material = (project.materials || []).find((entry) => String(entry.warehouseItemId) === String(item.id));
      if (material && currencyOf(material) !== currencyOf(item)) throw new Error("Валюта матеріалу не збігається з валютою товару.");
      const issued = Number(material?.issuedQty || 0);
      const actual = Number(material?.actualQty || 0);
      const unused = Math.max(0, issued - actual);
      if (!material || qty > unused) throw new Error(`На об’єкті ще не використано ${number(unused)} ${item.unit}. Повернути або підтвердити використання можна лише в цих межах.`);
      unitCost = Number(material.purchasePriceSnapshot ?? unitCost);
      materialSalePrice = Number(material.salePriceSnapshot ?? materialSalePrice);
      if (type === "consume") material.actualQty = Math.round((actual + qty) * 1000) / 1000;
      else {
        const oldQty = Number(item.qty || 0);
        item.qty = Math.round((oldQty + qty) * 1000) / 1000;
        item.purchasePrice = (oldQty * warehouseUnitCost(item) + qty * unitCost) / item.qty;
        item.deliveryCost = 0; item.extraCost = 0;
        material.issuedQty = Math.round((issued - qty) * 1000) / 1000;
      }
    }
    const doc = { ...baseDocument(editor), status: "posted", projectTitle: project?.title || "", lines: [{ currency: editor.currency, itemId: item.id, itemName: item.name, qty, unit: item.unit, unitCost, salePrice: Number(line.salePrice || 0) }] };
    if (next.documents.some((entry) => entry.id === doc.id && entry.status !== "draft")) throw new Error("Цей документ уже проведено.");
    next.documents = [doc, ...next.documents.filter((entry) => entry.id !== doc.id)];
    if (!["reserve"].includes(type)) next.movements.unshift({ currency: editor.currency, id: uid("wm"), type, itemId: item.id, itemName: item.name, projectId: project?.id || "", customer: editor.customer || "", qty, unit: item.unit, unitCost, materialSalePrice, salePrice: Number(line.salePrice || 0), note: editor.note || "", supplier: item.supplier || "", documentId: doc.id, documentNumber: doc.number, createdAt: `${editor.date}T12:00:00`, recordedAt: new Date().toISOString() });
    return { ...next, projects: projectList, document: doc };
  }
  async function saveEditor(asDraft = false) {
    if (ui.busy || !ui.editor) return;
    const editor = ui.editor;
    const form = document.querySelector("#whForm");
    if (!asDraft && !form.reportValidity()) return;
    ui.busy = true;
    form.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
      if (editor.mode === "catalog") {
        const input = { ...editor.item, ...Object.fromEntries(new FormData(form)), id: editor.item.id };
        await transact((state) => ({ ...state, items: core.saveCatalog(state.items, input, { movements: state.movements, reservations: state.reservations, projects: state.projects || (window.SPARTA_LOCAL_WORKSPACE?.enabled ? readJsonStorage("solarObjectManager.projects", projects) : projects) }) }));
        ui.notice = `Товар «${input.name}» збережено. Кількість на складі не змінена.`;
        if (ui.parentEditor) {
          const parent = ui.parentEditor;
          const empty = parent.lines.find((line) => !line.itemId);
          if (empty) empty.itemId = input.id;
          else parent.lines.push({ itemId: input.id, qty: "", purchasePrice: "", deliveryCost: "", extraCost: "" });
          ui.editor = parent; ui.parentEditor = null;
        } else ui.editor = null;
      } else {
        await attachments(editor);
        await transact((state) => {
          const doc = baseDocument(editor);
          if (asDraft) {
            if (state.documents.some((entry) => entry.id === doc.id && entry.status !== "draft")) throw new Error("Проведений документ не можна змінити на чернетку.");
            return { ...state, documents: [{ ...doc, status: "draft" }, ...state.documents.filter((entry) => entry.id !== doc.id)] };
          }
          if (!doc.number || !doc.date) throw new Error("Вкажіть номер і дату документа.");
          if (state.documents.some((entry) => entry.id !== doc.id && entry.number === doc.number && entry.type === doc.type && entry.supplier === doc.supplier)) throw new Error("Документ із таким номером уже є. Перевірте, чи це не повторне внесення.");
          if (editor.mode === "purchase") return { ...state, ...core.postReceipt(state, doc) };
          if (editor.mode === "stocktake") {
            const result = core.postStocktake(state, doc);
            for (const item of result.items) if (Number(item.qty) < core.reservedQty(state.reservations, item.id, undefined, state.orderReservations)) throw new Error("Фактичний залишок менший за резерв. Спочатку перегляньте або зніміть резерв цього товару.");
            return { ...state, ...result };
          }
          return postMovement(state, editor);
        });
        ui.notice = asDraft ? `Чернетку ${editor.number} збережено. Залишки не змінені.` : `${types[editor.mode]} · ${editor.number}: документ проведено.`;
        ui.editor = null;
      }
      ui.busy = false;
      if (readJsonStorage(journalKey, null)) {
        ui.notice = "Операцію збережено в журналі відновлення, але запис у сховище ще не завершено. Звільніть місце перед наступною операцією.";
      }
      render();
      if (ui.editor) renderEditor(); else dialog().close();
      renderHome();
    } catch (error) {
      const message = document.querySelector("#whFormError");
      if (message) { message.hidden = false; message.textContent = error.message; message.scrollIntoView({ block: "nearest" }); }
    } finally {
      ui.busy = false;
      form.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    }
  }
  function refreshSearchResults(value) {
    const element = document.querySelector("#whReceiptMatches");
    if (!element) return;
    const results = value.trim() ? core.filterItems(stockItems().filter((item) => currencyOf(item) === ui.editor?.currency), { query: value }, []).slice(0, 8) : [];
    element.innerHTML = results.map((item) => `<button type="button" data-wh-add-item="${safe(item.id)}"><strong>${safe(item.name)}</strong><span>${safe(item.sku || "Без артикулу")} · ${number(item.qty)} ${safe(item.unit)}</span></button>`).join("") || (value.trim() ? `<span class="wh-muted">Не знайдено. Можна створити новий товар.</span>` : "");
  }
  function updateEditorField(target) {
    if (!ui.editor || !target.closest("#whForm")) return;
    if (target.dataset.whLine !== undefined) {
      const line = ui.editor.lines[Number(target.dataset.whLine)];
      const key = target.dataset.whLineField;
      if (!line || !key) return;
      line[key] = target.value;
      if (key === "itemId") {
        const item = itemById(target.value);
        line.purchasePrice = priceInput(item?.purchasePrice);
        line.salePrice = Number(item?.retailPrice ?? item?.salePrice ?? 0);
        const lines = document.querySelector("#whLines");
        if (lines) lines.innerHTML = lineRows();
      }
      const total = document.querySelector("#whReceiptTotal");
      if (total) total.textContent = totalLabel() ? `Разом: ${totalLabel()}` : "";
    } else if (target.name) {
      if (ui.editor.mode === "catalog") {
        ui.editor.item[target.name] = target.value;
        if (target.name === "category") document.querySelector("#whCategoryFields").innerHTML = categoryFields(ui.editor.item);
      } else ui.editor[target.name] = target.value;
    }
  }
  async function release(id) {
    await transact((state) => {
      const entry = state.reservations.find((reservation) => String(reservation.id) === String(id));
      if (!entry) return state;
      const doc = { currency: currencyOf(itemById(entry.itemId)), id: uid("wd"), type: "release", number: makeNumber("release"), date: today(), createdAt: new Date().toISOString(), status: "posted", projectId: entry.projectId, projectTitle: projects.find((project) => String(project.id) === String(entry.projectId))?.title || "", lines: [{ itemId: entry.itemId, itemName: itemById(entry.itemId)?.name, qty: entry.qty, unit: itemById(entry.itemId)?.unit }] };
      return { ...state, reservations: core.releaseReservation(state.reservations, id), documents: [doc, ...state.documents] };
    });
    ui.notice = "Резерв знято. Обладнання знову доступне для інших об’єктів.";
    render(); if (ui.editor?.mode === "detail") renderEditor();
  }
  document.addEventListener("submit", (event) => { if (event.target.id === "whForm") { event.preventDefault(); void saveEditor(); } });
  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target.dataset.whFilter !== undefined && target.tagName === "INPUT") {
      const cursor = target.selectionStart;
      ui.filters[target.dataset.whFilter] = target.value; render();
      const next = container.querySelector(`[data-wh-filter="${target.dataset.whFilter}"]`); next.focus(); next.setSelectionRange(cursor, cursor);
    }
    if (target.dataset.whDocumentFilter === "query") {
      const cursor = target.selectionStart;
      ui.documentQuery = target.value; render();
      const next = container.querySelector('[data-wh-document-filter="query"]'); next.focus(); next.setSelectionRange(cursor, cursor);
    }
    if (target.id === "whReceiptSearch") refreshSearchResults(target.value);
    updateEditorField(target);
  });
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.dataset.whFilter !== undefined && target.tagName === "SELECT") { ui.filters[target.dataset.whFilter] = target.value; render(); }
    if (target.dataset.whDocumentFilter === "type") { ui.documentType = target.value; render(); }
    if (target.id === "whAttachments" && ui.editor) {
      ui.editor.pendingFiles = [...(ui.editor.pendingFiles || []), ...target.files];
      document.querySelector("#whAttachmentList").innerHTML = [...(ui.editor.attachments || []).map((file) => file.fileName), ...ui.editor.pendingFiles.map((file) => file.name)].map((name) => `<span>${safe(name)}</span>`).join("");
    }
    if (target.tagName === "SELECT") {
      updateEditorField(target);
      if (ui.editor && target.name === "currency") renderEditor();
      if (ui.editor && target.name === "projectId") {
        const project = projects.find((p) => String(p.id) === target.value);
        if (project) { ui.editor.currency = currencyOf(project); renderEditor(); }
      }
    }
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-wh-action], [data-wh-tab], [data-wh-group], [data-wh-item], [data-wh-edit], [data-wh-document], [data-wh-operation], [data-wh-remove-line], [data-wh-add-item], [data-wh-release], [data-wh-resume], [data-wh-open-file]");
    if (!button || ui.busy) return;
    const run = async () => {
      if (button.dataset.whAction === "reload-stock") {
        button.disabled = true;
        try { await window.SpartaWarehouseCloud.load(); render(); }
        finally { button.disabled = false; }
        return;
      }
      if (button.hasAttribute("data-wh-tab")) { ui.tab = button.dataset.whTab; ui.notice = ""; render(); return; }
      if (!canManage() && !(button.hasAttribute("data-wh-group") || button.dataset.whItem || button.dataset.whDocument || button.dataset.whOpenFile !== undefined || ["close", "reset-filters", "classic"].includes(button.dataset.whAction))) requireManage();
      if (button.hasAttribute("data-wh-group")) { ui.filters.group = button.dataset.whGroup; render(); return; }
      if (button.dataset.whItem) { ui.editor = { mode: "detail", itemId: button.dataset.whItem }; renderEditor(); return; }
      if (button.dataset.whEdit) { openCatalog(button.dataset.whEdit); return; }
      if (button.dataset.whDocument) { ui.editor = { mode: "document", documentId: button.dataset.whDocument }; renderEditor(); return; }
      if (button.dataset.whOperation) { openOperation(button.dataset.whOperation, button.dataset.whOperationItem); return; }
      if (button.dataset.whRelease) { await release(button.dataset.whRelease); return; }
      if (button.dataset.whResume) { const doc = snapshot().documents.find((entry) => entry.id === button.dataset.whResume); if (doc?.status === "draft") openOperation(doc.type, "", doc); return; }
      if (button.dataset.whOpenFile !== undefined) { const doc = allDocuments().find((entry) => entry.id === button.dataset.whFileDocument); const file = doc.attachments[Number(button.dataset.whOpenFile)]; if (file.storageBucket === "warehouse-files") await window.SpartaWarehouseCloud.openAttachment(file); else await openProjectFile(file); return; }
      if (button.dataset.whRemoveLine !== undefined) { ui.editor.lines.splice(Number(button.dataset.whRemoveLine), 1); renderEditor(); return; }
      if (button.dataset.whAddItem) {
        const item = itemById(button.dataset.whAddItem);
        const line = { itemId: item.id, qty: "", countedQty: "", purchasePrice: priceInput(item.purchasePrice), deliveryCost: "", extraCost: "", serialNumbers: "" };
        const empty = ui.editor.lines.findIndex((entry) => !entry.itemId);
        if (empty >= 0) ui.editor.lines[empty] = line; else ui.editor.lines.push(line);
        renderEditor(); return;
      }
      const action = button.dataset.whAction;
      switch (action) {
        case "close": closeEditor(); break;
        case "classic": writeLocalStorage("solarObjectManager.warehouseLayout", "classic"); renderWarehouseView(); break;
        case "reset-filters": ui.filters = { query: "", group: "", brand: "", availability: "" }; render(); break;
        case "new-product": openCatalog(); break;
        case "import-catalog": if (!window.SpartaInventoryImportUI) throw new Error("Оновіть сторінку для імпорту номенклатури."); await window.SpartaInventoryImportUI.open(); break;
        case "new-product-in-receipt": openCatalog("", true); break;
        case "save-draft": await saveEditor(true); break;
        case "add-line": ui.editor.lines.push({ itemId: "", qty: "", countedQty: "", purchasePrice: "", deliveryCost: "", extraCost: "", serialNumbers: "" }); renderEditor(); break;
        default: if (types[action]) { button.closest("details")?.removeAttribute("open"); openOperation(action); }
      }
    };
    void run().catch((error) => { ui.notice = error.message; render(); });
  });
  function reset() {
    ui.editor = null; ui.parentEditor = null; ui.busy = false; ui.notice = "";
    ui.filters = { query: "", group: "", brand: "", availability: "" };
    ui.documentQuery = ""; ui.documentType = ""; ui.tab = "stock";
    document.querySelector("#whDialog")?.remove();
    if (container) container.innerHTML = "";
  }
  window.SpartaWarehouseUI = Object.freeze({ render, bootstrap, capture, openForProject, reset });
})();
