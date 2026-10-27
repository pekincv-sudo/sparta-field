(function () {
  "use strict";

  // The server bundle is authoritative. Nothing is queued offline or replayed from
  // browser storage: a posted document is acknowledged only after its RPC commits.
  let loaded = null;
  let identity = "";
  let materialTokens = new Map();
  let materialBases = new Map();
  let editBases = new Map();
  let pending = null;
  let running = false;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const unavailable = "Хмарний склад не підключено. Операцію не проведено. Перевірте підключення та міграцію warehouse-cloud.sql.";

  function context() {
    if (window.SPARTA_LOCAL_WORKSPACE?.enabled || !cloudState.ready || !cloudState.client || !cloudState.user?.id || !cloudState.companyId) throw new Error(unavailable);
    return { client: cloudState.client, companyId: cloudState.companyId, userId: cloudState.user.id, key: `${cloudState.user.id}:${cloudState.companyId}` };
  }
  function validContext(ctx) {
    try { return context().key === ctx.key; } catch (_) { return false; }
  }
  function reset() { loaded = null; identity = ""; materialTokens = new Map(); materialBases = new Map(); editBases = new Map(); pending = null; }
  // An unrelated sale changes availability. Keep any unresolved write request
  // so its original idempotency key can still be settled after a network loss.
  function invalidate() { loaded = null; }
  function snapshot() {
    try { if (context().key !== identity) return null; } catch (_) { return null; }
    return loaded ? clone(loaded) : null;
  }
  function apply(response, ctx) {
    if (!validContext(ctx)) throw new Error("Обліковий запис змінився. Відкрийте склад ще раз.");
    if (!response || !Number.isSafeInteger(Number(response.revision)) || !response.state || !Array.isArray(response.state.items)) throw new Error(unavailable);
    const state = response.state;
    identity = ctx.key;
    loaded = { items: clone(state.items), movements: clone(state.movements || []), documents: clone(state.documents || []), reservations: clone(state.reservations || []), orderReservations: clone(response.orderReservations || []), revision: Number(response.revision) };
    warehouseItems = loaded.items.map(normalizeWarehouseItem);
    warehouseMovements = clone(loaded.movements);
    const previousBases = materialBases;
    materialTokens = new Map(); materialBases = new Map();
    for (const entry of response.projectMaterials || []) {
      const id = String(entry.id);
      materialTokens.set(id, entry.token);
      materialBases.set(id, clone(entry.materials || []));
      const project = projects.find((row) => String(row.id) === id);
      if (project) {
        const previous = previousBases.get(id);
        const incoming = entry.materials || [];
        const hasLocalEdits = previous && !same(project.materials || [], previous) && !same(project.materials || [], incoming);
        if (hasLocalEdits) {
          if (!editBases.has(id)) editBases.set(id, clone(previous));
        } else {
          project.materials = clone(incoming);
          editBases.delete(id);
        }
      }
    }
    // Mirrors are for rendering/recovery only; they are never uploaded on startup.
    writeLocalStorage("solarObjectManager.warehouseItems", JSON.stringify(warehouseItems));
    writeLocalStorage("solarObjectManager.warehouseMovements", JSON.stringify(warehouseMovements));
    writeLocalStorage("solarObjectManager.projects", JSON.stringify(projects));
    return snapshot();
  }
  function errorMessage(error) {
    if (error?.code === "40001") return "Склад або матеріали вже змінилися на іншому пристрої. Дані оновлено. Перевірте кількість і повторіть операцію.";
    if (error?.code === "42501") return "Проводити складські документи може власник, адміністратор або працівник складу компанії.";
    return error?.message ? `${unavailable} ${error.message}` : unavailable;
  }
  async function read(ctx) {
    const { data, error } = await ctx.client.rpc("sparta_warehouse_read", { p_company_id: ctx.companyId });
    if (error) throw Object.assign(new Error(errorMessage(error)), { code: error.code });
    return apply(data, ctx);
  }
  async function load() {
    const ctx = context();
    if (identity && identity !== ctx.key) reset();
    return read(ctx);
  }
  function projectSnapshot() {
    return projects.map((project) => ({ ...clone(project), materials: clone(materialBases.get(String(project.id)) || []) }));
  }
  async function commit(ctx, next, current) {
    const changes = [];
    for (const project of next.projects || []) {
      const id = String(project.id);
      const base = materialBases.get(id);
      if (!base) throw new Error("Об’єкт ще не збережений у Supabase. Спочатку синхронізуйте об’єкт.");
      if (!same(base, project.materials || [])) changes.push({ id, token: materialTokens.get(id), materials: clone(project.materials || []) });
    }
    const payload = { version: 1, items: next.items, movements: next.movements || [], documents: next.documents || [], reservations: next.reservations || [] };
    const request = { p_company_id: ctx.companyId, p_request_id: crypto.randomUUID(), p_expected_revision: current.revision, p_state: payload, p_project_updates: changes };
    // If a connection drops after commit, retry exactly this request ID before
    // accepting a new operation. The RPC returns the committed state on retry.
    pending = { key: ctx.key, request };
    const { data, error } = await ctx.client.rpc("sparta_warehouse_write", request);
    if (error) {
      if (error.code) pending = null; // explicit server rejection, no commit
      if (error.code === "40001") await read(ctx);
      throw Object.assign(new Error(errorMessage(error)), { code: error.code });
    }
    pending = null;
    apply(data, ctx);
    return next;
  }
  async function settlePending(ctx) {
    if (!pending || pending.key !== ctx.key) return false;
    const { data, error } = await ctx.client.rpc("sparta_warehouse_write", pending.request);
    if (error) {
      if (error.code) pending = null;
      if (error.code === "40001") await read(ctx);
      throw new Error(errorMessage(error));
    }
    pending = null;
    apply(data, ctx);
    return true;
  }
  async function transact(callback) {
    if (running) throw new Error("Дочекайтеся завершення попередньої складської операції.");
    const ctx = context();
    running = true;
    try {
      if (identity && identity !== ctx.key) reset();
      if (await settlePending(ctx)) throw new Error("Попередню операцію підтверджено сервером. Перевірте журнал документів перед новою операцією.");
      const current = await read(ctx);
      const next = await callback({ ...clone(current), projects: projectSnapshot() });
      if (!validContext(ctx)) throw new Error("Обліковий запис змінився. Операцію не проведено.");
      return await commit(ctx, { ...current, ...next }, current);
    } finally { running = false; }
  }
  // Existing object forms may change planned lines. Require their original
  // material list to match the last loaded version; never overwrite a newer issue.
  async function saveProjectMaterials(projectId, materials, baseMaterials) {
    const id = String(projectId);
    const edited = clone(materials || []);
    const source = baseMaterials ?? editBases.get(id) ?? materialBases.get(id);
    if (!source) throw new Error("Спочатку оновіть матеріали об’єкта з Supabase.");
    const expected = clone(source);
    context();
    if (same(edited, expected)) return { unchanged: true };
    return transact((state) => {
      const project = state.projects.find((entry) => String(entry.id) === id);
      if (!project || !same(project.materials, expected)) throw new Error("Матеріали об’єкта змінилися. Оновіть об’єкт перед збереженням.");
      project.materials = edited;
      return state;
    });
  }
  function baseMaterials(projectId) { const value = editBases.get(String(projectId)) ?? materialBases.get(String(projectId)); return value ? clone(value) : null; }
  async function uploadAttachment(documentId, file) {
    const ctx = context();
    if (!(file?.size > 0) || file.size > 20 * 1024 * 1024) throw new Error("Документ має бути розміром від 1 байта до 20 МБ.");
    if (!/^image\/(jpeg|png|webp|heic|heif)$|^application\/pdf$/.test(file.type)) throw new Error("Додайте фотографію або PDF.");
    const extension = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
    const path = `${ctx.companyId}/${encodeURIComponent(documentId)}/${crypto.randomUUID()}.${extension}`;
    const { error } = await ctx.client.storage.from("warehouse-files").upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw new Error(`Документ не завантажено: ${error.message}`);
    if (!validContext(ctx)) throw new Error("Обліковий запис змінився. Відкрийте документ заново.");
    return { storageBucket: "warehouse-files", storagePath: path, fileName: file.name, size: file.size, type: file.type };
  }
  async function openAttachment(file) {
    const ctx = context();
    if (file.storageBucket !== "warehouse-files" || !file.storagePath?.startsWith(`${ctx.companyId}/`)) throw new Error("Документ недоступний для цієї компанії.");
    const { data, error } = await ctx.client.storage.from("warehouse-files").download(file.storagePath);
    if (error) throw new Error(`Не вдалося відкрити документ: ${error.message}`);
    if (!validContext(ctx)) throw new Error("Обліковий запис змінився.");
    const url = URL.createObjectURL(data);
    const link = document.createElement("a"); link.href = url; link.download = file.fileName || "document"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  window.SpartaWarehouseCloud = Object.freeze({ load, transact, snapshot, reset, invalidate, saveProjectMaterials, baseMaterials, uploadAttachment, openAttachment });
})();
