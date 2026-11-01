(function () {
  "use strict";

  const core = window.SpartaInstallationCore;
  const warehouse = window.SpartaWarehouseCore;
  const drafts = new Map();
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const id = (value) => String(value == null ? "" : value);
  const safe = (value) => id(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;");
  const number = (value) => Number(value || 0).toLocaleString("uk-UA", { maximumFractionDigits: 3 });
  const failure = (message, code) => Object.assign(new Error(message), { code });
  const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  let epoch = 0;
  let running = null;

  function context() {
    const local = Boolean(window.SPARTA_LOCAL_WORKSPACE?.enabled);
    const cloud = typeof cloudState === "undefined" ? {} : cloudState;
    const role = local ? "owner" : cloud.memberRole || "";
    const staff = !cloud.sessionLoading && cloud.audience !== "buyer" && !window.SpartaBuyerCloud?.isBuyerReady?.()
      && !(typeof portalMode !== "undefined" && portalMode === "client");
    const ready = Boolean(staff && core && warehouse && ["owner", "admin", "warehouse", "engineer", "brigadier", "installer", "viewer"].includes(role)
      && (local ? !window.SPARTA_LOCAL_WORKSPACE.initError : cloud.ready && cloud.client && cloud.user?.id && cloud.companyId));
    const selected = typeof selectedProjectId === "undefined" ? "" : id(selectedProjectId);
    return { local, ready, role, selectedProjectId: selected, canWrite: ready && ["owner", "admin", "warehouse"].includes(role),
      canPlan: ready && ["owner", "admin"].includes(role), client: cloud.client || null,
      userId: local ? "local" : id(cloud.user?.id), actorName: local ? "Локальний користувач" : cloud.profile?.full_name || cloud.user?.email || id(cloud.user?.id),
      key: JSON.stringify([local ? "local" : "cloud", local ? window.SPARTA_LOCAL_WORKSPACE.companyId || "local-sparta" : cloud.companyId || "",
        local ? "local" : cloud.user?.id || "", role, selected, typeof cloudContextRevision === "number" ? cloudContextRevision : 0,
        typeof portalMode === "undefined" ? "" : portalMode, epoch]) };
  }
  function row(projectId) { return (typeof projects === "undefined" ? [] : projects).find((entry) => id(entry.id) === id(projectId)); }
  function capture(projectId, write = false) {
    const value = context();
    if (!value.ready || write && !value.canWrite) throw failure("Підтвердити монтаж може власник, адміністратор або працівник складу компанії.", "INSTALLATION_ACCESS");
    if (!row(projectId) || value.selectedProjectId !== id(projectId)) throw failure("Об’єкт змінився. Відкрийте монтаж ще раз.", "INSTALLATION_CONTEXT");
    return value;
  }
  function current(original, projectId, write = false) {
    const value = capture(projectId, write);
    if (value.key !== original.key || value.client !== original.client) throw failure("Обліковий запис, права або об’єкт змінилися. Відкрийте монтаж ще раз.", "INSTALLATION_CONTEXT");
    return value;
  }
  function provider(value) { return value.local ? window.SpartaWarehouseUI : window.SpartaWarehouseCloud; }
  function snapshot(value = context()) { return value.ready ? provider(value)?.snapshot?.() || null : null; }
  function materialStamp(project) { return JSON.stringify(canonical({ currency: project.currency || "UAH", materials: project.materials || [] })); }
  function equipmentRows(project, stock) {
    const grouped = new Map();
    for (const material of project.materials || []) {
      const itemId = id(material?.warehouseItemId);
      if (!itemId) continue;
      let value = grouped.get(itemId);
      if (!value) {
        const item = stock?.items?.find((entry) => id(entry.id) === itemId);
        value = { itemId, item, name: item?.name || material.name || "Невідома позиція", unit: item?.unit || material.unit || "шт", issuedQty: 0, actualQty: 0, availableQty: 0, error: "" };
        if (!item) value.error = "Товар не знайдено в номенклатурі складу.";
        else if ((item.currency || "UAH") !== (project.currency || "UAH")) value.error = "Валюта товару не збігається з об’єктом.";
        try { if (item) value.availableQty = warehouse.availableQty(item, stock.reservations || [], project.id, stock.orderReservations || []); }
        catch (_) { value.error = "Перевірте залишки й резерви товару."; }
        grouped.set(itemId, value);
      }
      const issued = Number(material.issuedQty || 0), actual = Number(material.actualQty || 0);
      if (!Number.isFinite(issued) || !Number.isFinite(actual) || issued < 0 || actual < 0 || actual > issued) value.error = "Перевірте історію виданого й змонтованого обладнання.";
      value.issuedQty = Math.round((value.issuedQty + (Number.isFinite(issued) ? issued : 0)) * 1000) / 1000;
      value.actualQty = Math.round((value.actualQty + (Number.isFinite(actual) ? actual : 0)) * 1000) / 1000;
    }
    return Array.from(grouped.values());
  }
  function draftFor(project, ctx, rows) {
    const projectId = id(project.id), stamp = materialStamp(project);
    let draft = drafts.get(projectId);
    if (!draft || draft.key !== ctx.key || draft.stamp !== stamp) {
      draft = { key: ctx.key, stamp, date: today(), confirmed: false, quantities: new Map(rows.map((entry) => [entry.itemId, String(entry.actualQty)])), notice: "", error: false };
      drafts.set(projectId, draft);
    }
    return draft;
  }
  function cleanMaterials(project, ctx) {
    if (ctx.local) return;
    const base = window.SpartaWarehouseCloud?.baseMaterials?.(project.id);
    if (!base) throw failure("Спочатку оновіть дані монтажу зі складу.", "INSTALLATION_BASE");
    if (!same(project.materials || [], base)) throw failure("У матеріалах є незбережені зміни. Спочатку збережіть або оновіть план матеріалів.", "INSTALLATION_CONFLICT");
  }
  function localProjects(projectId, expected) {
    const saved = typeof readJsonStorage === "function" ? readJsonStorage("solarObjectManager.projects", null) : null;
    if (!Array.isArray(saved)) throw failure("Збережіть об’єкт перед підтвердженням монтажу.", "INSTALLATION_STORAGE");
    const project = saved.find((entry) => id(entry.id) === id(projectId));
    if (!project || materialStamp(project) !== expected) throw failure("Матеріали об’єкта змінилися в іншій вкладці. Оновіть об’єкт і перевірте кількість.", "INSTALLATION_CONFLICT");
    return copy(saved);
  }
  function paint(original, projectId) {
    try { current(original, projectId); } catch (_) { return; }
    if (typeof renderDetail === "function") renderDetail();
    if (typeof applyProjectRoleControls === "function") applyProjectRoleControls();
  }
  function recordTable(document, stock) {
    return `<div class="installation-table-wrap"><table class="installation-table installation-record-table"><thead><tr><th>Фактично змонтоване обладнання</th><th>Кількість</th></tr></thead><tbody>${(document.finalLines || []).map((line) => `<tr><td>${safe(line.itemName || stock?.items?.find((item) => id(item.id) === id(line.itemId))?.name || line.itemId)}</td><td data-label="Змонтовано">${number(line.qty)} ${safe(line.unit || "шт")}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function markup(project) {
    const ctx = context();
    if (!project || !ctx.ready || ctx.selectedProjectId !== id(project.id)) return `<section class="installation-panel"><p class="installation-note">Для перегляду монтажу увійдіть у компанію та відкрийте потрібний об’єкт.</p></section>`;
    const stock = snapshot(ctx);
    let completed;
    try { completed = core.completion(stock, project.id); } catch (error) { return `<section class="installation-panel"><p class="installation-error" role="alert">${safe(error.message)}</p></section>`; }
    const refresh = `<button type="button" class="secondary-button" data-installation-action="refresh" data-installation-project="${safe(project.id)}" ${running ? "disabled" : ""}>Оновити дані</button>`;
    if (completed) return `<section class="installation-panel" data-installation-panel="${safe(project.id)}"><header class="installation-header"><div><h3>Монтаж виконано</h3><p class="installation-note">Дата виконання: <strong>${safe(completed.completedOn)}</strong></p></div>${refresh}</header>${recordTable(completed, stock)}<p class="installation-note">Підтвердив: ${safe(completed.createdByName || completed.actor?.name || completed.createdBy || "Користувач компанії")}. Документ ${safe(completed.number || completed.id)}. Обладнання враховане у складському журналі.</p></section>`;
    const rows = equipmentRows(project, stock);
    const draft = draftFor(project, ctx, rows);
    const unbound = (project.materials || []).filter((entry) => !id(entry?.warehouseItemId));
    const unresolved = unbound.some((entry) => Number(entry.issuedQty || 0) > 0 || Number(entry.actualQty || 0) > 0);
    const errors = rows.some((entry) => entry.error);
    const disabled = Boolean(running || !stock || errors || unresolved || !rows.length);
    const table = rows.length ? `<div class="installation-table-wrap"><table class="installation-table"><thead><tr><th>Обладнання</th><th>Видано на об’єкт</th><th>Вільно на складі</th><th>Фактично змонтовано</th></tr></thead><tbody>${rows.map((entry) => `<tr><td><strong>${safe(entry.name)}</strong>${entry.item?.sku ? `<small>${safe(entry.item.sku)}</small>` : ""}${entry.error ? `<small class="installation-error">${safe(entry.error)}</small>` : ""}</td><td data-label="Видано на об’єкт">${number(entry.issuedQty)} ${safe(entry.unit)}</td><td data-label="Вільно на складі">${number(entry.availableQty)} ${safe(entry.unit)}</td><td data-label="Фактично змонтовано">${ctx.canWrite ? `<label class="installation-qty-label"><span class="installation-sr-only">Фактично змонтовано: ${safe(entry.name)}</span><input type="number" inputmode="decimal" min="${entry.actualQty}" step="${/^(шт\.?|компл\.?|комплект|pcs?|set)$/i.test(entry.unit) ? "1" : "0.001"}" data-installation-qty="${safe(entry.itemId)}" data-installation-project="${safe(project.id)}" value="${safe(draft.quantities.get(entry.itemId) ?? entry.actualQty)}" ${disabled ? "disabled" : ""} /><span>${safe(entry.unit)}</span></label>` : `${number(entry.actualQty)} ${safe(entry.unit)}`}</td></tr>`).join("")}</tbody></table></div>` : `<p class="installation-note">Поки немає обладнання, прив’язаного до складу. Додайте позиції для фактичного монтажу.</p>`;
    return `<section class="installation-panel" data-installation-panel="${safe(project.id)}"><header class="installation-header"><div><h3>Фактичний монтаж</h3><p class="installation-note">Укажіть, що реально встановлено на об’єкті, та дату виконання.</p></div>${refresh}</header>${draft.notice ? `<p class="${draft.error ? "installation-error" : "installation-success"}" role="${draft.error ? "alert" : "status"}">${safe(draft.notice)}</p>` : ""}${!stock ? `<p class="installation-error" role="alert">Дані складу ще не завантажено. Натисніть «Оновити дані».</p>` : ""}${ctx.canPlan ? `<div class="installation-actions"><button type="button" class="secondary-button" data-project-stock-picker="materials" data-project-stock-id="${safe(project.id)}" ${running ? "disabled" : ""}>Додати обладнання зі складу</button></div>` : ""}${unbound.length ? `<p class="installation-note ${unresolved ? "installation-error" : ""}" ${unresolved ? 'role="alert"' : ""}>${unresolved ? "Є матеріали з рухом без прив’язки до складу. Спочатку перевірте їхню історію." : "Не прив’язані до складу: " + unbound.map((entry) => safe(entry.name || "Матеріал")).join(", ") + ". Ці позиції не списуються автоматично; оберіть фактично встановлене обладнання зі складу."}</p>` : ""}<form data-installation-form="${safe(project.id)}" novalidate>${table}${ctx.canWrite ? `<div class="installation-footer"><label class="installation-date-label">Дата виконання монтажу<input type="date" max="${today()}" value="${safe(draft.date)}" data-installation-date data-installation-project="${safe(project.id)}" ${disabled ? "disabled" : ""} /></label><label class="installation-confirm"><input type="checkbox" data-installation-confirm data-installation-project="${safe(project.id)}" ${draft.confirmed ? "checked" : ""} ${disabled ? "disabled" : ""} /><span>Підтверджую дату та фактично змонтовані кількості.</span></label><p class="installation-note">Раніше видане обладнання повторно зі складу не списується. Якщо встановлено більше, буде видано лише різницю з вільного залишку. Оплати й сума КП не змінюються.</p><button type="submit" class="primary-button installation-submit" ${disabled ? "disabled" : ""}>${running ? "Зберігаємо…" : "Монтаж виконано — підтвердити"}</button></div>` : `<p class="installation-note">Ви маєте доступ до перегляду. Остаточний монтаж і складські рухи підтверджує власник, адміністратор або працівник складу.</p>`}</form></section>`;
  }
  function draftFromForm(form, projectId) {
    const ctx = capture(projectId, true), project = row(projectId), stock = snapshot(ctx);
    const draft = draftFor(project, ctx, equipmentRows(project, stock));
    const date = form.querySelector("[data-installation-date]");
    const confirm = form.querySelector("[data-installation-confirm]");
    if (date) draft.date = date.value;
    if (confirm) draft.confirmed = Boolean(confirm.checked);
    for (const field of form.querySelectorAll("[data-installation-qty]")) {
      if (draft.quantities.has(id(field.dataset.installationQty))) draft.quantities.set(id(field.dataset.installationQty), field.value);
    }
    return { ctx, project, draft, stock };
  }
  async function submit(form) {
    if (running) return;
    const projectId = id(form.dataset.installationForm);
    let original, draft, operation;
    try {
      const value = draftFromForm(form, projectId); original = value.ctx; draft = value.draft;
      if (!draft.confirmed) throw failure("Підтвердьте дату та фактично змонтовані кількості.", "INSTALLATION_CONFIRM");
      if (!value.stock) throw failure("Спочатку оновіть дані складу.", "INSTALLATION_BASE");
      cleanMaterials(value.project, original); // Must run before transact's read can preserve a conflicting local edit.
      const expected = materialStamp(value.project);
      const input = { projectId, completedOn: draft.date, today: today(), recordedAt: new Date().toISOString(),
        actor: { id: original.userId, name: original.actorName }, lines: Array.from(draft.quantities, ([itemId, qty]) => ({ itemId, qty })) };
      const transaction = window.SpartaWarehouseUI?.transact;
      if (typeof transaction !== "function") throw failure("Модуль складських операцій недоступний. Оновіть сторінку.", "INSTALLATION_BASE");
      operation = {}; running = operation; draft.notice = ""; draft.error = false; paint(original, projectId);
      await transaction((fresh) => {
        current(original, projectId, true);
        const selected = row(projectId);
        if (!selected || materialStamp(selected) !== expected) throw failure("Матеріали об’єкта змінилися. Оновіть дані та перевірте кількості.", "INSTALLATION_CONFLICT");
        cleanMaterials(selected, original);
        const nextProjects = original.local ? localProjects(projectId, expected) : fresh.projects;
        const freshProject = nextProjects?.find((entry) => id(entry.id) === projectId);
        if (!freshProject || materialStamp(freshProject) !== expected) throw failure("Матеріали об’єкта змінилися на іншому пристрої. Оновіть дані та перевірте кількості.", "INSTALLATION_CONFLICT");
        const next = core.complete({ ...fresh, projects: nextProjects }, input);
        current(original, projectId, true);
        return next;
      });
      current(original, projectId, true);
      draft.notice = "Монтаж підтверджено. Фактичне обладнання та дата збережені у складському журналі.";
    } catch (error) {
      try {
        if (!original) original = capture(projectId, true);
        current(original, projectId, true);
        draft = draft || drafts.get(projectId);
        if (draft) { draft.notice = error.message || "Не вдалося підтвердити монтаж."; draft.error = true; draft.confirmed = false; }
      } catch (_) { /* A previous account or selected object must never update this view. */ }
    } finally {
      if (running === operation) running = null;
      if (original) paint(original, projectId);
    }
  }
  async function refresh(projectId) {
    if (running) return;
    let original, draft, operation;
    try {
      original = capture(projectId);
      const project = row(projectId);
      draft = draftFor(project, original, equipmentRows(project, snapshot(original)));
      cleanMaterials(project, original);
      const expected = materialStamp(project);
      operation = {}; running = operation; draft.notice = ""; draft.error = false; paint(original, projectId);
      if (original.local) {
        const read = () => { current(original, projectId); localProjects(projectId, expected); window.SpartaWarehouseUI?.bootstrap?.(); };
        if (typeof navigator !== "undefined" && navigator.locks) await navigator.locks.request("sparta-local-warehouse-v31", read);
        else read();
      } else {
        if (!window.SpartaWarehouseCloud?.load) throw failure("Хмарний склад недоступний. Оновіть сторінку.", "INSTALLATION_BASE");
        await window.SpartaWarehouseCloud.load();
        current(original, projectId);
        cleanMaterials(row(projectId), original);
      }
      current(original, projectId);
      draft.notice = "Залишки та дані монтажу оновлено.";
    } catch (error) {
      try { if (original) { current(original, projectId); draft.notice = error.message || "Не вдалося оновити дані монтажу."; draft.error = true; } } catch (_) { /* Stale context. */ }
    } finally {
      if (running === operation) running = null;
      if (original) paint(original, projectId);
    }
  }
  function update(event) {
    const field = event.target;
    if (!field?.dataset || running) return;
    const projectId = field.dataset.installationProject;
    if (!projectId || !Object.keys(field.dataset).some((key) => ["installationQty", "installationDate", "installationConfirm"].includes(key))) return;
    try {
      const original = capture(projectId, true), project = row(projectId);
      const draft = draftFor(project, original, equipmentRows(project, snapshot(original)));
      if (field.dataset.installationQty != null && draft.quantities.has(id(field.dataset.installationQty))) draft.quantities.set(id(field.dataset.installationQty), field.value);
      if (field.dataset.installationDate != null) draft.date = field.value;
      if (field.dataset.installationConfirm != null) draft.confirmed = Boolean(field.checked);
      draft.notice = "";
    } catch (_) { /* Controls from an obsolete render have no effect. */ }
  }
  function reset() { epoch++; drafts.clear(); }
  function refreshAccess() {
    const value = context();
    for (const [projectId, draft] of drafts) if (!value.ready || draft.key !== value.key) drafts.delete(projectId);
    return value.ready;
  }
  document.addEventListener("input", update);
  document.addEventListener("change", update);
  document.addEventListener("submit", (event) => {
    const form = event.target?.closest?.("[data-installation-form]");
    if (!form) return;
    event.preventDefault();
    void submit(form);
  });
  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-installation-action]");
    if (!button || button.disabled || button.dataset.installationAction !== "refresh") return;
    event.preventDefault();
    void refresh(button.dataset.installationProject);
  });
  window.SpartaInstallationUI = Object.freeze({ markup, reset, refreshAccess });
})();
