"use strict";
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path").resolve(__dirname, "..");

function runLocalWorkspaceTests() {
  const source = fs.readFileSync(path + "/local-workspace.js", "utf8");
  const values = new Map([
    ["solarObjectManager.projects", '[{"id":"taras","title":"Тарас Сусід"}]'],
    ["solarObjectManager.pendingDeletes", '["dangerous-old-delete"]'],
    ["solarObjectManager.warehouseItems", '[{"id":"panel","qty":48}]'],
    ["sb-session", "private-auth-must-not-be-copied"],
  ]);
  const storage = {
    get length() { return values.size; }, key(index) { return [...values.keys()][index]; },
    getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, String(value)); },
  };
  const context = vm.createContext({ window: { location: { hostname: "127.0.0.1" }, localStorage: storage }, Date, Object, JSON, Promise });
  vm.runInContext(source, context);
  const workspace = context.window.SPARTA_LOCAL_WORKSPACE;
  assert.equal(workspace.enabled, true);
  assert.equal(workspace.fileDatabase, "sparta-local-project-files-v1");
  assert.equal(storage.getItem(workspace.storageKey("solarObjectManager.projects")), "[]");
  assert.equal(storage.getItem(workspace.storageKey("solarObjectManager.warehouseItems")), "[]");
  assert.equal(JSON.parse(storage.getItem(workspace.storageKey("solarObjectManager.cash.v1.local-sparta"))).entries.length, 0);
  assert.equal(storage.getItem(workspace.storageKey("solarObjectManager.pendingDeletes")), "[]");
  assert.equal(storage.getItem("solarObjectManager.pendingDeletes"), '["dangerous-old-delete"]');
  assert(!storage.getItem(workspace.storageKey("sb-session")));
  const backup = JSON.parse(storage.getItem(workspace.prefix + "originalSnapshot"));
  assert(!("sb-session" in backup.values));
  assert.equal(backup.values["solarObjectManager.projects"], storage.getItem("solarObjectManager.projects"));
  storage.setItem(workspace.storageKey("solarObjectManager.projects"), '[{"id":"local-new"}]');
  vm.runInContext(source, context);
  assert.equal(storage.getItem(workspace.storageKey("solarObjectManager.projects")), '[{"id":"local-new"}]');
  assert.equal(storage.getItem("solarObjectManager.projects"), '[{"id":"taras","title":"Тарас Сусід"}]');
  const publicContext = vm.createContext({ window: { location: { hostname: "sparta-field-u2pe.vercel.app" }, localStorage: storage } });
  vm.runInContext(source, publicContext);
  assert.equal(publicContext.window.SPARTA_LOCAL_WORKSPACE, undefined);
  return { passed: 3, scenarios: "empty first start with recoverable historical snapshot, no auth/test-data migration, reload preserves local edits, public host unchanged" };
}
module.exports = runLocalWorkspaceTests;
