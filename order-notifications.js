(function () {
  "use strict";

  const roles = ["owner", "admin", "engineer", "warehouse"];
  const pollMs = 30000;
  let identity = "", context = null, epoch = 0, pollTimer = null, toastTimer = null;
  let task = null, refreshAfterTask = false, initialized = false, acknowledgeNext = false;
  let pending = [], knownIds = new Set(), acknowledged = new Set(), error = "", storageError = "";
  let slot = null, noticeButton = null, noticeLabel = null, noticeCount = null, toast = null, toastText = null;

  function readContext() {
    try {
      const provider = window.SpartaBuyerCloud;
      const value = provider?.getContext?.();
      if (!value || value.local || !value.ready || value.audience !== "staff" || !roles.includes(value.role) ||
          !value.userId || !value.companyId || typeof provider.salesOrders !== "function" ||
          (typeof portalMode !== "undefined" && portalMode === "client")) return null;
      return { userId: String(value.userId), companyId: String(value.companyId), role: value.role,
        identity: `${value.companyId}:${value.userId}:${value.role}` };
    } catch (_) { return null; }
  }

  const storageKey = (value) => `solarObjectManager.orderNotices.v1.${encodeURIComponent(value.companyId)}.${encodeURIComponent(value.userId)}`;
  function loadAcknowledged(value) {
    storageError = "";
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey(value)) || "null");
      return new Set(Array.isArray(saved?.ids) ? saved.ids.filter((id) => typeof id === "string" && id.length <= 200).slice(-5000) : []);
    } catch (_) { storageError = "Переглянуті повідомлення зберігаються лише в цьому сеансі."; return new Set(); }
  }
  function saveAcknowledged() {
    if (!context) return;
    try { window.localStorage.setItem(storageKey(context), JSON.stringify({ version: 1, ids: [...acknowledged].slice(-5000) })); storageError = ""; }
    catch (_) { storageError = "Переглянуті повідомлення зберігаються лише в цьому сеансі."; }
  }
  function current(version = epoch, key = identity) {
    const value = readContext();
    return Boolean(value && value.identity === key && identity === key && version === epoch);
  }
  function count() { return pending.filter((order) => !acknowledged.has(order.id)).length; }
  function hideToast() {
    if (toastTimer != null) window.clearTimeout(toastTimer);
    toastTimer = null;
    if (toast) toast.hidden = true;
  }
  function button(label, className, onClick) {
    const element = document.createElement("button");
    element.type = "button"; element.className = className; element.textContent = label;
    element.addEventListener("click", onClick);
    return element;
  }
  function openSales() {
    if (!current()) { refreshAccess(); return; }
    // A click requests the list, but is not proof that the list loaded.
    // The sales view acknowledges the submitted IDs only after a successful draw.
    hideToast();
    if (typeof showSection === "function") showSection("sales", { orderFilter: "submitted" });
    else window.dispatchEvent(new CustomEvent("sparta:open-sales", { detail: { orderFilter: "submitted" } }));
  }
  function ensureElements() {
    let nextSlot = document.querySelector("#orderNotificationSlot");
    if (!nextSlot) {
      const actions = document.querySelector(".topbar-actions");
      if (actions) { nextSlot = document.createElement("div"); nextSlot.id = "orderNotificationSlot"; actions.append(nextSlot); }
    }
    if (nextSlot && (slot !== nextSlot || !noticeButton?.parentNode)) {
      slot = nextSlot; slot.classList.add("sp-order-notice-slot");
      noticeButton = button("", "sp-order-notice", openSales);
      const icon = document.createElement("span"); icon.className = "sp-order-notice-icon"; icon.textContent = "🔔"; icon.setAttribute("aria-hidden", "true");
      // The visible label and count stay useful without an icon font or a push-permission prompt.
      noticeLabel = document.createElement("span"); noticeLabel.className = "sp-order-notice-label"; noticeLabel.textContent = "Замовлення";
      noticeCount = document.createElement("span"); noticeCount.className = "sp-order-notice-count"; noticeCount.setAttribute("aria-hidden", "true");
      noticeButton.append(icon, noticeLabel, noticeCount); noticeButton.hidden = true; slot.append(noticeButton);
    }
    if (!toast?.parentNode && document.body) {
      toast = document.createElement("div"); toast.className = "sp-order-toast"; toast.hidden = true;
      toast.setAttribute("role", "status"); toast.setAttribute("aria-live", "polite"); toast.setAttribute("aria-atomic", "true");
      toastText = document.createElement("span"); toastText.className = "sp-order-toast-text";
      const actions = document.createElement("div"); actions.className = "sp-order-toast-actions";
      actions.append(button("Переглянути", "sp-order-toast-open", openSales), button("Закрити", "sp-order-toast-close", hideToast));
      toast.append(toastText, actions); document.body.append(toast);
    }
  }
  function render() {
    ensureElements();
    const active = current(), unseen = active ? count() : 0, failed = active && Boolean(error);
    if (noticeButton) {
      noticeButton.hidden = unseen === 0 && !failed;
      noticeCount.textContent = failed && unseen === 0 ? "!" : unseen > 99 ? "99+" : String(unseen);
      noticeLabel.textContent = failed ? "Замовлення · немає зв’язку" : "Замовлення";
      noticeButton.setAttribute("data-status", failed ? "stale" : "ready");
      noticeButton.setAttribute("aria-label", failed
        ? `Не вдалося перевірити нові замовлення. За останніми даними непрочитаних: ${unseen}. Відкрити продажі`
        : `Нових замовлень: ${unseen}. Відкрити продажі`);
      noticeButton.title = error ? "Не вдалося оновити замовлення. Показано останні отримані дані." : `Очікують підтвердження: ${pending.length}`;
    }
    const navigation = document.querySelector('.nav-item[data-section="sales"]');
    let badge = navigation?.querySelector(".sp-order-nav-badge");
    if (navigation && !badge) { badge = document.createElement("span"); badge.className = "sp-order-nav-badge"; navigation.append(badge); }
    if (badge) {
      badge.hidden = unseen === 0; badge.textContent = unseen > 99 ? "99+" : String(unseen);
      badge.setAttribute("aria-label", `Нових замовлень: ${unseen}`);
    }
    if (!active) hideToast();
  }
  function showToast(orders) {
    ensureElements();
    if (!toast || !current() || !orders.length) return;
    hideToast();
    toastText.textContent = orders.length === 1
      ? `Нове замовлення${orders[0].number ? ` ${orders[0].number}` : ""}. Очікує підтвердження.`
      : `Прийшло ${orders.length} нових замовлень. Очікують підтвердження.`;
    toast.hidden = false;
    toastTimer = window.setTimeout(hideToast, 12000);
  }
  function stop() {
    epoch++;
    if (pollTimer != null) window.clearInterval(pollTimer);
    pollTimer = null; identity = ""; context = null; initialized = false; acknowledgeNext = false; refreshAfterTask = false;
    pending = []; knownIds = new Set(); acknowledged = new Set(); error = ""; storageError = "";
    hideToast(); if (toastText) toastText.textContent = ""; render();
  }
  function ensureContext() {
    const next = readContext();
    if (!next) { if (identity || pollTimer != null) stop(); else render(); return false; }
    if (next.identity !== identity) {
      epoch++; hideToast(); if (toastText) toastText.textContent = ""; context = next; identity = next.identity; initialized = false; acknowledgeNext = false;
      pending = []; knownIds = new Set(); acknowledged = loadAcknowledged(next); error = "";
      refreshAfterTask = Boolean(task);
    }
    if (pollTimer == null) pollTimer = window.setInterval(() => { if (!document.hidden) void refresh(); }, pollMs);
    render(); return true;
  }
  function refreshAccess() {
    const active = ensureContext();
    if (active && !initialized && !document.hidden) void refresh();
    return active;
  }
  function refresh() {
    if (!ensureContext()) return Promise.resolve(false);
    if (task) return task;
    const version = epoch, key = identity, companyId = context.companyId;
    let running;
    running = Promise.resolve().then(() => window.SpartaBuyerCloud.salesOrders()).then((result) => {
      if (!current(version, key)) return false;
      if (!Array.isArray(result?.orders)) throw new Error("Некоректна відповідь списку замовлень.");
      const byId = new Map();
      result.orders.forEach((value) => {
        if (!value || typeof value.id !== "string" || !value.id || value.id.length > 200 || value.companyId !== companyId) return;
        if (value.status === "submitted") byId.set(value.id, { id: value.id, number: String(value.number || "").slice(0, 100) });
      });
      const nextPending = [...byId.values()];
      const arriving = initialized ? nextPending.filter((order) => !knownIds.has(order.id) && !acknowledged.has(order.id)) : [];
      pending = nextPending;
      result.orders.forEach((value) => { if (value?.companyId === companyId && typeof value.id === "string") knownIds.add(value.id); });
      if (acknowledgeNext) { pending.forEach((order) => acknowledged.add(order.id)); saveAcknowledged(); acknowledgeNext = false; }
      initialized = true; error = ""; render();
      if (arriving.some((order) => !acknowledged.has(order.id))) showToast(arriving.filter((order) => !acknowledged.has(order.id)));
      return true;
    }).catch((failure) => {
      if (current(version, key)) {
        if (["42501", "AUTH_REQUIRED", "CONTEXT_CHANGED", "PGRST301"].includes(failure?.code)) stop();
        else { error = failure?.message || "Не вдалося оновити замовлення."; render(); }
      }
      return false;
    }).finally(() => {
      if (task === running) task = null;
      if (refreshAfterTask) { refreshAfterTask = false; if (readContext()) void refresh(); }
    });
    task = running; return running;
  }
  function acknowledge(orderIds) {
    if (!ensureContext()) return false;
    if (Array.isArray(orderIds)) {
      acknowledgeNext = false;
      orderIds.filter((id) => typeof id === "string" && id && id.length <= 200).forEach((id) => acknowledged.add(id));
    } else if (orderIds === undefined) {
      if (!initialized) acknowledgeNext = true;
      pending.forEach((order) => acknowledged.add(order.id));
    } else return false;
    saveAcknowledged(); hideToast(); render();
    return true;
  }
  function getState() {
    if (!current()) return { active: false, count: 0, pendingCount: 0, orderIds: [], error: "", storageError: "", initialized: false };
    return { active: true, count: count(), pendingCount: pending.length, orderIds: pending.filter((order) => !acknowledged.has(order.id)).map((order) => order.id), error, storageError, initialized };
  }
  window.addEventListener("focus", () => { if (!document.hidden && refreshAccess()) void refresh(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && refreshAccess()) void refresh(); });
  window.SpartaOrderNotifications = Object.freeze({ refreshAccess, start: refreshAccess, stop, reset: stop, refresh, acknowledge, getState });
})();
