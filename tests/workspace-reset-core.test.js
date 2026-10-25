"use strict";
const assert = require("node:assert/strict");
const Reset = require("../workspace-reset-core.js");

function runResetTests() {
  const prefix = "sparta.local.v1.";
  const key = (name) => prefix + "solarObjectManager." + name;
  const encode = (value) => JSON.stringify(value);
  let passed = 0;
  const check = (name, callback) => { callback(); passed += 1; };
  function fixture() {
    return {
      [key("projects")]: encode([{ id: "p1", photos: [{ id: "photo" }], files: [{ id: "file" }] }]),
      [key("crmTasks")]: encode([{ id: "task" }]),
      [key("warehouseItems")]: encode([{ id: "legacy" }]),
      [key("warehouseMovements")]: encode([{ id: "legacy-move" }]),
      [key("warehouseWorkspace.v31")]: encode({ version: 1, items: [{ id: "item" }, { id: "item2" }], movements: [{ id: "m1" }, { id: "m2" }], documents: [{ id: "d" }], reservations: [{ id: "r" }] }),
      [key("warehouseTransaction.v31")]: "null",
      [key("projectFiles")]: encode({ p1: [{ id: "file" }] }),
      [key("cash.v1.local-sparta")]: encode({ entries: [{ id: "c1" }, { id: "c2" }], pendingIds: [] }),
      [key("cash.v1.old-local")]: encode({ entries: [{ id: "c3" }] }),
      [key("localMembers")]: encode([{ user_id: "local-owner", role: "owner", profiles: { full_name: "Власник тестової компанії" } }, { user_id: "demo-installer", role: "installer", profiles: { email: "demo@example.test" } }]),
      [key("demoScenario")]: encode({ test: true }),
      [key("warehouseBackup.before31")]: encode({ items: [{ id: "old" }] }),
      [key("solarEstimate")]: encode({ generation: 123 }),
      [key("pendingDeletes")]: encode(["old-delete"]),
      [key("portalMode")]: "installer",
      [key("solarCalculator")]: encode({ capacityKw: 8, latitude: 48.2 }),
      [key("company")]: encode({ name: "Sparta" }),
      [key("profile")]: encode({ user: "real-owner" }),
      [prefix + "initialized"]: "2026-10-24",
      [prefix + "filesCopied"]: "true",
      [prefix + "originalSnapshot"]: encode({ values: { old: "test" } }),
      [prefix + "lastDemoBackupAt"]: "2026-10-24",
      "solarObjectManager.projects": encode([{ id: "old-test" }]),
      "solarObjectManager.warehouseItems": encode([{ id: "old-stock" }]),
      "solarObjectManager.cash.v1.cloud-id": encode({ entries: [{ id: "old-payment" }], pendingIds: [] }),
      "solarObjectManager.portalMode": "client",
      "solarObjectManager.companySettings": encode({ email: "real@example.com" }),
      "sb-auth-token": "secret-auth-not-json",
      "supabase.auth.token": "secret",
      "unrelated.key": "preserve",
      "sparta.local.v2.solarObjectManager.projects": "malformed-but-out-of-scope",
    };
  }
  function apply(values, plan) {
    const result = { ...values };
    plan.removes.forEach((entry) => { delete result[entry]; });
    Object.assign(result, plan.writes);
    return result;
  }
  const values = fixture();
  const plan = Reset.planReset(values, { prefix, companyId: "local-sparta", now: "2026-10-24T19:00:00+03:00" });
  check("summary counts canonical warehouse, photos and files once", () => {
    assert.deepEqual(plan.summary, { projects: 1, tasks: 1, items: 2, movements: 2, documents: 1, reservations: 1, cashEntries: 3, photos: 1, projectFiles: 1, members: 2 });
  });
  check("active business stores are empty and pending journal cannot resurrect data", () => {
    const cleaned = apply(values, plan);
    ["projects", "crmTasks", "warehouseItems", "warehouseMovements", "pendingDeletes", "pendingCrmDeletes", "pendingWarehouseDeletes"].forEach((name) => assert.deepEqual(JSON.parse(cleaned[key(name)]), []));
    assert.deepEqual(JSON.parse(cleaned[key("warehouseWorkspace.v31")]), { version: 1, items: [], movements: [], documents: [], reservations: [] });
    assert.equal(cleaned[key("warehouseTransaction.v31")], "null");
    assert.deepEqual(JSON.parse(cleaned[key("cash.v1.local-sparta")]), { entries: [], pendingIds: [] });
  });
  check("auth, configuration, local initialization and user preferences stay untouched", () => {
    const cleaned = apply(values, plan);
    ["sb-auth-token", "supabase.auth.token", "unrelated.key", key("company"), key("profile"), key("portalMode"), key("solarCalculator"), prefix + "initialized", prefix + "filesCopied", "solarObjectManager.portalMode", "solarObjectManager.companySettings", "sparta.local.v2.solarObjectManager.projects"].forEach((name) => {
      assert.equal(cleaned[name], values[name]);
      assert.ok(plan.preservedKeys.includes(name));
    });
  });
  check("test scenario, stale estimates, old operational snapshots and raw legacy data are removed", () => {
    const cleaned = apply(values, plan);
    [key("demoScenario"), key("warehouseBackup.before31"), key("solarEstimate"), key("cash.v1.old-local"), prefix + "originalSnapshot", prefix + "lastDemoBackupAt", "solarObjectManager.projects", "solarObjectManager.warehouseItems", "solarObjectManager.cash.v1.cloud-id"].forEach((name) => assert.equal(Object.hasOwn(cleaned, name), false));
    assert.equal(cleaned[key("cleanStart.v1")], "true");
    assert.equal(cleaned[key("nomenclatureImported.v2")], "true");
    assert.equal(cleaned[key("demoCrmTasksAdded")], "true");
    assert.equal(cleaned[key("warehouseLayout")], "new");
  });
  check("test staff are removed and a neutral local owner remains", () => {
    assert.deepEqual(JSON.parse(plan.writes[key("localMembers")]), [{ user_id: "local-owner", role: "owner", is_active: true, profiles: { full_name: "Власник компанії" } }]);
  });
  check("real owner and administrator records are retained without mutation", () => {
    const owner = { user_id: "owner-real", role: "owner", is_active: true, profiles: { full_name: "Власник", email: "owner@example.com" } };
    const admin = { user_id: "admin-real", role: "admin", profiles: { full_name: "Адміністратор" } };
    const source = { ...fixture(), [key("localMembers")]: encode([owner, admin, { user_id: "demo-3", role: "installer" }]) };
    const result = Reset.planReset(source);
    assert.deepEqual(JSON.parse(result.writes[key("localMembers")]), [owner, admin]);
    assert.equal(result.summary.members, 1);
  });
  check("planning is pure and repeat reset is idempotent", () => {
    const before = encode(values);
    assert.equal(encode(values), before);
    const once = apply(values, plan);
    const secondPlan = Reset.planReset(once);
    assert.deepEqual(apply(once, secondPlan), once);
    assert.deepEqual(secondPlan.summary, { projects: 0, tasks: 0, items: 0, movements: 0, documents: 0, reservations: 0, cashEntries: 0, photos: 0, projectFiles: 0, members: 0 });
  });
  check("legacy active arrays support reset before warehouse v31 initialization", () => {
    const source = { [key("projects")]: "[]", [key("warehouseItems")]: encode([{ id: "one" }]), [key("warehouseMovements")]: encode([{ id: "move" }]) };
    const result = Reset.planReset(source);
    assert.equal(result.summary.items, 1);
    assert.equal(result.summary.movements, 1);
  });
  check("malformed active or known raw business data aborts before any plan is returned", () => {
    [key("projects"), key("crmTasks"), key("warehouseWorkspace.v31"), key("warehouseTransaction.v31"), key("cash.v1.local-sparta"), "solarObjectManager.projects"].forEach((name) => {
      assert.throws(() => Reset.planReset({ ...fixture(), [name]: "not-json" }));
    });
    assert.throws(() => Reset.planReset({ ...fixture(), [key("projects")]: "{}" }));
    assert.throws(() => Reset.planReset({ ...fixture(), [key("projectFiles")]: '{"p1":{}}' }));
    assert.throws(() => Reset.planReset({ ...fixture(), [key("warehouseWorkspace.v31")]: '{"items":[]}' }));
    assert.throws(() => Reset.planReset({ ...fixture(), [key("warehouseTransaction.v31")]: '{"version":1}' }));
  });
  check("pending valid warehouse recovery is explicitly neutralized", () => {
    const source = { ...fixture(), [key("warehouseTransaction.v31")]: encode({ version: 1, warehouse: { items: [{ id: "pending" }], movements: [], documents: [], reservations: [] }, projects: [{ id: "pending-project" }] }) };
    const result = Reset.planReset(source);
    assert.equal(result.writes[key("warehouseTransaction.v31")], "null");
    assert.equal(JSON.parse(result.writes[key("warehouseWorkspace.v31")]).items.length, 0);
  });
  check("scope validation cannot broaden reset into arbitrary storage", () => {
    assert.throws(() => Reset.planReset(fixture(), { prefix: "sb-", companyId: "local-sparta" }));
    assert.throws(() => Reset.planReset(fixture(), { companyId: "../elsewhere" }));
    assert.throws(() => Reset.planReset(fixture(), { now: "invalid" }));
    assert.throws(() => Reset.planReset(null));
    assert.ok(plan.removes.every((name) => name.startsWith(prefix) || name.startsWith("solarObjectManager.")));
  });
  return { passed };
}
module.exports = runResetTests;
if (require.main === module) console.log(JSON.stringify(runResetTests(), null, 2));
