"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function runAuthSessionTests(sourceFile = path.join(__dirname, "..", "app.js")) {
  const source = fs.readFileSync(sourceFile, "utf8");
  const functions = new Map([...source.matchAll(/^(?:async )?function\s+([\w$]+)\([^]*?^\}/gm)].map((match) => [match[1], match[0]]));
  const harness = (names = []) => {
    const stored = new Map([["solarObjectManager.crmTasks", '[{"id":"legacy-task"}]']]);
    const scheduled = [];
    const removedTimers = [];
    const cleared = [];
    const gate = { textContent: "" };
    const state = { client: null, user: null, companyId: "company-a", memberRole: null, enabled: true, ready: false, sessionLoading: false, message: "Checking", members: [], invitations: [] };
    const context = vm.createContext({
      cloudState: state, cloudContextRevision: 0, cloudStorageScope: "", cloudSessionTask: null, cloudSessionUserId: "",
      cloudSyncTimer: 1, crmSyncTimer: 2, warehouseSyncTimer: 3, cloudLoading: false,
      projects: [{ id: "previous-project" }], crmTasks: [{ id: "previous-task" }], projectFilesByProjectId: { previous: [] },
      warehouseItems: [{ id: "previous-item" }], warehouseMovements: [{ id: "previous-move" }],
      pendingCloudDeletes: ["previous-project"], pendingCrmDeletes: ["previous-task"], pendingWarehouseDeletes: ["previous-item"], selectedProjectId: "previous-project", selectedTab: "contract",
      gateAuthMessage: gate,
      window: {
        localStorage: { getItem(key) { return stored.get(key) ?? null; }, setItem(key, value) { stored.set(key, value); } },
        clearTimeout(value) { removedTimers.push(value); }, setTimeout(callback) { scheduled.push(callback); },
        SpartaCashBook: { refreshAccess() { cleared.push("cash"); }, async sync() {} }, SpartaWarehouseCloud: { reset() { cleared.push("warehouse"); } },
      },
      document: { body: { classList: { toggle(name, value) { context.locked = value; } } }, querySelectorAll() { return [{ close() { cleared.push("dialog"); } }]; } },
      supabaseConfig() { return { companyId: "company-a" }; }, clearCloudMediaUrls() {}, async verifyPublicSchema() {}, render() {}, renderProfileView() {}, renderCrmNotification() {},
      dbCrmTaskToApp(row) { return row; }, dbWarehouseItemToApp(row) { return row; },
      encodeURIComponent, console,
    });
    for (const name of names) { assert.ok(functions.has(name), `Production ${name} exists`); vm.runInContext(functions.get(name), context); }
    return { context, state, stored, scheduled, removedTimers, cleared, gate };
  };
  let passed = 0;
  {
    const h = harness(["updateAccessMode"]);
    h.state.enabled = false; h.context.updateAccessMode(); assert.equal(h.context.locked, true);
    h.state.enabled = true; h.state.user = { id: "owner" }; h.context.updateAccessMode(); assert.equal(h.context.locked, true);
    h.state.ready = true; h.state.sessionLoading = true; h.context.updateAccessMode(); assert.equal(h.context.locked, true);
    h.state.sessionLoading = false; h.context.updateAccessMode(); assert.equal(h.context.locked, false);
    h.state.ready = false; h.context.window.SPARTA_LOCAL_WORKSPACE = { enabled: true }; h.context.updateAccessMode(); assert.equal(h.context.locked, false);
    passed++;
  }
  {
    const h = harness(["scopedStorageKey", "readLocalStorage", "writeLocalStorage"]);
    for (const key of ["projects", "crmTasks", "projectFiles", "warehouseItems", "warehouseMovements", "warehouseWorkspace.v31", "pendingDeletes", "pendingCrmDeletes", "cash.v1.company-a"]) {
      const full = `solarObjectManager.${key}`;
      h.stored.set(full, "legacy");
      assert.equal(h.context.readLocalStorage(full), null);
      assert.equal(h.context.writeLocalStorage(full, "blocked"), false);
      h.context.cloudStorageScope = "identity-a.company-a.";
      assert.equal(h.context.writeLocalStorage(full, "new-a"), true);
      assert.equal(h.context.readLocalStorage(full), "new-a");
      h.context.cloudStorageScope = "identity-b.company-a.";
      assert.equal(h.context.readLocalStorage(full), null);
      assert.equal(h.stored.get(full), "legacy");
      h.context.cloudStorageScope = "";
    }
    h.context.window.SPARTA_LOCAL_WORKSPACE = { enabled: true, storageKey(key) { return `local.${key}`; } };
    assert.equal(h.context.writeLocalStorage("solarObjectManager.projects", "local-edit"), true);
    assert.equal(h.stored.get("local.solarObjectManager.projects"), "local-edit");
    passed++;
  }
  {
    const h = harness(["clearCompanyContext"]);
    h.context.cloudStorageScope = "old-scope";
    h.state.ready = true;
    h.context.clearCompanyContext();
    for (const name of ["projects", "crmTasks", "warehouseItems", "warehouseMovements", "pendingCloudDeletes", "pendingCrmDeletes", "pendingWarehouseDeletes"]) assert.equal(h.context[name].length, 0, name);
    assert.equal(Object.keys(h.context.projectFilesByProjectId).length, 0);
    assert.equal(h.context.cloudContextRevision, 1);
    assert.equal(h.context.cloudStorageScope, "");
    assert.equal(h.state.ready, false);
    assert.deepEqual(h.removedTimers, [1, 2, 3]);
    assert.deepEqual(h.cleared, ["warehouse", "dialog", "cash"]);
    assert.ok(h.stored.has("solarObjectManager.crmTasks"), "Old cache retained without importing or deleting it");
    passed++;
  }
  const request = (result) => {
    const query = { select() { return query; }, eq() { return query; }, order() { return result; } };
    return query;
  };
  {
    const h = harness(["loadCrmTasksFromCloud"]);
    h.state.ready = true;
    h.state.client = { from() { return request(Promise.resolve({ data: [], error: null })); } };
    h.context.writeLocalStorage = () => true;
    h.context.syncCrmTasksToCloud = () => { throw new Error("Must never upload old browser tasks into an empty cloud"); };
    await h.context.loadCrmTasksFromCloud();
    assert.equal(h.context.crmTasks.length, 0);
    passed++;
  }
  {
    const h = harness(["loadCrmTasksFromCloud"]);
    h.state.ready = true;
    h.state.client = { from() { return request(Promise.resolve({ data: null, error: { message: "missing table" } })); } };
    await assert.rejects(h.context.loadCrmTasksFromCloud(), /missing table/);
    passed++;
  }
  {
    let resolve;
    const h = harness(["loadCrmTasksFromCloud"]);
    h.state.ready = true;
    h.context.crmTasks = [];
    h.state.client = { from() { return request(new Promise((done) => { resolve = done; })); } };
    h.context.writeLocalStorage = () => { throw new Error("Stale request cannot write into new context"); };
    const pending = h.context.loadCrmTasksFromCloud();
    h.context.cloudContextRevision++;
    resolve({ data: [{ id: "old-account-secret" }], error: null });
    await pending;
    assert.equal(h.context.crmTasks.length, 0);
    passed++;
  }
  const sessionHarness = () => {
    const h = harness(["clearCompanyContext", "updateAccessMode", "applyCloudSession", "handleCloudAuthChange"]);
    const calls = [];
    h.context.loadCompanyContext = async () => { calls.push("company"); h.state.ready = true; h.state.memberRole = "owner"; };
    h.context.loadProjectsFromCloud = async () => { calls.push("projects"); };
    h.context.loadCrmTasksFromCloud = async () => { calls.push("tasks"); };
    h.context.loadWarehouseItemsFromCloud = async () => { calls.push("warehouse"); };
    h.context.window.SpartaCashBook.sync = async () => { calls.push("cash"); };
    return { ...h, calls };
  };
  {
    const h = sessionHarness();
    const session = { user: { id: "user-a" } };
    const first = h.context.applyCloudSession(session);
    assert.equal(h.context.locked, true, "Stay gated while company data loads");
    const second = h.context.applyCloudSession(session);
    assert.equal(await first, true); assert.equal(await second, true);
    assert.deepEqual(h.calls, ["company", "projects", "tasks", "warehouse", "cash"]);
    assert.equal(h.context.locked, false);
    await h.context.applyCloudSession(session);
    assert.equal(h.calls.length, 5, "Token refresh does not re-import or reload business records");
    passed++;
  }
  {
    const h = sessionHarness();
    let resolve;
    h.context.loadProjectsFromCloud = () => new Promise((done) => { resolve = done; });
    const pending = h.context.applyCloudSession({ user: { id: "user-a" } });
    for (let index = 0; index < 6 && !resolve; index++) await Promise.resolve();
    h.context.handleCloudAuthChange("SIGNED_OUT", null);
    assert.equal(h.context.locked, true); assert.equal(h.state.user, null);
    resolve();
    assert.equal(await pending, false);
    assert.deepEqual(h.calls, ["company"]);
    assert.equal(h.context.locked, true);
    passed++;
  }
  {
    const h = sessionHarness();
    h.state.user = { id: "old-user" }; h.state.ready = true;
    h.context.handleCloudAuthChange("SIGNED_IN", { user: { id: "new-user" } });
    assert.equal(h.context.locked, true);
    assert.equal(h.context.projects.length, 0);
    assert.equal(h.calls.length, 0, "No Supabase request inside auth callback");
    h.context.handleCloudAuthChange("SIGNED_OUT", null);
    h.scheduled[0]();
    await Promise.resolve();
    assert.equal(h.calls.length, 0, "Superseded sign-in event cannot restore old context");
    passed++;
  }
  {
    const h = sessionHarness();
    h.context.loadCompanyContext = async () => {};
    assert.equal(await h.context.applyCloudSession({ user: { id: "nonmember" } }), false);
    assert.equal(h.context.locked, true);
    assert.equal(h.state.sessionLoading, false);
    assert.equal(h.calls.length, 0);
    passed++;
  }
  {
    const h = sessionHarness();
    h.context.loadWarehouseItemsFromCloud = async () => { throw new Error("Cloud schema missing"); };
    await assert.rejects(h.context.applyCloudSession({ user: { id: "user-a" } }), /Cloud schema missing/);
    assert.equal(h.context.locked, true);
    assert.equal(h.state.ready, false);
    assert.equal(h.context.projects.length, 0);
    assert.match(h.state.message, /Cloud schema missing/);
    passed++;
  }
  return { passed };
}
module.exports = runAuthSessionTests;
