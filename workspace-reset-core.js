(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SpartaWorkspaceReset = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const base = "solarObjectManager.";
  const arrayKeys = ["projects", "crmTasks", "warehouseItems", "warehouseMovements", "localMembers", "pendingDeletes", "pendingCrmDeletes", "pendingWarehouseDeletes"];
  const objectKeys = ["projectFiles", "warehouseWorkspace.v31", "warehouseTransaction.v31", "demoScenario", "warehouseBackup.before31", "solarEstimate"];
  const resetMarkers = ["cleanStart.v1", "nomenclatureImported.v2", "demoCrmTasksAdded", "warehouseLayout"];
  const knownBusinessKeys = arrayKeys.concat(objectKeys, resetMarkers);
  const own = function (value, key) { return Object.prototype.hasOwnProperty.call(value, key); };
  function fail(message) { throw new Error(message); }
  function plainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
  function decoded(values, key, fallback) {
    if (!own(values, key)) return fallback;
    if (typeof values[key] !== "string") fail("Збережене значення «" + key + "» не є рядком. Очищення скасовано.");
    try { return JSON.parse(values[key]); }
    catch (_) { fail("Не вдалося прочитати дані «" + key + "». Очищення скасовано до створення коректного плану."); }
  }
  function arrayValue(values, key) {
    const value = decoded(values, key, []);
    if (!Array.isArray(value)) fail("Некоректний список «" + key + "». Очищення скасовано.");
    return value;
  }
  function objectValue(values, key) {
    const value = decoded(values, key, null);
    if (value !== null && !plainObject(value)) fail("Некоректний запис «" + key + "». Очищення скасовано.");
    return value;
  }
  function checkWarehouse(value, label) {
    if (value === null) return;
    if (!Array.isArray(value.items) || !Array.isArray(value.movements) || !Array.isArray(value.documents) || !Array.isArray(value.reservations)) {
      fail("Неповний складський пакет «" + label + "». Спочатку перевірте резервну копію.");
    }
  }
  function checkProjects(projects, key) {
    projects.forEach(function (project) {
      if (!plainObject(project)) fail("Некоректний об’єкт у «" + key + "».");
      ["photos", "files"].forEach(function (field) {
        if (project[field] != null && !Array.isArray(project[field])) fail("Некоректні вкладення об’єкта у «" + key + "».");
      });
    });
  }
  function cashKey(key, scope) { return key.startsWith(scope + base + "cash.v1."); }
  function demoMember(member) {
    const profile = member.profiles || member.profile || {};
    const text = [member.user_id, member.id, member.email, member.full_name, profile.email, profile.full_name].filter(Boolean).join(" ");
    return /(?:^|\s)(?:demo|test|crm-demo)[-_]|@example\.(?:test|invalid)\b|тест|навчаль|\bdemo\b/i.test(text);
  }
  function privilegedMembers(members) {
    const result = members.filter(function (member) {
      return plainObject(member) && ["owner", "admin"].includes(member.role) && member.is_active !== false && !demoMember(member);
    }).map(function (member) { return JSON.parse(JSON.stringify(member)); });
    if (!result.some(function (member) { return member.role === "owner"; })) {
      result.unshift({ user_id: "local-owner", role: "owner", is_active: true, profiles: { full_name: "Власник компанії" } });
    }
    return result;
  }

  // Pure planning only. Callers must finish a durable backup before applying this plan.
  function planReset(values, options) {
    if (!plainObject(values)) fail("Для очищення потрібен знімок локального сховища.");
    const settings = options || {};
    const prefix = settings.prefix || "sparta.local.v1.";
    const companyId = settings.companyId || "local-sparta";
    if (typeof prefix !== "string" || !/^sparta\.local\.[A-Za-z0-9._-]+\.$/.test(prefix)) fail("Очищення дозволене лише в ізольованому локальному просторі Sparta.");
    if (typeof companyId !== "string" || !/^[A-Za-z0-9_-]+$/.test(companyId)) fail("Некоректний ідентифікатор локальної компанії.");
    if (settings.now != null && !Number.isFinite(new Date(settings.now).getTime())) fail("Некоректна дата очищення.");
    const active = prefix + base;
    const parsed = {};
    ["", prefix].forEach(function (scope) {
      arrayKeys.forEach(function (name) {
        const key = scope + base + name;
        const value = arrayValue(values, key);
        parsed[key] = value;
        if (name === "projects") checkProjects(value, key);
      });
      objectKeys.forEach(function (name) {
        const key = scope + base + name;
        const value = objectValue(values, key);
        parsed[key] = value;
        if (name === "warehouseWorkspace.v31") checkWarehouse(value, key);
        if (name === "warehouseTransaction.v31" && value !== null) {
          if (value.version !== 1 || !plainObject(value.warehouse)) fail("Некоректний журнал відновлення «" + key + "».");
          checkWarehouse(value.warehouse, key);
          if (value.projects != null) {
            if (!Array.isArray(value.projects)) fail("Некоректні об’єкти в журналі відновлення.");
            checkProjects(value.projects, key);
          }
        }
        if (name === "projectFiles" && value !== null) Object.keys(value).forEach(function (id) {
          if (!Array.isArray(value[id])) fail("Некоректний список документів об’єкта «" + id + "».");
        });
      });
    });
    const cashKeys = Object.keys(values).filter(function (key) { return cashKey(key, prefix) || cashKey(key, ""); });
    cashKeys.forEach(function (key) {
      const value = objectValue(values, key);
      if (!value || !Array.isArray(value.entries) || (value.pendingIds != null && !Array.isArray(value.pendingIds))) fail("Некоректний касовий журнал «" + key + "».");
      parsed[key] = value;
    });
    const projects = parsed[active + "projects"];
    const warehouse = parsed[active + "warehouseWorkspace.v31"];
    const members = parsed[active + "localMembers"];
    const keptMembers = privilegedMembers(members);
    const removedMembers = members.filter(function (member) {
      return !plainObject(member) || !["owner", "admin"].includes(member.role) || member.is_active === false || demoMember(member);
    }).length;
    const files = parsed[active + "projectFiles"];
    const photoCount = projects.reduce(function (sum, project) { return sum + (project.photos || []).length; }, 0);
    const fileCount = files !== null
      ? Object.values(files).reduce(function (sum, entries) { return sum + entries.length; }, 0)
      : projects.reduce(function (sum, project) { return sum + (project.files || []).length; }, 0);
    const summary = {
      projects: projects.length,
      tasks: parsed[active + "crmTasks"].length,
      items: warehouse ? warehouse.items.length : parsed[active + "warehouseItems"].length,
      movements: warehouse ? warehouse.movements.length : parsed[active + "warehouseMovements"].length,
      documents: warehouse ? warehouse.documents.length : 0,
      reservations: warehouse ? warehouse.reservations.length : 0,
      cashEntries: cashKeys.filter(function (key) { return cashKey(key, prefix); }).reduce(function (sum, key) { return sum + parsed[key].entries.length; }, 0),
      photos: photoCount,
      projectFiles: fileCount,
      members: removedMembers,
    };
    const writes = {};
    ["projects", "crmTasks", "warehouseItems", "warehouseMovements", "pendingDeletes", "pendingCrmDeletes", "pendingWarehouseDeletes"].forEach(function (name) { writes[active + name] = "[]"; });
    writes[active + "projectFiles"] = "{}";
    writes[active + "warehouseWorkspace.v31"] = JSON.stringify({ version: 1, items: [], movements: [], documents: [], reservations: [] });
    writes[active + "warehouseTransaction.v31"] = "null";
    writes[active + "cash.v1." + companyId] = JSON.stringify({ entries: [], pendingIds: [] });
    writes[active + "localMembers"] = JSON.stringify(keptMembers);
    writes[active + "cleanStart.v1"] = "true";
    writes[active + "nomenclatureImported.v2"] = "true";
    writes[active + "demoCrmTasksAdded"] = "true";
    // Layout is a pre-existing scalar preference, not a JSON-encoded object.
    writes[active + "warehouseLayout"] = "new";
    const removals = new Set();
    knownBusinessKeys.forEach(function (name) {
      const raw = base + name;
      const current = active + name;
      if (own(values, raw)) removals.add(raw);
      if (own(values, current) && !own(writes, current)) removals.add(current);
    });
    cashKeys.forEach(function (key) { if (!own(writes, key)) removals.add(key); });
    [prefix + "originalSnapshot", prefix + "lastDemoBackupAt"].forEach(function (key) { if (own(values, key)) removals.add(key); });
    const removes = Array.from(removals).sort();
    const preservedKeys = Object.keys(values).filter(function (key) {
      return !removals.has(key) && (!own(writes, key) || writes[key] === values[key]);
    }).sort();
    return { writes: writes, removes: removes, summary: summary, preservedKeys: preservedKeys };
  }
  return Object.freeze({ planReset: planReset });
});
