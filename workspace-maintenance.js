(function () {
  "use strict";
  const workspace = window.SPARTA_LOCAL_WORKSPACE;
  const core = window.SpartaWorkspaceReset;
  if (!workspace?.enabled || !core) return;
  const backupDb = "sparta-local-backups-v1";
  const fileDatabases = ["sparta-local-project-files-v1", "sparta-project-files"];
  const reportKey = workspace.prefix + "cleanStart.report";
  const pendingKey = workspace.prefix + "cleanStart.pending";
  let busy = false;
  let message = "";
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  function collectValues() {
    const result = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if ((key.startsWith(workspace.prefix) || key.startsWith("solarObjectManager.")) && key !== pendingKey) result[key] = localStorage.getItem(key);
    }
    return result;
  }
  function plan(values = collectValues()) {
    return core.planReset(values, { prefix: workspace.prefix, companyId: workspace.companyId, now: new Date().toISOString() });
  }
  function report() {
    try { return JSON.parse(localStorage.getItem(reportKey) || "null"); } catch (_) { return null; }
  }
  function assertLocal() {
    if (!workspace.enabled || cloudState.client || cloudState.ready || cloudState.companyId !== workspace.companyId || cloudState.memberRole !== "owner") throw new Error("Очищення дозволене тільки власнику ізольованої локальної бази. Хмарна база не змінюється.");
  }
  function summaryMarkup(summary) {
    return `<div class="maintenance-counts">${[["Об’єкти / клієнти", summary.projects], ["CRM-задачі", summary.tasks], ["Товари", summary.items], ["Рухи складу", summary.movements], ["Складські документи", summary.documents], ["Резерви", summary.reservations], ["Касові операції", summary.cashEntries], ["Фото об’єктів", summary.photos], ["Документи об’єктів", summary.projectFiles], ["Тестові працівники", summary.members]].map(([label, count]) => `<span>${label}<strong>${count}</strong></span>`).join("")}</div>`;
  }
  function panelMarkup() {
    const last = report();
    let summary;
    try { summary = plan().summary; } catch (error) { return `<article class="client-info-card"><h3>Дані та резервні копії</h3><p role="alert">${safe(error.message)}</p></article>`; }
    const clean = readLocalStorage("solarObjectManager.cleanStart.v1") === "true";
    return `<article class="client-info-card maintenance-panel"><h3>Дані та резервні копії</h3><p>${clean ? "База підготовлена для внесення власних даних. Демооб’єкти, каталог і задачі автоматично не створюються." : "Перед видаленням усіх робочих записів буде створено й перевірено резервну копію даних та вкладень. Акаунт, налаштування й підключення не видаляються."}</p>${summaryMarkup(summary)}<div class="maintenance-actions">${!clean ? `<button type="button" class="danger-button" data-workspace-clean ${busy ? "disabled" : ""}>Очистити всі робочі записи</button>` : ""}${last?.backupId ? `<button type="button" class="secondary-button" data-workspace-export ${busy ? "disabled" : ""}>Завантажити копію перед очищенням</button>` : ""}</div>${last ? `<p>Очищено: ${safe(new Date(last.cleanedAt).toLocaleString("uk-UA"))}. Копія даних і ${last.files} файлів зберігається окремо від робочої бази.</p>` : ""}<p role="status" class="calculation-note">${safe(message)}</p></article>`;
  }
  function openDb(name, store, create) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        if (create) { if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store); }
        else request.transaction.abort();
      };
      request.onsuccess = () => {
        if (!request.result.objectStoreNames.contains(store)) { request.result.close(); resolve(null); }
        else resolve(request.result);
      };
      request.onerror = () => { if (create) reject(request.error); else resolve(null); };
      request.onblocked = () => reject(new Error("Сховище зайняте іншою вкладкою. Закрийте інші локальні вкладки та повторіть."));
    });
  }
  async function fileEntries(name) {
    const db = await openDb(name, "files", false);
    if (!db) return [];
    return new Promise((resolve, reject) => {
      const entries = [];
      const tx = db.transaction("files", "readonly");
      const request = tx.objectStore("files").openCursor();
      request.onsuccess = () => { const cursor = request.result; if (cursor) { entries.push({ key: cursor.key, value: cursor.value }); cursor.continue(); } };
      tx.oncomplete = () => { db.close(); resolve(entries); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
  async function replaceFiles(name, entries = []) {
    const db = await openDb(name, "files", entries.length > 0);
    if (!db) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      const store = tx.objectStore("files");
      store.clear();
      entries.forEach((entry) => store.put(entry.value, entry.key));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Запис файлів перервано."));
    }).finally(() => db.close());
  }
  async function backupRecord(id, value) {
    const db = await openDb(backupDb, "snapshots", true);
    return new Promise((resolve, reject) => {
      const tx = db.transaction("snapshots", value ? "readwrite" : "readonly");
      const store = tx.objectStore("snapshots");
      const request = value ? store.put(value, id) : store.get(id);
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error("Резервну копію не записано.")); };
    });
  }
  async function createBackup(values, resetPlan) {
    const id = `before-clean-${new Date().toISOString()}-${crypto.randomUUID()}`;
    const fileStores = [];
    for (const name of fileDatabases) fileStores.push({ name, entries: await fileEntries(name) });
    const value = { version: 1, id, savedAt: new Date().toISOString(), origin: location.origin, values, fileStores, plan: resetPlan };
    await backupRecord(id, value);
    const verified = await backupRecord(id);
    if (!verified || JSON.stringify(verified.values) !== JSON.stringify(values) || verified.fileStores.length !== fileStores.length) throw new Error("Не вдалося перевірити резервну копію. Нічого не очищено.");
    for (const store of fileStores) {
      const saved = verified.fileStores.find((entry) => entry.name === store.name);
      if (!saved || saved.entries.length !== store.entries.length || saved.entries.some((entry, index) => entry.key !== store.entries[index].key || entry.value.size !== store.entries[index].value.size)) throw new Error("Копія вкладень неповна. Очищення скасовано.");
    }
    return verified;
  }
  function setProgress(text) {
    message = text;
    const status = document.querySelector("#workspaceCleanProgress");
    if (status) status.textContent = text;
  }
  function applyMemoryReset() {
    projects = []; crmTasks = []; warehouseItems = []; warehouseMovements = []; projectFilesByProjectId = {};
    selectedProjectId = ""; selectedTab = "";
    pendingCloudDeletes = []; pendingCrmDeletes = []; pendingWarehouseDeletes = [];
    solarEstimate = null;
  }
  async function applyClean(backup) {
    const reset = backup.plan;
    // The durable backup/pending reference survives a browser interruption here.
    const targets = new Set([...reset.removes, ...Object.keys(reset.writes)]);
    targets.forEach((key) => localStorage.removeItem(key));
    Object.entries(reset.writes).forEach(([key, value]) => localStorage.setItem(key, value));
    for (const store of backup.fileStores) await replaceFiles(store.name);
    const result = plan().summary;
    if (["projects", "tasks", "items", "movements", "documents", "reservations", "cashEntries", "photos", "projectFiles"].some((key) => result[key] !== 0)) throw new Error("Не всі робочі записи очищено. Резервна копія збережена.");
    for (const name of fileDatabases) if ((await fileEntries(name)).length) throw new Error("Локальні вкладення потребують повторного очищення.");
    const last = { backupId: backup.id, cleanedAt: new Date().toISOString(), removed: reset.summary, files: backup.fileStores.reduce((sum, store) => sum + store.entries.length, 0) };
    localStorage.setItem(reportKey, JSON.stringify(last));
    localStorage.removeItem(pendingKey);
    applyMemoryReset();
    return last;
  }
  async function recover() {
    const id = localStorage.getItem(pendingKey);
    if (!id) return;
    const backup = await backupRecord(id);
    if (!backup?.plan || !backup?.fileStores) throw new Error("Незавершене очищення: резервну копію не знайдено. Не вносьте нові дані.");
    await applyClean(backup);
  }
  function openConfirmation() {
    assertLocal();
    const summary = plan().summary;
    let element = document.querySelector("#workspaceCleanDialog");
    if (!element) {
      element = document.createElement("dialog"); element.id = "workspaceCleanDialog"; element.className = "workspace-clean-dialog";
      document.body.append(element);
      element.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
    }
    element.innerHTML = `<div class="modal-form"><header class="modal-head"><h2>Підготувати чисту програму</h2></header><p>Буде прибрано всі робочі записи цієї локальної бази, включно з тестовими фото, чеками й файлами. Акаунт та налаштування збережуться. Перед очищенням автоматично створюється перевірена копія, з якої можна відновити дані.</p>${summaryMarkup(summary)}<p id="workspaceCleanProgress" role="status"></p><div class="modal-actions"><button type="button" class="secondary-button" data-workspace-cancel>Скасувати</button><button type="button" class="danger-button" data-workspace-confirm>Створити бекап і очистити</button></div></div>`;
    element.showModal();
  }
  async function clean() {
    if (busy) return;
    assertLocal();
    busy = true;
    document.querySelectorAll("#workspaceCleanDialog button").forEach((button) => { button.disabled = true; });
    try {
      setProgress("Зберігаю дані та файли в резервну копію…");
      const values = collectValues();
      const reset = plan(values);
      const backup = await createBackup(values, reset);
      if (JSON.stringify(collectValues()) !== JSON.stringify(values)) throw new Error("Під час створення копії дані змінилися. Очищення скасовано; повторіть після завершення інших операцій.");
      localStorage.setItem(pendingKey, backup.id);
      setProgress("Резервну копію перевірено. Очищаю записи та локальні вкладення…");
      await applyClean(backup);
      setProgress("Готово. Програма порожня, резервна копія збережена.");
      location.reload();
    } catch (error) {
      setProgress(error.message + (localStorage.getItem(pendingKey) ? " Очищення завершиться з резервного журналу після оновлення сторінки." : " Початкові дані залишено без змін."));
      document.querySelectorAll("#workspaceCleanDialog button").forEach((button) => { button.disabled = false; });
    } finally { busy = false; }
  }
  function asDataUrl(blob) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
  }
  async function exportBackup() {
    const last = report();
    if (!last) throw new Error("Резервної копії перед очищенням ще немає.");
    const backup = await backupRecord(last.backupId);
    if (!backup) throw new Error("Резервну копію не знайдено в цьому браузері.");
    const fileStores = [];
    for (const store of backup.fileStores) {
      const entries = [];
      for (const entry of store.entries) entries.push({ key: entry.key, name: entry.value.name || "file", type: entry.value.type, size: entry.value.size, src: await asDataUrl(entry.value) });
      fileStores.push({ name: store.name, entries });
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...backup, fileStores })], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `sparta-before-clean-${backup.savedAt.slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-workspace-clean],[data-workspace-confirm],[data-workspace-cancel],[data-workspace-export]");
    if (!target || busy) return;
    const run = async () => {
      if (target.hasAttribute("data-workspace-clean")) openConfirmation();
      if (target.hasAttribute("data-workspace-confirm")) await clean();
      if (target.hasAttribute("data-workspace-cancel")) document.querySelector("#workspaceCleanDialog")?.close();
      if (target.hasAttribute("data-workspace-export")) await exportBackup();
    };
    void run().catch((error) => { message = error.message; renderProfileView(); });
  });
  window.SpartaWorkspaceMaintenance = Object.freeze({ panelMarkup, recover });
})();
