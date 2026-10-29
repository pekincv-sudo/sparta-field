(function () {
  "use strict";
  const safe = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;");
  const number = value => Number(value || 0).toLocaleString("uk-UA", { maximumFractionDigits: 3 });
  const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  let session = null, library = null;
  function context(write = false) {
    if (window.SPARTA_LOCAL_WORKSPACE?.enabled) return { stamp: "local", scope: "local", actor: "" };
    if (typeof cloudState === "undefined" || !cloudState.ready || cloudState.sessionLoading || !cloudState.user?.id || !cloudState.companyId || cloudState.audience !== "staff" || document.body.classList.contains("auth-locked")) throw new Error("Увійдіть до компанії та оновіть склад.");
    if (write && !["owner", "admin", "warehouse"].includes(cloudState.memberRole)) throw new Error("Імпортувати зміни може власник, адміністратор або комірник.");
    return { stamp: JSON.stringify([cloudState.user.id, cloudState.companyId, cloudState.memberRole, typeof cloudContextRevision === "number" ? cloudContextRevision : 0]), scope: `company:${cloudState.companyId}`, actor: cloudState.user.id };
  }
  function current(value, write = false) {
    if (session !== value || context(write).stamp !== value.context.stamp) throw new Error("Обліковий запис змінився. Відкрийте обмін Excel заново.");
  }
  function reset() { const previous = session; session = null; previous?.element.remove(); }
  function loadLibrary() {
    if (window.XLSX) return Promise.resolve();
    if (!library) library = new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = "./vendor/xlsx.full.min.js?v=20261030-42";
      script.onload = () => { if (window.XLSX) resolve(); else { script.remove(); library = null; reject(new Error("Не вдалося підключити Excel.")); } };
      script.onerror = () => { script.remove(); library = null; reject(new Error("Не вдалося завантажити модуль Excel. Перевірте інтернет і спробуйте ще раз.")); };
      document.head.append(script);
    });
    return library;
  }
  async function state(value) {
    current(value, value.mode === "import");
    if (!window.SPARTA_LOCAL_WORKSPACE?.enabled) await window.SpartaWarehouseCloud.load();
    current(value, value.mode === "import");
    const result = window.SpartaWarehouseUI.snapshot();
    if (!result || !Array.isArray(result.items)) throw new Error("Склад не завантажено.");
    return result;
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  }
  async function digest(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(canonical(payload)));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  function download(bytes, name, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const link = document.createElement("a"); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function plan(value, snapshot) {
    return window.SpartaWarehouseExcelCore.prepare(value.parsed.manifest, value.parsed.rows, snapshot, { batchHash: value.hash, date: value.date, scope: value.context.scope, createdBy: value.context.actor, createdAt: value.createdAt });
  }
  function changesMarkup(result, row) {
    const entry = result.state.documents.flatMap(doc => doc.excelBatchHash === session.hash ? doc.roundtripChanges || [] : []).find(change => change.itemId === row.id);
    const labels = { sku: "Артикул", name: "Назва", category: "Категорія", brand: "Бренд", model: "Модель", location: "Зберігання", minQty: "Мінімальний залишок", retailPrice: "Роздрібна ціна", installerPrice: "Ціна монтажника", wholesalePrice: "Оптова ціна" };
    if (!entry) return "";
    return `${row.action === "new" ? "Новий товар" : ""}${row.changedFields.filter(field => field !== "qty").map(field => `<small class="wh-excel-change">${safe(labels[field] || field)}: ${entry.before ? safe(entry.before[field]) : "—"} → ${safe(entry.after[field])}</small>`).join("")}`;
  }
  function render(value) {
    if (session !== value) return;
    const result = value.preview, summary = result?.summary;
    const changed = summary ? summary.rows.filter(row => row.action !== "unchanged") : [];
    const done = value.success || result?.alreadyApplied;
    value.element.innerHTML = `<div class="wh-editor wh-excel-editor"><header class="wh-editor-head"><div><p class="eyebrow">Склад · Excel</p><h2>${value.mode === "export" ? "Експорт залишків" : "Завантажити зміни з Excel"}</h2></div><button type="button" class="wh-close" data-wh-excel="close" aria-label="Закрити обмін Excel" ${value.busy ? "disabled" : ""}>×</button></header><div class="wh-editor-body">
      <p>Кількість у файлі — кінцевий залишок на складі. Резерви, закупівельна собівартість і каса зберігаються окремо.</p>
      ${value.mode === "import" && !done ? `<label class="wh-excel-file">Файл, експортований зі SPARTA<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-wh-excel-file ${value.busy || value.pending ? "disabled" : ""}></label><p class="wh-muted">Збережіть зміни як .xlsx. ID, валюту та одиницю існуючих товарів не змінюйте. Видалені рядки не видаляють товарів із бази. Новий товар — новий рядок із порожнім ID.</p>` : ""}
      ${value.busy ? `<p role="status">${safe(value.busy)}</p>` : ""}
      ${value.error ? `<p class="wh-notice" role="alert">${safe(value.error)}</p>` : ""}
      ${value.fileName ? `<p><strong>${safe(value.fileName)}</strong></p>` : ""}
      ${summary ? `<p role="status">${done ? "Зміни вже збережено." : "Перевірте зміни перед застосуванням."} Оновлених товарів: <b>${summary.updatedItems}</b>; нових: <b>${summary.newItems}</b>; без змін: ${summary.unchangedItems}.</p>${summary.deletedRowsIgnored ? `<p class="wh-muted">Пропущених рядків: ${summary.deletedRowsIgnored}. Ці товари залишаються в базі.</p>` : ""}${changed.length ? `<div class="wh-table-wrap"><table class="wh-table"><thead><tr><th>Товар</th><th>Було</th><th>Стане</th><th>Зміни</th></tr></thead><tbody>${changed.map(row => `<tr><td>${safe(row.name)}<small class="wh-muted">${safe(row.currency)}</small></td><td>${number(row.beforeQty)}</td><td>${number(row.qty)}</td><td>${changesMarkup(result, row)}</td></tr>`).join("")}</tbody></table></div>` : ""}` : ""}
      ${value.mode === "export" && value.success ? `<p role="status">Excel завантажено. Відредагуйте аркуш «Залишки», збережіть .xlsx та виберіть «Завантажити Excel» у складі.</p>` : ""}
      </div><footer class="wh-editor-footer"><button type="button" class="wh-secondary" data-wh-excel="close" ${value.busy ? "disabled" : ""}>Закрити</button>${value.mode === "import" && !done && changed.length ? `<button type="button" class="wh-primary" data-wh-excel="apply" ${value.busy ? "disabled" : ""}>${value.pending ? "Перевірити та завершити" : "Застосувати зміни"}</button>` : ""}</footer></div>`;
  }
  async function open(mode) {
    const ctx = context(mode === "import"); reset();
    const element = document.createElement("dialog"); element.className = "wh-dialog"; element.id = "whExcelDialog";
    const value = { element, context: ctx, mode, date: today(), createdAt: new Date().toISOString(), busy: mode === "export" ? "Готуємо файл…" : "", error: "", preview: null, success: false, pending: false };
    session = value;
    element.addEventListener("cancel", event => { event.preventDefault(); if (!value.busy) reset(); });
    document.body.append(element); render(value); element.showModal();
    if (mode !== "export") return;
    try {
      await loadLibrary(); current(value);
      const snapshot = await state(value);
      const manifest = window.SpartaWarehouseExcelCore.snapshot(snapshot, { exportId: crypto.randomUUID(), exportedAt: new Date().toISOString(), scope: ctx.scope });
      const bytes = window.SpartaWarehouseExcelFile.create(window.XLSX).write(manifest, snapshot);
      current(value); download(bytes, `SPARTA-залишки-${today()}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); value.success = true;
    } catch (error) { if (session === value) value.error = error.message; }
    finally { if (session === value) { value.busy = ""; render(value); } }
  }
  async function readFile(file) {
    const value = session; if (!value || value.busy || value.pending || !file) return;
    value.preview = null; value.parsed = null; value.error = ""; value.busy = "Читаємо Excel та перевіряємо зміни…"; render(value);
    try {
      current(value, true);
      if (!/\.xlsx$/i.test(file.name) || !file.size || file.size > 5 * 1024 * 1024) throw new Error("Виберіть файл .xlsx розміром до 5 МБ.");
      await loadLibrary(); current(value, true);
      const buffer = await file.arrayBuffer(); current(value, true);
      value.parsed = window.SpartaWarehouseExcelFile.create(window.XLSX).read(buffer);
      value.hash = await digest(value.parsed); current(value, true);
      value.preview = plan(value, await state(value)); current(value, true); value.fileName = file.name;
    } catch (error) { if (session === value) { value.preview = null; value.error = error.message; } }
    finally { if (session === value) { value.busy = ""; render(value); } }
  }
  async function apply() {
    const value = session; if (!value || value.busy || !value.preview || value.success) return;
    value.busy = "Зберігаємо зміни складу…"; value.error = ""; render(value);
    let attempted = false;
    try {
      current(value, true);
      await window.SpartaWarehouseUI.transact(snapshot => {
        current(value, true);
        const next = plan(value, snapshot);
        value.preview = next;
        if (next.alreadyApplied) throw Object.assign(new Error("Зміни вже збережено."), { alreadyApplied: true });
        const size = new TextEncoder().encode(JSON.stringify({ items: next.state.items, documents: next.state.documents, movements: next.state.movements, reservations: next.state.reservations })).length;
        if (size > 8500000) throw new Error("Складський пакет завеликий. Зменште кількість змін у файлі.");
        attempted = true;
        return next.state;
      });
      current(value, true); value.success = true; value.pending = false;
    } catch (error) {
      if (session !== value) return;
      try { current(value, true); } catch (_) { reset(); return; }
      value.pending = attempted && !error.code;
      try { const checked = plan(value, await state(value)); if (checked.alreadyApplied || error.alreadyApplied) { value.preview = checked; value.success = true; value.pending = false; } else value.error = error.message; }
      catch (_) { value.error = error.message; }
    } finally {
      if (session === value) { value.busy = ""; render(value); if (value.success) { window.SpartaWarehouseUI.render(); if (typeof renderHome === "function") renderHome(); } }
    }
  }
  document.addEventListener("click", event => {
    const button = event.target.closest?.("[data-wh-excel]"); if (!button || button.disabled) return;
    const action = button.dataset.whExcel;
    if (action === "close") { if (!session?.busy) reset(); return; }
    if (action === "apply") { void apply(); return; }
    if (["export", "import"].includes(action)) void open(action).catch(error => { if (typeof alert === "function") alert(error.message); });
  });
  document.addEventListener("change", event => { if (event.target.matches?.("[data-wh-excel-file]")) void readFile(event.target.files?.[0]); });
  window.SpartaWarehouseExcelUI = Object.freeze({ open, reset });
})();
