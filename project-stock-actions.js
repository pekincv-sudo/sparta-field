(function () {
  "use strict";

  const core = window.SpartaWarehouseCore;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const id = (value) => String(value ?? "");
  const currency = (value) => value?.currency || "UAH";
  const failure = (message, code) => Object.assign(new Error(message), { code });
  let epoch = 0;
  let busy = false;

  function context() {
    const local = Boolean(window.SPARTA_LOCAL_WORKSPACE?.enabled);
    const state = typeof cloudState === "undefined" ? {} : cloudState;
    const role = local ? "owner" : state.memberRole || "";
    const allowed = !state.sessionLoading && state.audience !== "buyer" && !window.SpartaBuyerCloud?.isBuyerReady?.()
      && !(typeof portalMode !== "undefined" && portalMode === "client");
    const ready = Boolean(allowed && core && (local ? !window.SPARTA_LOCAL_WORKSPACE.initError
      : state.ready && state.client && state.user?.id && state.companyId));
    return {
      key: JSON.stringify([local ? "local" : "cloud", local ? window.SPARTA_LOCAL_WORKSPACE.companyId || "local-sparta" : state.companyId || "",
        local ? "local" : state.user?.id || "", role, typeof cloudContextRevision === "number" ? cloudContextRevision : 0, epoch]),
      ready, canQuote: ready && ["owner", "admin"].includes(role),
      canPlan: ready && ["owner", "admin", "engineer"].includes(role),
      canMove: ready && ["owner", "admin", "warehouse"].includes(role),
      selectedProjectId: typeof selectedProjectId === "undefined" ? "" : id(selectedProjectId),
    };
  }
  function row(projectId) {
    return (typeof projects === "undefined" ? [] : projects).find((entry) => id(entry.id) === id(projectId));
  }
  function project(projectId) {
    const value = row(projectId);
    if (!context().ready || !value) return null;
    return { id: id(value.id), title: value.title || "Об’єкт", currency: currency(value), closed: isClosedProjectStatus(value.status) };
  }
  function capture(projectId, capability) {
    const value = context();
    if (!value.ready || capability && !value[capability]) throw failure("Для цієї дії немає доступу. Перевірте роль і підключення до компанії.", "PROJECT_STOCK_ACCESS");
    if (projectId != null && (!row(projectId) || value.selectedProjectId !== id(projectId))) throw failure("Об’єкт змінився. Відкрийте вибір обладнання ще раз.", "PROJECT_STOCK_CONTEXT");
    return { ...value, client: typeof cloudState === "undefined" ? null : cloudState.client };
  }
  function current(original, projectId, capability) {
    const value = capture(projectId, capability);
    if (value.key !== original.key || value.client !== original.client || value.selectedProjectId !== original.selectedProjectId)
      throw failure("Обліковий запис або об’єкт змінився. Відкрийте вибір обладнання ще раз.", "PROJECT_STOCK_CONTEXT");
    return value;
  }
  async function stock({ refresh = true } = {}) {
    const original = capture();
    if (!original.canQuote && !original.canPlan && !original.canMove) throw failure("Для перегляду обладнання в об’єкті немає доступу.", "PROJECT_STOCK_ACCESS");
    const local = Boolean(window.SPARTA_LOCAL_WORKSPACE?.enabled);
    const provider = local ? window.SpartaWarehouseUI : window.SpartaWarehouseCloud;
    if (!provider?.snapshot || !local && refresh && !provider.load) throw failure("Модуль складу недоступний. Оновіть сторінку.", "PROJECT_STOCK_READ");
    const result = !local && refresh ? await provider.load() : provider.snapshot();
    current(original);
    if (!result || !Array.isArray(result.items) || !Array.isArray(result.reservations)
      || !local && !Number.isSafeInteger(result.revision)) throw failure("Не вдалося отримати актуальні залишки складу. Оновіть дані.", "PROJECT_STOCK_READ");
    return copy({ ...result, orderReservations: result.orderReservations || [] });
  }
  function selectedLines(state, lines, targetProject) {
    if (!Array.isArray(lines) || !lines.length) throw failure("Оберіть обладнання та кількість.", "PROJECT_STOCK_INPUT");
    const selected = new Map();
    for (const input of lines) {
      const item = state.items.find((entry) => id(entry.id) === id(input?.itemId));
      if (!item || !core.isStockItem(item)) throw failure("Обладнання вже відсутнє в каталозі. Оновіть список.", "PROJECT_STOCK_ITEM");
      if (currency(item) !== currency(targetProject)) throw failure("Валюта обладнання має збігатися з валютою об’єкта.", "PROJECT_STOCK_CURRENCY");
      const qty = core.quantity(input.qty, item.unit);
      const existing = selected.get(id(item.id));
      selected.set(id(item.id), { item, qty: core.quantity(Math.round(((existing?.qty || 0) + qty) * 1000) / 1000, item.unit) });
    }
    return [...selected.values()];
  }
  function price(value) {
    const result = Number(value ?? 0);
    if (!Number.isFinite(result) || result < 0) throw failure("Перевірте ціни обладнання в каталозі.", "PROJECT_STOCK_PRICE");
    return result;
  }
  function plannedMaterials(materials, selected, targetProject) {
    const result = copy(materials);
    for (const { item, qty } of selected) {
      const existing = result.find((entry) => id(entry.warehouseItemId) === id(item.id));
      if (existing) {
        if (currency(existing) !== currency(targetProject)) throw failure("Матеріал об’єкта має іншу валюту. Перевірте план матеріалів.", "PROJECT_STOCK_CURRENCY");
        existing.plannedQty = core.quantity(Math.round((Math.max(Number(existing.plannedQty || 0), Number(existing.issuedQty || 0)) + qty) * 1000) / 1000, item.unit);
      } else result.push({ currency: currency(targetProject), warehouseItemId: item.id, name: item.name, category: item.category || "Інше", sku: item.sku || "",
        plannedQty: qty, issuedQty: 0, actualQty: 0, unit: item.unit || "шт", purchasePriceSnapshot: core.unitCost(item), salePriceSnapshot: price(item.installerPrice ?? item.salePrice ?? 0) });
    }
    return result;
  }
  function quotedFinance(targetProject, selected) {
    const result = copy(targetProject);
    result.finance = normalizeProjectFinance(copy(targetProject.finance || {}));
    for (const { item, qty } of selected) result.finance.offerLines.push({ id: `offer-${crypto.randomUUID()}`, currency: currency(targetProject), warehouseItemId: item.id,
      name: item.name, category: item.category || "Інше", qty, unit: item.unit || "шт", purchasePrice: core.unitCost(item),
      salePrice: price(item.retailPrice ?? item.installerPrice ?? item.salePrice ?? 0), note: item.characteristics || "" });
    syncCommercialOfferContractPrice(result);
    if (!Number.isFinite(result.finance.contractPrice)) throw failure("Перевірте валюту та ціни наявних позицій КП.", "PROJECT_STOCK_PRICE");
    return result.finance;
  }
  function localBase(targetProject, field) {
    const stored = typeof readJsonStorage === "function" ? readJsonStorage("solarObjectManager.projects", null) : null;
    if (stored != null && !Array.isArray(stored)) throw failure("Не вдалося прочитати збережені об’єкти.", "PROJECT_STOCK_STORAGE");
    const result = copy(stored ?? projects);
    const target = result.find((entry) => id(entry.id) === id(targetProject.id));
    const comparable = (value) => field === "finance" ? normalizeProjectFinance(value || {}) : value || [];
    if (!target || !same(comparable(target[field]), comparable(targetProject[field]))) throw failure("Об’єкт змінився в іншій вкладці. Оновіть дані перед додаванням.", "PROJECT_STOCK_CONFLICT");
    return result;
  }
  function persistField(targetProject, field, value) {
    const local = Boolean(window.SPARTA_LOCAL_WORKSPACE?.enabled);
    const next = local ? localBase(targetProject, field) : copy(projects);
    const target = next.find((entry) => id(entry.id) === id(targetProject.id));
    target[field] = copy(value);
    if (typeof writeLocalStorage !== "function" || !writeLocalStorage("solarObjectManager.projects", JSON.stringify(next)))
      throw failure("Не вдалося зберегти об’єкт. Звільніть пам’ять браузера та повторіть дію.", "PROJECT_STOCK_STORAGE");
    targetProject[field] = copy(value);
    if (!local) queueCloudSync();
  }
  function renderProject() {
    if (typeof renderDetail === "function") renderDetail();
    if (typeof applyProjectRoleControls === "function") applyProjectRoleControls();
  }
  function materialBase(targetProject, beforeRead = false) {
    const provider = window.SpartaWarehouseCloud;
    if (!provider?.baseMaterials || !provider.saveProjectMaterials) throw failure("Модуль матеріалів недоступний. Оновіть сторінку.", "PROJECT_STOCK_READ");
    const base = provider.baseMaterials(targetProject.id);
    if (base == null ? !beforeRead || (targetProject.materials || []).length > 0 : !same(targetProject.materials || [], base))
      throw failure("У матеріалах є незбережені зміни. Спочатку збережіть або оновіть план матеріалів.", "PROJECT_STOCK_CONFLICT");
    return base;
  }
  async function exclusive(callback) {
    if (busy) throw failure("Дочекайтеся завершення попередньої дії.", "PROJECT_STOCK_BUSY");
    busy = true;
    try {
      if (window.SPARTA_LOCAL_WORKSPACE?.enabled && typeof navigator !== "undefined" && navigator.locks)
        return await navigator.locks.request("sparta-local-warehouse-v31", callback);
      return await callback();
    } finally { busy = false; }
  }
  async function add({ projectId, target, lines } = {}) {
    if (!["offer", "materials"].includes(target)) throw failure("Невідома ціль додавання обладнання.", "PROJECT_STOCK_INPUT");
    return exclusive(async () => {
      const capability = target === "offer" ? "canQuote" : "canPlan";
      const original = capture(projectId, capability);
      const local = Boolean(window.SPARTA_LOCAL_WORKSPACE?.enabled);
      const initial = row(projectId);
      const beforeMaterials = copy(initial.materials || []);
      if (target === "materials" && !local) materialBase(initial, true);
      const state = await stock();
      current(original, projectId, capability);
      const targetProject = row(projectId);
      if (isClosedProjectStatus(targetProject.status)) throw failure("Додавання обладнання доступне лише для активних об’єктів.", "PROJECT_STOCK_CLOSED");
      const selected = selectedLines(state, lines, targetProject);
      if (target === "offer") persistField(targetProject, "finance", quotedFinance(targetProject, selected));
      else if (local) {
        if (!same(targetProject.materials || [], beforeMaterials)) throw failure("Матеріали змінилися під час вибору обладнання. Повторіть дію.", "PROJECT_STOCK_CONFLICT");
        persistField(targetProject, "materials", plannedMaterials(targetProject.materials || [], selected, targetProject));
      } else {
        const base = materialBase(targetProject);
        const next = plannedMaterials(base, selected, targetProject);
        await window.SpartaWarehouseCloud.saveProjectMaterials(projectId, next, base);
        current(original, projectId, capability);
      }
      renderProject();
      return { count: selected.length, message: target === "offer" ? "Обладнання додано до КП. Залишки складу не змінені."
        : "Обладнання додано до плану матеріалів. Резерв і видача оформлюються окремо." };
    });
  }
  async function move({ projectId, itemId, qty, type } = {}) {
    if (!["project", "reserve"].includes(type)) throw failure("Невідома складська дія.", "PROJECT_STOCK_INPUT");
    return exclusive(async () => {
      const original = capture(projectId, "canMove");
      const state = await stock();
      current(original, projectId, "canMove");
      const targetProject = row(projectId);
      if (isClosedProjectStatus(targetProject.status)) throw failure("Видача та резерв доступні лише для активних об’єктів.", "PROJECT_STOCK_CLOSED");
      const selected = selectedLines(state, [{ itemId, qty }], targetProject)[0];
      const available = core.availableQty(selected.item, state.reservations, type === "project" ? projectId : undefined, state.orderReservations);
      if (selected.qty > available) throw failure(`Доступно ${available} ${selected.item.unit || "шт"}. Оновіть кількість.`, "PROJECT_STOCK_SHORTAGE");
      if (!window.SpartaWarehouseUI?.openForProject) throw failure("Модуль складських документів недоступний. Оновіть сторінку.", "PROJECT_STOCK_READ");
      window.SpartaWarehouseUI.openForProject(type, { projectId, itemId: selected.item.id, qty: selected.qty });
      return { count: 1, message: "Перевірте дані та проведіть складський документ." };
    });
  }
  function reset() { epoch += 1; }

  window.SpartaProjectStockActions = Object.freeze({ context, project, stock, add, move, reset });
})();
