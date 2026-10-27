(function () {
  "use strict";

  const safe = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const num = (value) => Number(value || 0).toLocaleString("uk-UA", { maximumFractionDigits: 3 });
  const money = (value, currency) => `${Number(value || 0).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === "UAH" ? "грн" : "USD"}`;
  const statusNames = { submitted: "Очікує підтвердження", confirmed: "Підтверджено", ready: "Готове до видачі", completed: "Видано", cancelled: "Скасовано" };
  const priceTypes = {retail:"Роздрібна",installer:"Для монтажників",wholesale:"Оптова"};
  const priceLabel = (type) => priceTypes[type] || "Для монтажників";
  const staffRoles = ["owner", "admin", "engineer", "warehouse"];
  let target = null;
  let generation = 0;
  let state = fresh();

  function fresh() {
    return { mode: "", key: "", context: null, buyerId: "", priceType: "installer", tab: "catalog", items: [], orders: [], buyers: [], salesDocuments: [], linkEditor: null, cart: new Map(), delivery: { method: "pickup", address: "", phone: "", comment: "" }, query: "", category: "", availableOnly: false, orderFilter: "active", loaded: false, busy: false, refreshing: false, lastRefreshed: "", priceReview: false, error: "", notice: "", pendingSubmit: null, requests: new Map(), editor: null };
  }
  function provider() {
    if (!window.SpartaBuyerCloud) throw new Error("Кабінет покупця не підключено. Оновіть сторінку.");
    return window.SpartaBuyerCloud;
  }
  function uuid() {
    if (!window.crypto?.randomUUID) throw new Error("Браузер не підтримує безпечне надсилання. Оновіть браузер.");
    return window.crypto.randomUUID();
  }
  function identity(context) {
    if (!context?.userId) throw new Error("Увійдіть знову, щоб продовжити.");
    return JSON.stringify([context.userId, context.audience, context.role, context.companyId, context.buyerId, (context.accounts || []).map((a) => [a.id, a.companyId, a.isActive]).sort()]);
  }
  function activeAccounts(context) { return (context?.accounts || []).filter((entry) => entry.isActive !== false); }
  function same(token) { return generation === token && Boolean(target); }
  function textError(error) { return error?.message || "Не вдалося завантажити дані. Перевірте з’єднання та спробуйте ще раз."; }
  function definitive(error) { return error?.definitive === true || ["P0001", "22023", "42501", "23514", "23503"].includes(error?.code); }
  function exactPrice(item) { return item?.price !== null && item?.price !== undefined && Number.isFinite(Number(item.price)) && Number(item.price) > 0; }
  function validCurrency(item) { return ["USD", "UAH"].includes(item?.currency); }
  function whole(item) { return ["шт", "компл"].includes(String(item?.unit || "").trim().toLowerCase().replace(/\.$/, "")); }
  function available(item) { return Math.max(0, Number(item?.availableQty) || 0); }
  function quantityError(item, value) {
    const qty = Number(value);
    if (!Number.isFinite(qty) || qty <= 0) return "Вкажіть кількість більше нуля.";
    if (whole(item) && !Number.isInteger(qty)) return "Для цієї одиниці потрібна ціла кількість.";
    if (Math.abs(qty * 1000 - Math.round(qty * 1000)) > 0.000001) return "Дозволено до трьох знаків після коми.";
    if (qty > available(item) + 0.0000001) return "Кількість перевищує доступний залишок.";
    return "";
  }
  function cleanItem(item) {
    return { id: String(item.id), name: item.name, sku: item.sku, category: item.category, brand: item.brand, model: item.model, unit: item.unit, currency: item.currency, price: item.price, availableQty: item.availableQty };
  }
  function cleanOrder(order) {
    return { id: String(order.id), number: order.number, buyerId: String(order.buyerId), buyerName: order.buyerName, companyId: String(order.companyId), status: order.status, currency: order.currency, priceType: order.priceType, warehouseDocumentNumber: order.warehouseDocumentNumber, total: order.total, createdAt: order.createdAt, updatedAt: order.updatedAt, deliveryMethod: order.deliveryMethod, address: order.address, phone: order.phone, comment: order.comment, lines: (order.lines || []).map((line) => ({ itemId: String(line.itemId), sku: line.sku, name: line.name, unit: line.unit, qty: line.qty, unitPrice: line.unitPrice, currency: line.currency, lineTotal: line.lineTotal })) };
  }
  function cleanBuyer(b) { return { id: String(b.id), companyId: b.companyId, name: b.name, email: b.email, phone: b.phone, priceType: b.priceType || "installer", isActive: b.isActive, createdAt: b.createdAt, invitation: b.invitation ? { id: b.invitation.id, status: b.invitation.status, lastSendStatus: b.invitation.lastSendStatus, lastSentAt: b.invitation.lastSentAt, expiresAt: b.invitation.expiresAt } : null }; }
  function ownOrders(result) {
    return (result?.orders || []).filter((order) => state.mode === "buyer" ? String(order.buyerId) === state.buyerId : String(order.companyId) === String(state.context.companyId)).map(cleanOrder);
  }
  function applyCatalog(result) {
    const account = activeAccounts(state.context).find((entry) => String(entry.id) === state.buyerId);
    if (!result?.buyer || String(result.buyer.id) !== state.buyerId || (account?.companyId && String(account.companyId) !== String(result.buyer.companyId))) throw new Error("Доступ до каталогу змінився. Увійдіть знову.");
    if (state.pendingSubmit) return;
    const next = (result.items || []).map(cleanItem);
    for (const id of state.cart.keys()) {
      const before = state.items.find((item) => item.id === id);
      const after = next.find((item) => item.id === id);
      if (!after || !before || Number(before.price) !== Number(after.price) || before.currency !== after.currency) state.priceReview = true;
    }
    state.priceType = result.buyer.priceType || account?.priceType || "installer";
    state.items = next;
    state.lastRefreshed = new Date().toISOString();
  }
  function clearPrivate(message) {
    generation += 1;
    const mode = state.mode;
    state = fresh();
    state.mode = mode;
    state.error = message;
    draw();
  }
  function hidePrivate(message) {
    generation += 1;
    state.loaded = false;
    state.busy = false;
    state.error = message;
    state.notice = "";
    draw();
  }
  async function verifiedContext(token) {
    let context;
    let key;
    try { context = await provider().getContext(); key = identity(context); } catch (error) { if (same(token)) { if (state.key && !definitive(error)) hidePrivate(textError(error)); else clearPrivate(textError(error)); } throw error; }
    if (!same(token)) return null;
    if (key !== state.key) { clearPrivate("Обліковий запис або права змінилися. Оновіть кабінет."); return null; }
    return context;
  }
  async function enter(mode, nextTarget) {
    if (!nextTarget) return;
    if (target && target !== nextTarget) { unbind(target); target.innerHTML = ""; }
    target = nextTarget;
    bind(target);
    const token = ++generation;
    state.refreshing = false;
    let retained = false;
    target.innerHTML = '<section class="bp-app" aria-busy="true"><p class="bp-empty" role="status">Завантажуємо кабінет…</p></section>';
    try {
      const context = await provider().getContext();
      if (!same(token)) return;
      const key = identity(context);
      retained = state.key === key && state.mode === mode && state.loaded;
      if (state.key !== key || state.mode !== mode) { state = fresh(); state.mode = mode; state.key = key; state.context = context; }
      else state.context = context;
      state.error = "";
      state.loaded = false;
      if (mode === "buyer") {
        if (context.audience !== "buyer") throw new Error("Цей розділ доступний покупцям за запрошенням.");
        const accounts = activeAccounts(context);
        if (!accounts.length) throw new Error("Активного доступу покупця не знайдено. Зверніться до менеджера.");
        if (!accounts.some((entry) => String(entry.id) === state.buyerId)) state.buyerId = String(accounts.find((entry) => String(entry.id) === String(context.buyerId))?.id || accounts[0].id);
        const [catalog, orders] = await Promise.all([provider().catalog(state.buyerId), provider().orders(state.buyerId)]);
        if (!same(token)) return;
        applyCatalog(catalog);
        state.orders = ownOrders(orders);
        if (!state.delivery.phone && !state.pendingSubmit) state.delivery.phone = catalog.buyer.phone || "";
      } else {
        if (context.audience !== "staff" || !staffRoles.includes(context.role) || !context.companyId) throw new Error("Недостатньо прав для перегляду продажів.");
        state.tab = ["buyers", "orders"].includes(state.tab) ? state.tab : "orders";
        const [buyers, orders] = await Promise.all([provider().buyers(), provider().salesOrders()]);
        if (!same(token)) return;
        state.buyers = (buyers?.buyers || []).filter((b) => String(b.companyId) === String(context.companyId)).map(cleanBuyer);
        state.orders = ownOrders(orders);
      }
      state.loaded = true;
      state.busy = false;
      draw();
    } catch (error) {
      if (!same(token)) return;
      if (retained && !error?.definitive) { state.loaded = true; state.busy = false; state.error = textError(error); draw(); }
      else if (state.key && !definitive(error)) hidePrivate(textError(error));
      else clearPrivate(textError(error));
    }
  }
  function reset() {
    generation += 1;
    state = fresh();
    if (target) { unbind(target); target.innerHTML = ""; }
    target = null;
  }
  async function refreshBuyer() {
    if (!target || state.mode !== "buyer" || !state.loaded || state.busy || state.refreshing || state.pendingSubmit) return false;
    const editing = typeof document !== "undefined" ? document.activeElement : null;
    if (editing && target.contains?.(editing) && ["INPUT", "TEXTAREA", "SELECT"].includes(editing.tagName)) return false;
    const token = generation;
    state.refreshing = true;
    try {
      if (!await verifiedContext(token)) return false;
      const [catalog, orders] = await Promise.all([provider().catalog(state.buyerId), provider().orders(state.buyerId)]);
      if (!same(token) || state.pendingSubmit || state.busy) return false;
      const active = typeof document !== "undefined" ? document.activeElement : null;
      if (active && target.contains?.(active) && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return false;
      applyCatalog(catalog);
      state.orders = ownOrders(orders);
      state.error = "";
      draw();
      return true;
    } catch (error) {
      if (same(token)) {
        if (["42501", "AUTH_REQUIRED", "CONTEXT_CHANGED"].includes(error?.code)) clearPrivate(textError(error));
        else { state.error = `Не вдалося оновити наявність. ${textError(error)}`; draw(); }
      }
      return false;
    } finally { if (same(token)) state.refreshing = false; }
  }
  function bind(element) { unbind(element); element.addEventListener("click", onClick); element.addEventListener("change", onChange); element.addEventListener("input", onInput); element.addEventListener("submit", onSubmit); }
  function unbind(element) { element.removeEventListener("click", onClick); element.removeEventListener("change", onChange); element.removeEventListener("input", onInput); element.removeEventListener("submit", onSubmit); }
  function button(label, action, extra = "", primary = false, disabled = false) { return `<button type="button" class="bp-button${primary ? " bp-primary" : ""}" data-bp-action="${action}" ${extra} ${disabled || state.busy ? "disabled" : ""}>${label}</button>`; }
  function notice() { return `${state.error ? `<div class="bp-notice bp-error" role="alert">${safe(state.error)}</div>` : ""}${state.notice ? `<div class="bp-notice" role="status">${safe(state.notice)}</div>` : ""}`; }
  function draw() {
    if (!target) return;
    if (!state.loaded) { target.innerHTML = `<section class="bp-app"><h2>${state.mode === "sales" ? "Продажі" : "Кабінет покупця"}</h2>${notice()}${button("Спробувати ще раз", "reload")}</section>`; return; }
    const buyer = state.mode === "buyer";
    const account = activeAccounts(state.context).find((entry) => String(entry.id) === state.buyerId);
    const tabs = buyer ? [["catalog", "Каталог"], ["cart", `Кошик${state.cart.size ? ` · ${state.cart.size}` : ""}`], ["orders", "Мої замовлення"], ["history", "Історія покупок"]] : [["orders", "Замовлення"], ["buyers", "Покупці"]];
    target.innerHTML = `<section class="bp-app" aria-busy="${state.busy}"><header class="bp-header"><div><p class="bp-eyebrow">${safe(buyer ? account?.companyName || state.context.companyName || "SPARTA power" : state.context.companyName || "SPARTA power")}</p><h2>${buyer ? "Кабінет покупця" : "Продажі"}</h2><p class="bp-muted">${buyer ? safe(account?.name || "Обладнання для ваших замовлень") : "Замовлення постійних покупців"}</p>${buyer && state.lastRefreshed ? `<p class="bp-muted bp-footnote">Наявність оновлено: ${safe(date(state.lastRefreshed))}</p>` : ""}</div><div class="bp-actions">${button("Оновити", "reload", "", false, Boolean(state.pendingSubmit))}${buyer && provider().changePassword ? button("Змінити пароль", "password") : ""}${buyer && provider().signOut ? button("Вийти", "sign-out") : ""}</div></header>${buyer && activeAccounts(state.context).length > 1 ? `<label class="bp-account">Акаунт покупця<select data-bp-field="account" ${state.busy || state.pendingSubmit ? "disabled" : ""}>${activeAccounts(state.context).map((entry) => `<option value="${safe(entry.id)}" ${String(entry.id) === state.buyerId ? "selected" : ""}>${safe(entry.name)} · ${safe(entry.companyName || "")}</option>`).join("")}</select></label>` : ""}<nav class="bp-tabs" aria-label="${buyer ? "Кабінет покупця" : "Продажі"}">${tabs.map(([key, label]) => `<button type="button" data-bp-tab="${key}" aria-current="${state.tab === key ? "page" : "false"}" class="${state.tab === key ? "is-active" : ""}">${label}</button>`).join("")}</nav>${notice()}${buyer ? state.tab === "catalog" ? catalogView() : state.tab === "cart" ? cartView() : ordersView() : state.tab === "buyers" ? buyersView() : ordersView()}</section>`;
  }
  function catalogView() {
    const categories = [...new Set(state.items.map((item) => item.category).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "uk"));
    const query = state.query.trim().toLocaleLowerCase("uk-UA");
    const items = state.items.filter((item) => (!state.category || item.category === state.category) && (!state.availableOnly || available(item) > 0) && (!query || [item.name, item.sku, item.brand, item.model].join(" ").toLocaleLowerCase("uk-UA").includes(query)));
    return `<div class="bp-toolbar"><label class="bp-search">Пошук обладнання<input type="search" data-bp-field="query" value="${safe(state.query)}" placeholder="Назва, артикул, бренд" /></label><label>Категорія<select data-bp-field="category"><option value="">Усі категорії</option>${categories.map((category) => `<option value="${safe(category)}" ${state.category === category ? "selected" : ""}>${safe(category)}</option>`).join("")}</select></label><label class="bp-check"><input type="checkbox" data-bp-field="availableOnly" ${state.availableOnly ? "checked" : ""} /> Тільки в наявності</label></div><p class="bp-muted">${items.length} позицій · ваш тип ціни: ${safe(priceLabel(state.priceType))}. Залишок резервується після підтвердження менеджером.</p><div class="bp-products">${items.map((item) => `<article class="bp-card bp-product"><div>${window.SpartaProductPhotos?.thumbnailHtml(item, { large: true }) || ""}<p class="bp-muted">${safe(item.category || "Обладнання")}</p><h3>${safe(item.name)}</h3><p class="bp-muted">${safe([item.sku, item.brand, item.model].filter(Boolean).join(" · "))}</p></div><div class="bp-product-bottom"><div><strong>${exactPrice(item) && validCurrency(item) ? money(item.price, item.currency) : "Ціну уточнюйте"}</strong><span class="bp-muted">за ${safe(item.unit)} · доступно ${num(available(item))} ${safe(item.unit)}</span></div>${button(state.cart.has(item.id) ? "Додати ще" : "У кошик", "add", `data-bp-id="${safe(item.id)}"`, false, Boolean(state.pendingSubmit) || !exactPrice(item) || !validCurrency(item) || available(item) < (whole(item) ? 1 : 0.001))}</div></article>`).join("") || '<div class="bp-empty">Обладнання не знайдено. Змініть пошук або фільтри.</div>'}</div>`;
  }
  function cartLines() {
    return [...state.cart].map(([id, qty]) => ({ item: state.items.find((item) => item.id === id), id, qty }));
  }
  function cartProblem() {
    const lines = cartLines();
    if (!lines.length) return "Додайте обладнання до кошика.";
    const currencies = new Set();
    for (const line of lines) {
      if (!line.item || !exactPrice(line.item) || !validCurrency(line.item)) return "Для одного з товарів немає актуальної ціни. Оновіть каталог.";
      const problem = quantityError(line.item, line.qty);
      if (problem) return problem;
      currencies.add(line.item.currency);
    }
    if (currencies.size > 1) return "В одному замовленні може бути лише одна валюта. Розділіть товари на окремі замовлення.";
    return "";
  }
  function lineCents(qty, price) { return Math.floor((Math.round(Number(qty) * 1000) * Math.round(Number(price) * 100) + 500) / 1000); }
  function total() { return cartLines().reduce((sum, line) => sum + lineCents(line.qty, line.item?.price || 0), 0) / 100; }
  function cartView() {
    const locked = Boolean(state.pendingSubmit) || state.busy;
    if (!state.cart.size) return `<div class="bp-empty"><h3>Кошик порожній</h3><p>Оберіть обладнання в каталозі.</p>${button("До каталогу", "catalog")}</div>`;
    const issue = cartProblem();
    return `<div class="bp-cart"><div class="bp-stack">${cartLines().map(({ item, id, qty }) => `<article class="bp-card bp-cart-row"><div>${item ? window.SpartaProductPhotos?.thumbnailHtml(item) || "" : ""}<h3>${safe(item?.name || "Товар недоступний")}</h3><p class="bp-muted">${safe(item?.sku || "")} · ${item && exactPrice(item) ? money(item.price, item.currency) : "Ціну уточнюйте"} / ${safe(item?.unit || "од.")}</p><p class="bp-muted">Доступно ${num(available(item))} ${safe(item?.unit || "")}</p></div><label>Кількість<input aria-label="Кількість: ${safe(item?.name || id)}" data-bp-qty="${safe(id)}" type="number" min="${whole(item) ? 1 : 0.001}" max="${available(item)}" step="${whole(item) ? 1 : 0.001}" value="${safe(qty)}" ${locked ? "disabled" : ""} />${quantityError(item, qty) ? `<small class="bp-invalid">${safe(quantityError(item, qty))}</small>` : ""}</label><div class="bp-line-total">${item && exactPrice(item) ? money(Number(qty) * Number(item.price), item.currency) : "—"}${button("Прибрати", "remove", `data-bp-id="${safe(id)}"`, false, locked)}</div></article>`).join("")}</div><form class="bp-card bp-checkout" data-bp-form="checkout"><h3>Оформлення замовлення</h3><div class="bp-form-grid"><label>Отримання<select data-bp-delivery="method" ${locked ? "disabled" : ""}><option value="pickup" ${state.delivery.method === "pickup" ? "selected" : ""}>Самовивіз</option><option value="delivery" ${state.delivery.method === "delivery" ? "selected" : ""}>Доставка</option></select></label><label>Контактний телефон<input type="tel" data-bp-delivery="phone" value="${safe(state.delivery.phone)}" maxlength="60" required ${locked ? "disabled" : ""} /></label>${state.delivery.method === "delivery" ? `<label class="bp-full">Адреса доставки<input data-bp-delivery="address" value="${safe(state.delivery.address)}" maxlength="500" required ${locked ? "disabled" : ""} /></label>` : ""}<label class="bp-full">Коментар<textarea data-bp-delivery="comment" rows="2" maxlength="2000" ${locked ? "disabled" : ""}>${safe(state.delivery.comment)}</textarea></label></div>${state.pendingSubmit ? '<p class="bp-notice">Надсилання ще не підтверджене. Повторна спроба перевірить це саме замовлення; склад і ціни не будуть замовлені двічі.</p>' : '<p class="bp-muted">Поточні ціни будуть зафіксовані під час надсилання. Менеджер підтвердить наявність і видачу. Онлайн оплати немає.</p>'}${issue ? `<p class="bp-invalid" role="alert">${safe(issue)}</p>` : `<p class="bp-total">Разом <strong>${money(total(), cartLines()[0]?.item?.currency)}</strong></p>`}${state.priceReview && !state.pendingSubmit ? `<p class="bp-notice">Ціни в кошику змінилися. Перевірте актуальні ціни й суму перед надсиланням.</p>${button("Підтверджую актуальні ціни", "review-prices")}` : ""}<button type="submit" class="bp-button bp-primary" ${state.busy || (!state.pendingSubmit && (Boolean(issue) || state.priceReview)) ? "disabled" : ""}>${state.busy ? "Надсилаємо…" : state.pendingSubmit ? "Повторити надсилання" : "Надіслати замовлення"}</button>${button("Очистити кошик", "clear-cart", "", false, locked)}</form></div>`;
  }
  function date(value) { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""; }
  function canAction(action, order) {
    const role = state.context?.role;
    if (state.mode !== "sales" || !staffRoles.includes(role)) return false;
    if (action === "confirm") return ["owner", "admin", "engineer"].includes(role) && order.status === "submitted";
    if (action === "ready") return ["owner", "admin", "warehouse"].includes(role) && order.status === "confirmed";
    if (action === "fulfil") return ["owner", "admin", "warehouse"].includes(role) && order.status === "ready";
    return action === "cancel" && ["submitted", "confirmed", "ready"].includes(order.status);
  }
  function orderCard(order) {
    const buyer = state.mode === "buyer";
    return `<article class="bp-card bp-order"><header class="bp-order-header"><div><h3>${safe(order.number || "Замовлення")}</h3><span class="bp-muted">${safe(date(order.createdAt))}${!buyer ? ` · ${safe(order.buyerName || "Покупець")}` : ""}</span></div><span class="bp-badge bp-status-${safe(Object.hasOwn(statusNames, order.status) ? order.status : "unknown")}">${safe(statusNames[order.status] || "Статус уточнюється")}</span></header><div class="bp-order-lines">${order.lines.map((line) => `<div><span><strong>${safe(line.name)}</strong><small class="bp-muted">${safe(line.sku || "")} · ${num(line.qty)} ${safe(line.unit)} × ${money(line.unitPrice, line.currency)}</small></span><strong>${money(line.lineTotal, line.currency)}</strong></div>`).join("")}</div><p class="bp-total">Разом <strong>${money(order.total, order.currency)}</strong></p><p class="bp-muted">${order.deliveryMethod === "delivery" ? `Доставка: ${safe(order.address || "")}` : "Самовивіз"}${order.phone ? ` · ${safe(order.phone)}` : ""}</p>${order.comment ? `<p class="bp-comment">${safe(order.comment)}</p>` : ""}<div class="bp-actions">${buyer ? `${button(state.cart.size ? "Замінити кошик і повторити" : "Повторити замовлення", "repeat", `data-bp-id="${safe(order.id)}"`, false, Boolean(state.pendingSubmit))}${order.status === "submitted" ? button("Скасувати замовлення", "buyer-cancel", `data-bp-id="${safe(order.id)}"`) : ""}` : [["confirm", "Підтвердити та зарезервувати"], ["ready", "Готове до видачі"], ["fulfil", "Видати зі складу"], ["cancel", "Скасувати"]].filter(([action]) => canAction(action, order)).map(([action, label]) => button(label, "order-action", `data-bp-id="${safe(order.id)}" data-bp-order-action="${action}"`, action === "confirm")).join("")}</div>${buyer ? '<p class="bp-muted bp-footnote">Ціни цього замовлення збережено на момент надсилання. Повторення використовує актуальний каталог.</p>' : ""}</article>`;
  }
  function ordersView() {
    const buyer = state.mode === "buyer";
    let orders = state.orders;
    if (buyer) orders = orders.filter((order) => state.tab === "history" ? order.status === "completed" : order.status !== "completed");
    else if (state.orderFilter !== "all") orders = orders.filter((order) => state.orderFilter === "active" ? ["submitted", "confirmed", "ready"].includes(order.status) : order.status === state.orderFilter);
    orders = [...orders].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return `${!buyer ? `<label class="bp-order-filter">Статус<select data-bp-field="orderFilter">${[["active", "Активні"], ["submitted", "Нові"], ["confirmed", "Підтверджені"], ["ready", "Готові до видачі"], ["completed", "Видані"], ["cancelled", "Скасовані"], ["all", "Усі замовлення"]].map(([key, label]) => `<option value="${key}" ${state.orderFilter === key ? "selected" : ""}>${label}</option>`).join("")}</select></label>` : ""}<div class="bp-stack">${orders.map(orderCard).join("") || `<div class="bp-empty">${buyer && state.tab === "history" ? "Виданих замовлень ще немає." : "Замовлень поки немає."}</div>`}</div>`;
  }
  function mayEditBuyers() { return state.mode === "sales" && ["owner", "admin"].includes(state.context?.role); }
  function mayLinkPurchases() { return state.mode === "sales" && ["owner", "admin", "warehouse"].includes(state.context?.role); }
  function buyersView() {
    return `${mayEditBuyers() ? `<div class="bp-actions">${button("Додати покупця", "new-buyer", "", true)}</div>` : '<p class="bp-muted">Перегляд покупців. Доступом керує власник або адміністратор.</p>'}${state.editor ? buyerForm() : ""}${state.linkEditor && mayLinkPurchases() ? purchaseLinkForm() : ""}<div class="bp-stack">${state.buyers.map((buyer) => `<article class="bp-card bp-buyer"><div><h3>${safe(buyer.name)}</h3><p class="bp-muted">${safe(buyer.email)}${buyer.phone ? ` · ${safe(buyer.phone)}` : ""}</p><span class="bp-badge">${safe(priceLabel(buyer.priceType))}</span><span class="bp-badge">${buyer.isActive === false ? "Доступ вимкнено" : buyer.invitation?.status === "accepted" ? "Доступ активний" : "Активний покупець"}</span>${buyer.invitation ? `<p class="bp-muted">${safe({ pending: "Запрошення очікує прийняття", accepted: "Запрошення прийнято", expired: "Термін запрошення минув", revoked: "Запрошення відкликано" }[buyer.invitation.status] || "Запрошення створено")}${buyer.invitation.lastSentAt ? ` · останнє надсилання ${safe(date(buyer.invitation.lastSentAt))}` : ""}${buyer.invitation.lastSendStatus ? ` · ${safe({ sent: "лист надіслано", succeeded: "лист надіслано", failed: "лист не надіслано", unsent: "лист ще не надіслано", pending: "лист готується" }[buyer.invitation.lastSendStatus] || buyer.invitation.lastSendStatus)}` : ""}</p>` : ""}${buyer.isActive !== false && buyer.invitation?.status === "accepted" ? '<p class="bp-muted">Для відновлення пароля покупець може натиснути «Забули пароль?» на сторінці входу.</p>' : ""}</div>${mayEditBuyers() || mayLinkPurchases() ? `<div class="bp-actions">${mayEditBuyers() ? button("Редагувати", "edit-buyer", `data-bp-id="${safe(buyer.id)}"`) : ""}${mayEditBuyers() && buyer.isActive !== false && buyer.invitation?.status !== "accepted" ? button("Надіслати доступ", "send-access", `data-bp-id="${safe(buyer.id)}"`) : ""}${mayLinkPurchases() ? button("Прив’язати продаж", "link-purchase", `data-bp-id="${safe(buyer.id)}"`, false, Boolean(state.linkEditor?.pending)) : ""}</div>` : ""}</article>`).join("") || '<div class="bp-empty">Покупців ще немає.</div>'}</div>`;
  }
  function purchaseLinkForm() {
    const editor = state.linkEditor;
    const locked = state.busy || Boolean(editor.pending);
    const selected = state.salesDocuments.find((document) => document.id === editor.documentId);
    return `<form class="bp-card bp-buyer-form" data-bp-form="link-purchase"><h3>Прив’язати проведений продаж</h3><p class="bp-muted">Прив’язка додає покупку в історію; товар повторно не списується. Виберіть покупця й документ вручну та перевірте суму.</p><div class="bp-form-grid"><label>Покупець<select data-bp-link="buyerId" required ${locked ? "disabled" : ""}><option value="">Оберіть покупця</option>${state.buyers.map((buyer) => `<option value="${safe(buyer.id)}" ${buyer.id === editor.buyerId ? "selected" : ""}>${safe(buyer.name)} · ${safe(buyer.email)}</option>`).join("")}</select></label><label>Проведений продаж<select data-bp-link="documentId" required ${locked || !editor.documentsLoaded ? "disabled" : ""}><option value="">Оберіть документ продажу</option>${state.salesDocuments.map((document) => `<option value="${safe(document.id)}" ${document.id === editor.documentId ? "selected" : ""} ${document.canLink === false ? "disabled" : ""}>${safe(document.number || document.id)} · ${safe(document.date || "")} · ${safe(document.customer || "Без назви покупця")} · ${money(document.total, document.currency)}</option>`).join("")}</select></label></div>${selected ? `<p class="bp-total">Сума за документом <strong>${money(selected.total, selected.currency)}</strong></p>` : ""}${editor.documentsLoaded && !state.salesDocuments.length ? '<p class="bp-muted">Неприв’язаних проведених продажів не знайдено.</p>' : ""}${editor.pending ? '<p class="bp-notice">Результат ще не підтверджено. Повторна спроба перевірить цю саму прив’язку без повторного списання товару.</p>' : ""}<div class="bp-actions"><button type="submit" class="bp-button bp-primary" ${state.busy || (!editor.pending && (!editor.buyerId || !selected || !selected.canLink)) ? "disabled" : ""}>${state.busy ? "Зберігаємо…" : editor.pending ? "Повторити прив’язку" : "Додати покупку в історію"}</button>${!editor.pending ? button("Оновити продажі", "refresh-link-sales") : ""}${button("Закрити", "close-link", "", false, Boolean(editor.pending))}</div></form>`;
  }
  async function loadUnlinkedSales(token) {
    if (!mayLinkPurchases() || !state.linkEditor) throw new Error("Прив’язувати продажі може власник, адміністратор або працівник складу.");
    const result = await provider().unlinkedSales();
    if (!same(token)) return;
    state.salesDocuments = (result?.documents || []).map((document) => ({ id: String(document.id), number: document.number, date: document.date, customer: document.customer, currency: document.currency, total: document.total, canLink: document.canLink !== false, linkError: document.linkError }));
    state.linkEditor.documentsLoaded = true;
    if (!state.salesDocuments.some((document) => document.id === state.linkEditor.documentId)) state.linkEditor.documentId = "";
  }
  async function linkPurchase(token) {
    if (!mayLinkPurchases() || !state.linkEditor) throw new Error("Недостатньо прав для прив’язки продажу.");
    const editor = state.linkEditor;
    if (!editor.pending) {
      if (!state.buyers.some((buyer) => buyer.id === editor.buyerId) || !state.salesDocuments.some((document) => document.id === editor.documentId && document.canLink)) throw new Error("Виберіть покупця та проведений продаж зі списку.");
      editor.pending = { buyerId: editor.buyerId, documentId: editor.documentId, requestId: requestFor(`link:${editor.buyerId}:${editor.documentId}`) };
    }
    try {
      const result = await provider().linkPurchase({ ...editor.pending });
      if (!same(token)) return;
      if (!result?.order || String(result.order.buyerId) !== editor.pending.buyerId || result.order.status !== "completed") throw new Error("Результат прив’язки не підтверджено. Повторіть перевірку.");
      updateOrder(result);
      state.salesDocuments = state.salesDocuments.filter((document) => document.id !== editor.pending.documentId);
      state.requests.delete(`link:${editor.pending.buyerId}:${editor.pending.documentId}`);
      state.linkEditor = null;
      state.notice = "Продаж додано до історії покупця. Товар повторно не списувався.";
    } catch (error) {
      if (!same(token)) return;
      if (definitive(error)) { editor.pending = null; throw error; }
      throw new Error(`${textError(error)} Результат не підтверджено. Повторіть цю саму прив’язку.`);
    }
  }
  function buyerForm() {
    const buyer = state.editor;
    return `<form class="bp-card bp-buyer-form" data-bp-form="buyer"><h3>${buyer.id ? "Дані покупця" : "Новий покупець"}</h3><div class="bp-form-grid"><label>Назва / ім’я<input name="buyerName" data-bp-editor="name" value="${safe(buyer.name)}" maxlength="240" required ${state.busy ? "disabled" : ""} /></label><label>Email для входу<input name="buyerEmail" data-bp-editor="email" type="email" value="${safe(buyer.email)}" maxlength="320" required ${buyer.id || state.busy ? "disabled" : ""} />${buyer.id ? '<small class="bp-muted">Для іншого email створіть окремого покупця.</small>' : ""}</label><label>Телефон<input name="buyerPhone" data-bp-editor="phone" type="tel" value="${safe(buyer.phone)}" maxlength="60" ${state.busy ? "disabled" : ""} /></label><label>Тип ціни<select data-bp-editor="priceType" ${state.busy ? "disabled" : ""}>${Object.entries(priceTypes).map(([key,label]) => `<option value="${key}" ${(buyer.priceType || "installer") === key ? "selected" : ""}>${safe(label)}</option>`).join("")}</select></label>${buyer.id ? `<label class="bp-check"><input type="checkbox" data-bp-editor="isActive" ${buyer.isActive !== false ? "checked" : ""} ${state.busy ? "disabled" : ""} /> Доступ активний</label>` : ""}</div><p class="bp-muted">Покупець отримує власний кабінет з обраним типом ціни. Інші типи цін йому не показуються. Після збереження надішліть доступ окремою кнопкою.</p><div class="bp-actions"><button class="bp-button bp-primary" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "Зберігаємо…" : "Зберегти"}</button>${button("Закрити", "close-editor")}</div></form>`;
  }
  async function run(task) {
    if (state.busy || !state.loaded) return;
    const token = generation;
    state.busy = true;
    state.error = "";
    state.notice = "";
    draw();
    try { if (await verifiedContext(token)) await task(token); }
    catch (error) {
      if (same(token)) {
        if (["42501", "AUTH_REQUIRED", "CONTEXT_CHANGED"].includes(error?.code)) clearPrivate(textError(error));
        else state.error = textError(error);
      }
    }
    finally { if (same(token)) { state.busy = false; draw(); } }
  }
  function requestFor(key) { if (!state.requests.has(key)) state.requests.set(key, uuid()); return state.requests.get(key); }
  function updateOrder(result) {
    const order = result?.order;
    if (!order || (state.mode === "buyer" ? String(order.buyerId) !== state.buyerId : String(order.companyId) !== String(state.context.companyId))) throw new Error("Не вдалося підтвердити результат операції. Оновіть список замовлень.");
    state.orders = [cleanOrder(order), ...state.orders.filter((entry) => entry.id !== String(order.id))];
  }
  async function submit(token) {
    if (state.mode !== "buyer") return;
    if (!state.pendingSubmit) {
      const issue = cartProblem();
      if (issue) throw new Error(issue);
      if (state.priceReview) throw new Error("Ціни змінилися. Перевірте суму та підтвердьте актуальні ціни.");
      if (!state.delivery.phone.trim()) throw new Error("Вкажіть контактний телефон.");
      if (state.delivery.method === "delivery" && !state.delivery.address.trim()) throw new Error("Вкажіть адресу доставки.");
      state.pendingSubmit = { buyerId: state.buyerId, requestId: uuid(), lines: [...state.cart].map(([itemId, qty]) => ({ itemId, qty: Number(qty) })), delivery: { method: state.delivery.method, address: state.delivery.method === "delivery" ? state.delivery.address.trim() : "", phone: state.delivery.phone.trim(), comment: state.delivery.comment.trim() }, expectedTotal: total() };
    }
    try {
      const result = await provider().submitOrder(JSON.parse(JSON.stringify(state.pendingSubmit)));
      if (!same(token)) return;
      updateOrder(result);
      state.pendingSubmit = null;
      state.cart.clear();
      state.delivery.comment = "";
      state.tab = "orders";
      state.notice = "Замовлення надіслано. Очікуйте підтвердження менеджера.";
    } catch (error) {
      if (!same(token)) return;
      if (definitive(error)) {
        state.pendingSubmit = null;
        try { const catalog = await provider().catalog(state.buyerId); if (same(token)) applyCatalog(catalog); } catch (_) { /* Keep the cart; the explicit refresh remains available. */ }
        throw error;
      }
      throw new Error(`${textError(error)} Відповідь не підтверджена. Натисніть «Повторити надсилання» для перевірки цього самого замовлення.`);
    }
  }
  async function repeatOrder(id, token) {
    if (state.mode !== "buyer" || state.pendingSubmit) return;
    const order = state.orders.find((entry) => entry.id === id);
    if (!order) return;
    const result = await provider().catalog(state.buyerId);
    if (!same(token)) return;
    applyCatalog(result);
    const cart = new Map();
    let currency = "";
    let adjusted = false;
    for (const line of order.lines) {
      const item = state.items.find((entry) => entry.id === line.itemId);
      if (!item || !exactPrice(item) || !validCurrency(item) || (currency && currency !== item.currency)) { adjusted = true; continue; }
      const desired = Number(line.qty) + Number(cart.get(item.id) || 0);
      const limit = whole(item) ? Math.floor(available(item)) : Math.floor((available(item) + 0.00000001) * 1000) / 1000;
      const qty = Math.min(desired, limit);
      if (qty <= 0) { adjusted = true; continue; }
      currency = item.currency;
      if (qty !== desired) adjusted = true;
      cart.set(item.id, qty);
    }
    state.cart = cart;
    state.priceReview = false;
    state.tab = "cart";
    state.notice = `Кошик заповнено за актуальними цінами. Перевірте кількість і суму перед надсиланням.${adjusted ? " Недоступні товари пропущено, кількість обмежено залишком; іншу валюту замовляйте окремо." : ""}`;
  }
  async function changeOrder(id, action, token, buyerCancel = false) {
    const order = state.orders.find((entry) => entry.id === id);
    if (!order || (buyerCancel ? state.mode !== "buyer" || order.status !== "submitted" : !canAction(action, order))) throw new Error("Недостатньо прав або статус замовлення змінився.");
    const key = `${id}:${action}`;
    const payload = { orderId: id, requestId: requestFor(key) };
    const result = buyerCancel ? await provider().cancelOrder(payload) : await provider().orderAction({ ...payload, action });
    if (!same(token)) return;
    updateOrder(result);
    state.requests.delete(key);
    state.notice = `Статус замовлення оновлено.${result.warning ? " " + result.warning : ""}`;
  }
  async function saveBuyer(token) {
    if (!mayEditBuyers() || !state.editor) throw new Error("Редагувати покупців може власник або адміністратор.");
    const editor = state.editor;
    const buyer = { ...(editor.id ? { id: editor.id } : {}), name: editor.name.trim(), email: editor.email.trim(), phone: editor.phone.trim(), priceType: editor.priceType || "installer", isActive: editor.isActive !== false };
    if (!buyer.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email)) throw new Error("Вкажіть ім’я та коректний email покупця.");
    if (!Object.hasOwn(priceTypes, buyer.priceType)) throw new Error("Оберіть відомий тип ціни.");
    const result = await provider().saveBuyer(buyer);
    if (!same(token)) return;
    if (!result?.buyer || String(result.buyer.companyId) !== String(state.context.companyId)) throw new Error("Дані покупця не підтверджено. Оновіть список.");
    state.editor = null;
    const refreshed = await provider().buyers();
    if (!same(token)) return;
    state.buyers = (refreshed.buyers || []).filter((entry) => String(entry.companyId) === String(state.context.companyId)).map(cleanBuyer);
    state.notice = "Покупця збережено. Для входу надішліть доступ.";
  }
  async function sendAccess(id, token) {
    if (!mayEditBuyers()) throw new Error("Надсилати доступ може власник або адміністратор.");
    let buyer = state.buyers.find((entry) => entry.id === id);
    if (!buyer || buyer.isActive === false) throw new Error("Доступ покупця вимкнено.");
    if (buyer.invitation?.status === "accepted") throw new Error("Доступ покупця вже активний. Для відновлення пароля скористайтеся «Забули пароль?» на сторінці входу.");
    // Saving renews an expired invitation. It never sends an email by itself.
    const saved = await provider().saveBuyer({ id: buyer.id, name: buyer.name, email: buyer.email, phone: buyer.phone || "", priceType: buyer.priceType || "installer", isActive: true });
    if (!same(token)) return;
    const invitation = saved.invitation || saved.buyer?.invitation || buyer.invitation;
    if (!invitation?.id) throw new Error("Запрошення не створено. Збережіть покупця та спробуйте ще раз.");
    await provider().sendAccess(invitation, buyer.email);
    if (!same(token)) return;
    const refreshed = await provider().buyers();
    if (!same(token)) return;
    state.buyers = (refreshed.buyers || []).filter((entry) => String(entry.companyId) === String(state.context.companyId)).map(cleanBuyer);
    state.notice = "Лист із доступом надіслано покупцю.";
  }
  function onClick(event) {
    const tab = event.target.closest?.("[data-bp-tab]");
    if (tab && !state.busy) {
      const allowed = state.mode === "buyer" ? ["catalog", "cart", "orders", "history"] : ["buyers", "orders"];
      if (allowed.includes(tab.dataset.bpTab)) { state.tab = tab.dataset.bpTab; draw(); }
      return;
    }
    const element = event.target.closest?.("[data-bp-action]");
    if (!element || element.disabled || state.busy) return;
    const action = element.dataset.bpAction;
    const id = String(element.dataset.bpId || "");
    if (action === "reload") { if (!state.pendingSubmit || !state.loaded) void enter(state.mode || "buyer", target); return; }
    if (!state.loaded) return;
    if (action === "sign-out" && state.mode === "buyer") { void run(async () => { await provider().signOut(); reset(); }); return; }
    if (action === "password" && state.mode === "buyer") { void run(async () => { await provider().changePassword(); }); return; }
    if (action === "catalog") { state.tab = "catalog"; draw(); return; }
    if (action === "new-buyer" && mayEditBuyers()) { state.editor = { name: "", email: "", phone: "", priceType: "installer", isActive: true }; draw(); return; }
    if (action === "edit-buyer" && mayEditBuyers()) { const buyer = state.buyers.find((entry) => entry.id === id); if (buyer) state.editor = { ...buyer }; draw(); return; }
    if (action === "close-editor") { state.editor = null; draw(); return; }
    if (action === "link-purchase" && mayLinkPurchases() && !state.linkEditor?.pending) {
      if (!state.buyers.some((buyer) => buyer.id === id)) return;
      state.linkEditor = { buyerId: id, documentId: "", documentsLoaded: false, pending: null };
      state.tab = "buyers";
      void run(loadUnlinkedSales);
      return;
    }
    if (action === "refresh-link-sales" && mayLinkPurchases() && state.linkEditor && !state.linkEditor.pending) { void run(loadUnlinkedSales); return; }
    if (action === "close-link" && !state.linkEditor?.pending) { state.linkEditor = null; draw(); return; }
    if (state.mode === "buyer" && !state.pendingSubmit && ["add", "remove", "clear-cart"].includes(action)) {
      state.error = "";
      state.notice = "";
      if (action === "clear-cart") { state.cart.clear(); state.priceReview = false; }
      if (action === "remove") state.cart.delete(id);
      if (action === "add") {
        const item = state.items.find((entry) => entry.id === id);
        const first = cartLines()[0]?.item;
        if (!item || !exactPrice(item) || !validCurrency(item)) state.error = "Для товару не встановлено ціну. Зверніться до менеджера.";
        else if (first && first.currency !== item.currency) state.error = "В одному замовленні може бути лише одна валюта. Надішліть поточний кошик окремо.";
        else {
          const qty = Math.round((Number(state.cart.get(id) || 0) + (whole(item) || available(item) >= 1 ? 1 : 0.001)) * 1000) / 1000;
          const issue = quantityError(item, qty);
          if (issue) state.error = issue;
          else { state.cart.set(id, qty); state.notice = "Товар додано до кошика."; }
        }
      }
      draw();
      return;
    }
    if (action === "review-prices" && state.mode === "buyer" && !state.pendingSubmit) { state.priceReview = false; state.error = ""; draw(); return; }
    if (action === "repeat") void run((token) => repeatOrder(id, token));
    if (action === "buyer-cancel") void run((token) => changeOrder(id, "cancel", token, true));
    if (action === "order-action") void run((token) => changeOrder(id, element.dataset.bpOrderAction, token));
    if (action === "send-access") void run((token) => sendAccess(id, token));
  }
  function onChange(event) {
    const element = event.target;
    if (state.busy) return;
    if (element.dataset.bpField === "account" && state.mode === "buyer" && !state.pendingSubmit) {
      const id = String(element.value);
      if (!activeAccounts(state.context).some((account) => String(account.id) === id)) return;
      void run(async (token) => {
        if (provider().selectAccount) await provider().selectAccount(id);
        if (!same(token)) return;
        const { context, key, mode } = state;
        state = fresh(); Object.assign(state, { context, key, mode, buyerId: id });
        await enter("buyer", target);
      });
      return;
    }
    if (element.dataset.bpField && ["category", "availableOnly", "orderFilter"].includes(element.dataset.bpField)) { state[element.dataset.bpField] = element.type === "checkbox" ? element.checked : element.value; draw(); }
    if (element.dataset.bpQty && !state.pendingSubmit && state.cart.has(element.dataset.bpQty)) { state.cart.set(element.dataset.bpQty, element.value); state.error = ""; draw(); }
    if (element.dataset.bpDelivery && !state.pendingSubmit) { state.delivery[element.dataset.bpDelivery] = element.value; if (element.dataset.bpDelivery === "method") draw(); }
    if (element.dataset.bpEditor && state.editor && mayEditBuyers()) state.editor[element.dataset.bpEditor] = element.type === "checkbox" ? element.checked : element.value;
    if (element.dataset.bpLink && ["buyerId", "documentId"].includes(element.dataset.bpLink) && mayLinkPurchases() && state.linkEditor && !state.linkEditor.pending) { state.linkEditor[element.dataset.bpLink] = String(element.value); draw(); }
  }
  function onInput(event) {
    const element = event.target;
    if (state.busy) return;
    if (element.dataset.bpField === "query") {
      state.query = element.value;
      const start = element.selectionStart;
      draw();
      const input = target?.querySelector('[data-bp-field="query"]');
      if (input) { input.focus(); if (start !== null && input.setSelectionRange) input.setSelectionRange(start, start); }
    }
    if (element.dataset.bpDelivery && !state.pendingSubmit) state.delivery[element.dataset.bpDelivery] = element.value;
    if (element.dataset.bpQty && !state.pendingSubmit && state.cart.has(element.dataset.bpQty)) state.cart.set(element.dataset.bpQty, element.value);
    if (element.dataset.bpEditor && state.editor && mayEditBuyers()) state.editor[element.dataset.bpEditor] = element.type === "checkbox" ? element.checked : element.value;
  }
  function onSubmit(event) {
    const form = event.target.closest?.("[data-bp-form]");
    if (!form) return;
    event.preventDefault();
    if (form.dataset.bpForm === "checkout") void run(submit);
    if (form.dataset.bpForm === "buyer") void run(saveBuyer);
    if (form.dataset.bpForm === "link-purchase") void run(linkPurchase);
  }

  window.SpartaBuyerUI = { renderBuyer: (element) => enter("buyer", element), renderSales: (element) => enter("sales", element), refreshBuyer, reset };
})();
