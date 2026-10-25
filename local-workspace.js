(function () {
  "use strict";
  if (!["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) return;

  const prefix = "sparta.local.v1.";
  const marker = `${prefix}initialized`;
  let initError = "";
  try {
    const storage = window.localStorage;
    if (!storage.getItem(marker)) {
      const original = {};
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith("solarObjectManager.")) original[key] = storage.getItem(key);
      }
      // Preserve the original browser snapshot; authentication tokens are excluded.
      if (!storage.getItem(`${prefix}originalSnapshot`)) {
        storage.setItem(`${prefix}originalSnapshot`, JSON.stringify({ savedAt: new Date().toISOString(), values: original }));
      }
      // A new workspace starts empty. Historical browser records are retained only
      // in the recoverable snapshot; never silently import them into a new base.
      const empty = {
        projects: [], crmTasks: [], warehouseItems: [], warehouseMovements: [], projectFiles: {},
      };
      Object.entries(empty).forEach(([key, value]) => {
        if (storage.getItem(prefix + "solarObjectManager." + key) == null) storage.setItem(prefix + "solarObjectManager." + key, JSON.stringify(value));
      });
      storage.setItem(prefix + "solarObjectManager.pendingDeletes", "[]");
      storage.setItem(prefix + "solarObjectManager.pendingCrmDeletes", "[]");
      storage.setItem(prefix + "solarObjectManager.pendingWarehouseDeletes", "[]");
      storage.setItem(prefix + "solarObjectManager.cash.v1.local-sparta", JSON.stringify({ entries: [], pendingIds: [] }));
      storage.setItem(marker, new Date().toISOString());
    }
  } catch (error) {
    initError = `Не вдалося підготувати локальне сховище: ${error.message}`;
  }

  async function prepareFiles() {
    // Attachments are imported only by an explicit restore/import operation.
    // In particular, reopening an empty application must not resurrect test files.
    window.localStorage.setItem(prefix + "filesCopied", "true");
  }

  window.SPARTA_LOCAL_WORKSPACE = Object.freeze({
    enabled: true,
    prefix,
    companyId: "local-sparta",
    fileDatabase: "sparta-local-project-files-v1",
    storageKey: (key) => prefix + key,
    initError,
    prepareFiles,
  });
})();
