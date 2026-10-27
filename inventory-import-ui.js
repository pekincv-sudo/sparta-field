(function () {
  "use strict";

  let element = null;
  let session = null;
  let epoch = 0;
  const safe = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;");
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const number = (value) => Number(value || 0).toLocaleString("uk-UA", { maximumFractionDigits: 3 });
  const money = (value, currency) => value == null ? "Не вказано" : `${Number(value).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === "USD" ? "USD" : "грн"}`;
  const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const failure = (message, code) => Object.assign(new Error(message), { code });

  function context() {
    if (window.SPARTA_LOCAL_WORKSPACE?.enabled) throw failure("Імпорт доступний у підключеному хмарному складі компанії. У локальному режимі імпорт не проводиться.", "IMPORT_ACCESS");
    if (typeof cloudState === "undefined" || !cloudState.ready || !cloudState.client || !cloudState.user?.id || !cloudState.companyId) throw failure("Спочатку увійдіть у компанію та завантажте хмарний склад.", "IMPORT_ACCESS");
    if (cloudState.audience === "buyer" || !["owner", "admin", "warehouse"].includes(cloudState.memberRole)) throw failure("Імпортувати обладнання може власник, адміністратор або працівник складу компанії.", "IMPORT_ACCESS");
    if (!window.SpartaWarehouseCloud?.load || !window.SpartaWarehouseCloud?.snapshot || !window.SpartaWarehouseCloud?.transact || !window.SpartaInventoryImport?.parseCsv || !window.SpartaInventoryImport?.plan) throw failure("Модуль імпорту ще не завантажено. Оновіть сторінку.", "IMPORT_ACCESS");
    return { actorName: String(cloudState.user.user_metadata?.full_name || cloudState.user.email || "Працівник компанії"), client: cloudState.client, userId: String(cloudState.user.id), companyId: String(cloudState.companyId), revision: typeof cloudContextRevision === "number" ? cloudContextRevision : 0 };
  }

  function reset() {
    epoch += 1;
    const old = element;
    const previous = session;
    session = null;
    element = null;
    for (const url of previous?.urls || []) URL.revokeObjectURL(url);
    if (old) { if (old.open) old.close(); old.innerHTML = ""; old.remove(); }
  }

  function current(value) {
    if (session !== value || value.epoch !== epoch) throw failure("Обліковий запис змінився. Відкрийте імпорт ще раз.", "IMPORT_CONTEXT");
    let next;
    try { next = context(); }
    catch (error) { reset(); throw error; }
    const original = value.context;
    if (next.client !== original.client || next.userId !== original.userId || next.companyId !== original.companyId || next.revision !== original.revision) {
      reset();
      throw failure("Обліковий запис змінився. Відкрийте імпорт ще раз.", "IMPORT_CONTEXT");
    }
    return next;
  }

  function close() {
    if (!session || session.busy) return;
    current(session);
    // Keep an unresolved manifest available when this dialog is reopened.
    element.close();
  }

  function dialog() {
    if (element) return element;
    element = document.createElement("dialog");
    element.id = "whImportDialog";
    element.className = "wh-dialog";
    element.setAttribute("aria-labelledby", "whImportTitle");
    element.addEventListener("cancel", (event) => { event.preventDefault(); try { close(); } catch (_) { /* reset already cleared private data */ } });
    element.addEventListener("click", (event) => {
      const button = event.target.closest("[data-wh-import-action]");
      if (!button || !element?.contains(button)) return;
      const action = button.dataset.whImportAction;
      if (action === "close") { try { close(); } catch (_) { /* context was cleared */ } }
      if (action === "backup") void downloadBackup();
    });
    element.addEventListener("change", (event) => {
      if (event.target.id === "whImportFile") void selectFile(event.target.files?.[0]);
      if (event.target.id === "whImportBackupAck" && session) {
        try { current(session); session.backupAcknowledged = Boolean(session.backup && event.target.checked); render(); } catch (_) { /* context was cleared */ }
      }
    });
    element.addEventListener("submit", (event) => { event.preventDefault(); void commit(); });
    document.body.append(element);
    return element;
  }

  function preview(value, state) {
    current(value);
    const result = window.SpartaInventoryImport.plan(state, value.manifest, { date: value.date });
    value.preview = { summary: copy(result.summary), alreadyImported: Boolean(result.alreadyImported), revision: state.revision };
    return result;
  }

  async function load(value) {
    current(value);
    const state = await window.SpartaWarehouseCloud.load();
    current(value);
    if (!state || !Array.isArray(state.items) || !Number.isSafeInteger(state.revision)) throw failure("Не вдалося отримати актуальний склад. Оновіть дані та повторіть спробу.", "IMPORT_READ");
    return state;
  }

  function summaryHtml(value) {
    const summary = value.preview?.summary;
    if (!summary) return "";
    const currencies = [...new Set(value.manifest.items.map((item) => item.currency))].join(" / ");
    const missingSourceCost = value.manifest.items.filter((item) => item.purchasePrice == null).length;
    const missingSalePrice = value.manifest.items.filter((item) => [item.retailPrice, item.installerPrice, item.wholesalePrice].every((price) => price == null)).length;
    return `<div class="wh-metrics"><div class="wh-metric"><span>Рядків у файлі</span><strong class="wh-metric-value">${number(summary.rowsRead)}</strong><small>${number(summary.uniqueItems)} унікальних позицій</small></div><div class="wh-metric"><span>Нові товари</span><strong class="wh-metric-value">${number(summary.newItems)}</strong></div><div class="wh-metric"><span>Уже є в каталозі</span><strong class="wh-metric-value">${number(summary.existingItems)}</strong></div></div><p class="wh-help">Валюта: <strong>${safe(currencies)}</strong>. До кожного рядка файлу буде додано <strong>100 одиниць</strong>. Одиниці виміру збережені з файлу. ${summary.duplicatesMerged ? `Об’єднано повторів: ${number(summary.duplicatesMerged)}.` : ""} Ціни та собівартість наявних товарів зберігаються.</p><p class="wh-notice ${summary.valuationIncomplete || missingSourceCost || missingSalePrice ? "warn" : ""}">Без закупівельної ціни у файлі: ${number(missingSourceCost)}. Без цін продажу: ${number(missingSalePrice)}. Нових товарів із невідомою собівартістю: ${number(summary.unknownCostNewItems)}.${summary.valuationIncomplete ? " Вартість залишків буде неповною до внесення собівартості; невідомі ціни позначено в документах." : ""}</p><details class="wh-help" style="margin:16px 24px"><summary>Перевірити всі позиції (${number(summary.uniqueItems)})</summary><div class="wh-table-wrap"><table class="wh-table"><thead><tr><th>Обладнання / артикул</th><th>Дія</th><th class="wh-num">Додати</th><th class="wh-num">Було → стане</th><th class="wh-num">Закупівельна ціна файлу</th></tr></thead><tbody>${(summary.rows || []).map((row) => `<tr><td><strong>${safe(row.name)}</strong><br><small>${safe(row.sku || "Без артикулу")}${row.sourceRow ? ` · рядок ${safe(row.sourceRow)}` : ""}</small></td><td>${row.action === "new" ? "Новий товар" : "Наявний товар"}${row.purchasePriceKnown === false ? `<br><span class="wh-badge warn">Собівартість не вказано</span>` : ""}</td><td class="wh-num">+${number(row.qty)} ${safe(row.unit)}</td><td class="wh-num">${number(row.beforeQty)} → ${number(row.afterQty)}</td><td class="wh-num">${safe(money(row.sourcePurchasePrice, row.currency))}</td></tr>`).join("")}</tbody></table></div></details>`;
  }

  function render() {
    const value = session;
    if (!value || !element) return;
    try { current(value); } catch (_) { return; }
    const already = value.preview?.alreadyImported;
    const ready = value.manifest && value.preview && !already && !value.success && value.backup && value.backupAcknowledged;
    element.innerHTML = `<form id="whImportForm"><header class="wh-dialog-head"><div><p class="eyebrow">Каталог обладнання · початкові залишки</p><h2 id="whImportTitle">Імпорт обладнання</h2></div><button type="button" class="wh-row-action" data-wh-import-action="close" aria-label="Закрити" ${value.busy ? "disabled" : ""}>×</button></header><div class="wh-dialog-body"><div class="wh-form-grid"><label style="grid-column:1/-1">Підготовлений CSV із відібраним обладнанням<input id="whImportFile" type="file" accept=".csv,text/csv" ${value.busy || value.pending ? "disabled" : ""}></label></div><p class="wh-help">Завантажте підготовлений CSV. Імпорт додає фізичне обладнання по 100 одиниць у валюті кожного рядка (UAH або USD). Файл Excel спочатку має бути перевірений і перетворений у CSV.</p>${value.manifest ? `<p class="wh-help" style="overflow-wrap:anywhere"><strong>Файл:</strong> ${safe(value.manifest.sourceName)}</p>` : ""}${summaryHtml(value)}${already && !value.success ? `<p class="wh-notice success" role="status">Цей файл уже додано до складу. Повторне завантаження не змінює залишки.</p>` : ""}${value.manifest && value.preview && !already && !value.success ? `<section class="wh-help"><h3>Резервна копія перед імпортом</h3><p>Збережіть актуальні дані складу у файл на цьому пристрої.</p><button type="button" class="wh-secondary" data-wh-import-action="backup" ${value.busy || value.pending ? "disabled" : ""}>Завантажити резервну копію складу</button>${value.backup ? `<p>Підготовлено файл: <strong>${safe(value.backup.fileName)}</strong></p><label style="display:flex;align-items:center;gap:9px"><input id="whImportBackupAck" type="checkbox" ${value.backupAcknowledged ? "checked" : ""} ${value.busy ? "disabled" : ""}>Резервну копію збережено на цьому пристрої</label>` : ""}</section>` : ""}${value.pending ? `<p class="wh-notice warn" role="status">Сервер ще не підтвердив результат. Збережено той самий файл і пакет імпорту. Натисніть «Перевірити та завершити», щоб безпечно перевірити попередню операцію.</p>` : ""}${value.busy ? `<p class="wh-notice" role="status">${safe(value.busy)}</p>` : ""}${value.error ? `<p class="wh-notice error" role="alert">${safe(value.error)}</p>` : ""}${value.success ? `<p class="wh-notice success" role="status">${safe(value.message)}</p>` : ""}</div><footer class="wh-form-footer"><span class="wh-muted" style="overflow-wrap:anywhere">Перевірте перелік перед додаванням</span><div class="wh-actions"><button type="button" class="wh-secondary" data-wh-import-action="close" ${value.busy ? "disabled" : ""}>${value.success || already ? "Закрити" : "Скасувати"}</button>${!value.success && !already ? `<button type="submit" class="wh-primary" ${!ready || value.busy ? "disabled" : ""}>${value.pending ? "Перевірити та завершити" : "Додати до складу"}</button>` : ""}</div></footer></form>`;
  }

  async function open() {
    const ctx = context();
    if (session) {
      try { current(session); } catch (_) { /* make a fresh identity-bound session below */ }
    }
    if (!session) session = { epoch, context: ctx, date: today(), manifest: null, preview: null, backup: null, backupAcknowledged: false, busy: "", pending: false, success: false, error: "", urls: [] };
    const target = dialog();
    render();
    if (!target.open) target.showModal();
  }

  async function selectFile(file) {
    const value = session;
    if (!value || value.busy || value.pending) return;
    try {
      current(value);
      value.manifest = null; value.preview = null; value.backup = null; value.backupAcknowledged = false; value.success = false; value.error = "";
      if (!file) { render(); return; }
      if (!/\.csv$/i.test(file.name || "") || !(file.size > 0) || file.size > 5 * 1024 * 1024) throw failure("Оберіть непорожній CSV-файл розміром до 5 МБ.", "IMPORT_FILE");
      value.busy = "Перевіряємо файл та актуальні дані складу…"; render();
      const bytes = await file.arrayBuffer();
      current(value);
      const items = window.SpartaInventoryImport.parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!items.length || items.some((item) => !["UAH", "USD"].includes(item.currency) || item.qty !== 100)) throw failure("Для цього імпорту кожна позиція має містити рівно 100 одиниць у явно вказаній валюті UAH або USD.", "IMPORT_SCOPE");
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      current(value);
      const sourceHash = Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
      value.manifest = { sourceName: file.name, sourceHash, items: copy(items) };
      value.date = today();
      preview(value, await load(value));
    } catch (error) {
      if (session !== value) return;
      value.error = error.message || "Не вдалося прочитати файл.";
      value.preview = null;
    } finally {
      if (session === value) { value.busy = ""; render(); }
    }
  }

  async function downloadBackup() {
    const value = session;
    if (!value || value.busy || value.pending || !value.manifest || value.success) return;
    try {
      current(value);
      value.busy = "Завантажуємо актуальний склад для резервної копії…"; value.error = ""; value.backup = null; value.backupAcknowledged = false; render();
      const state = await load(value);
      if (preview(value, state).alreadyImported) return;
      const fileName = `sparta-warehouse-before-import-${value.date}-r${state.revision}.json`;
      const blob = new Blob([JSON.stringify({ format: "sparta-warehouse-backup", version: 1, savedAt: new Date().toISOString(), companyId: value.context.companyId, revision: state.revision, warehouse: copy(state) }, null, 2)], { type: "application/json;charset=utf-8" });
      current(value);
      const url = URL.createObjectURL(blob);
      value.urls.push(url);
      const link = document.createElement("a"); link.href = url; link.download = fileName; link.hidden = true;
      document.body.append(link);
      try { link.click(); } finally { link.remove(); }
      value.backup = { revision: state.revision, fileName };
      setTimeout(() => { URL.revokeObjectURL(url); const index = value.urls.indexOf(url); if (index >= 0) value.urls.splice(index, 1); }, 60000);
    } catch (error) {
      if (session !== value) return;
      value.error = error.message || "Не вдалося створити резервну копію.";
    } finally {
      if (session === value) { value.busy = ""; render(); }
    }
  }

  function succeeded(value, summary, recovered) {
    current(value);
    value.pending = false; value.success = true; value.error = "";
    value.message = `${recovered ? "Сервер підтвердив імпорт." : "Обладнання додано до складу."} Нових товарів: ${number(summary.newItems)}, наявних: ${number(summary.existingItems)}, позицій по 100 одиниць: ${number(summary.uniqueItems)}.${summary.valuationIncomplete ? " Увага: собівартість частини залишків ще не вказана." : ""}`;
    window.SpartaWarehouseUI?.render(document.querySelector("#warehouseView"));
  }

  async function commit() {
    const value = session;
    if (!value || value.busy || value.success || !value.manifest || !value.preview || !value.backup || !value.backupAcknowledged || value.preview.alreadyImported) return;
    let callbackCompleted = false;
    let summary = null;
    const wasPending = value.pending;
    try {
      current(value);
      value.busy = wasPending ? "Перевіряємо результат попереднього імпорту…" : "Додаємо обладнання до складу…"; value.error = ""; render();
      await window.SpartaWarehouseCloud.transact((state) => {
        current(value);
        const result = preview(value, state);
        summary = result.summary;
        if (result.alreadyImported) throw failure("Цей файл уже додано до складу.", "ALREADY_IMPORTED");
        if (state.revision !== value.backup.revision) throw failure("Склад змінився після створення резервної копії. Перевірте оновлений перелік і збережіть нову копію перед імпортом.", "IMPORT_BACKUP_STALE");
        current(value);
        for (const document of result.state.documents) if (result.summary.documentIds.includes(document.id)) document.createdByName = current(value).actorName;
        callbackCompleted = true;
        return result.state;
      });
      current(value);
      succeeded(value, summary || value.preview.summary, false);
    } catch (error) {
      if (session !== value) return;
      try { current(value); } catch (_) { return; }
      if (error.code === "ALREADY_IMPORTED") { succeeded(value, summary || value.preview.summary, true); return; }
      // A response may be lost after commit. Cloud.transact owns the original
      // request; the next attempt settles it before allowing another callback.
      value.pending = wasPending || Boolean(callbackCompleted && !error.code);
      if (error.code === "IMPORT_BACKUP_STALE" || error.code === "40001") { value.backup = null; value.backupAcknowledged = false; value.pending = false; }
      try {
        const result = preview(value, await load(value));
        if (result.alreadyImported) { succeeded(value, result.summary, true); return; }
      } catch (_) { if (session !== value) return; }
      value.error = error.message || "Не вдалося підтвердити імпорт. Перевірте підключення і повторіть спробу.";
    } finally {
      if (session === value) { value.busy = ""; render(); }
    }
  }

  window.SpartaInventoryImportUI = Object.freeze({ open, reset });
})();
