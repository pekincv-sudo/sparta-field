"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

async function runTests(directory = path.resolve(__dirname, "..")) {
  const source = fs.readFileSync(path.join(directory, "warehouse-cloud.js"), "utf8");
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const initialItem = { id: "panel", name: "Панель", unit: "шт", qty: 1, purchasePrice: 100, retailPrice: 0, installerPrice: 0, powerW: 450, brand: "Manufacturer", serialNumbers: ["S-1"] };
  let server = { revision: 0, state: { items: [initialItem], movements: [], documents: [], reservations: [] }, projectMaterials: [{ id: "project", token: "m0", materials: [] }] };
  const requests = new Set();
  let writeCalls = 0;
  let loseResponse = false;
  let failMigration = false;
  let concurrentWrite = false;
  let switchUser = null;
  function client() {
    return {
      async rpc(name, payload) {
        if (name === "sparta_warehouse_read") {
          if (failMigration) return { data: null, error: { code: "PGRST202", message: "Function not found" } };
          return { data: clone(server), error: null };
        }
        assert.equal(name, "sparta_warehouse_write");
        writeCalls++;
        if (requests.has(payload.p_request_id)) return { data: clone(server), error: null };
        if (concurrentWrite) { concurrentWrite = false; server.revision++; server.state.items[0].qty = 0; }
        if (payload.p_expected_revision !== server.revision) return { data: null, error: { code: "40001", message: "changed" } };
        for (const update of payload.p_project_updates) {
          const entry = server.projectMaterials.find((row) => row.id === update.id);
          if (entry.token !== update.token) return { data: null, error: { code: "40001", message: "material conflict" } };
          entry.materials = clone(update.materials); entry.token = crypto.randomUUID();
        }
        server.state = clone(payload.p_state); server.revision++;
        requests.add(payload.p_request_id);
        if (switchUser) switchUser();
        if (loseResponse) { loseResponse = false; return { data: null, error: { message: "Network response lost" } }; }
        return { data: clone(server), error: null };
      },
    };
  }
  function browser() {
    const storage = new Map();
    const context = {
      window: {}, cloudState: { ready: true, user: { id: "owner" }, companyId: "company", client: client() },
      warehouseItems: [], warehouseMovements: [], projects: [{ id: "project", title: "Station", materials: [{ name: "stale local data" }] }],
      crypto, normalizeWarehouseItem: clone,
      writeLocalStorage(key, value) { storage.set(key, value); return true; },
    };
    vm.createContext(context); vm.runInContext(source, context);
    return { context, api: context.window.SpartaWarehouseCloud, storage };
  }
  const checks = [];
  const a = browser(); const b = browser();
  await a.api.load(); await b.api.load();
  assert.equal(a.context.warehouseItems[0].brand, "Manufacturer");
  assert.equal(a.context.warehouseItems[0].retailPrice, 0);
  assert.equal(a.context.warehouseItems[0].serialNumbers[0], "S-1");
  assert.equal(a.context.projects[0].materials.length, 0);
  checks.push("Server data replaces stale browser cache and preserves full metadata/zero prices");

  await a.api.transact((state) => {
    state.items[0].qty = 0;
    state.movements.push({ id: "issue", type: "project", itemId: "panel", projectId: "project", qty: 1 });
    state.documents.push({ id: "doc", status: "posted" });
    state.projects[0].materials = [{ name: "Панель", warehouseItemId: "panel", plannedQty: 1, issuedQty: 1, actualQty: 0, purchasePriceSnapshot: 100, salePriceSnapshot: 0 }];
    return state;
  });
  assert.equal(server.projectMaterials[0].materials[0].actualQty, 0);
  await b.api.load();
  assert.equal(b.context.warehouseItems[0].qty, 0);
  assert.equal(b.context.projects[0].materials[0].issuedQty, 1);
  assert.equal(b.context.projects[0].materials[0].actualQty, 0);
  assert.equal(b.api.snapshot().documents.length, 1);
  checks.push("Issue, uninstalled quantity, snapshots and documents survive second-device reload");

  const staleBase = b.api.baseMaterials("project");
  await a.api.saveProjectMaterials("project", [{ ...staleBase[0], plannedQty: 2 }]);
  await assert.rejects(b.api.saveProjectMaterials("project", [{ ...staleBase[0], plannedQty: 3 }], staleBase), /Матеріали об’єкта змінилися/);
  assert.equal(server.projectMaterials[0].materials[0].plannedQty, 2);
  checks.push("An older object form cannot overwrite a newer material version");

  server.projectMaterials.push({ id: "other", token: "other0", materials: [{ name: "Cable", plannedQty: 1, actualQty: 0, issuedQty: 0 }] });
  a.context.projects.push({ id: "other", title: "Other station", materials: [] });
  await a.api.load();
  const otherBase = a.api.baseMaterials("other");
  a.context.projects[1].materials[0].plannedQty = 5;
  const editedOther = clone(a.context.projects[1].materials);
  await a.api.saveProjectMaterials("project", [{ ...a.api.baseMaterials("project")[0], plannedQty: 4 }]);
  assert.equal(a.context.projects[1].materials[0].plannedQty, 5);
  assert.deepEqual(a.api.baseMaterials("other"), otherBase);
  await a.api.saveProjectMaterials("other", editedOther, otherBase);
  assert.equal(server.projectMaterials[1].materials[0].plannedQty, 5);
  const unchangedCalls = writeCalls;
  await a.api.saveProjectMaterials("other", a.context.projects[1].materials);
  assert.equal(writeCalls, unchangedCalls);
  checks.push("Saving one object preserves pending material edits on other objects and unchanged forms do not post");

  concurrentWrite = true;
  await assert.rejects(a.api.transact((state) => { state.items[0].brand = "Changed"; return state; }), /іншому пристрої/);
  assert.equal(a.api.snapshot().revision, server.revision);
  assert.equal(server.state.items[0].brand, "Manufacturer");
  checks.push("CAS conflict rejects the mutation and refreshes authoritative state");

  loseResponse = true;
  await assert.rejects(a.api.transact((state) => { state.items[0].brand = "Committed"; return state; }), /Network response lost/);
  const committedRevision = server.revision;
  await assert.rejects(a.api.transact((state) => { throw new Error("Must not repeat callback"); }), /Попередню операцію підтверджено/);
  assert.equal(server.revision, committedRevision);
  assert.equal(a.api.snapshot().items[0].brand, "Committed");
  checks.push("Retry after a lost response reuses the request ID and does not post twice");

  failMigration = true;
  const callsBefore = writeCalls;
  await assert.rejects(a.api.transact((state) => state), /warehouse-cloud.sql/);
  assert.equal(writeCalls, callsBefore);
  failMigration = false;
  checks.push("A missing cloud migration never falls back to an offline stock mutation");

  switchUser = () => { a.context.cloudState.user.id = "another-user"; };
  await assert.rejects(a.api.transact((state) => { state.items[0].brand = "Changed identity"; return state; }), /Обліковий запис змінився/);
  assert.equal(a.api.snapshot(), null);
  switchUser = null;
  a.api.reset();
  assert.equal(a.api.baseMaterials("project"), null);
  checks.push("An account switch discards the previous company response and material cache");

  const sql = fs.readFileSync(path.join(directory, "database/warehouse-cloud.sql"), "utf8");
  for (const required of ["for update", "current_row.revision <> p_expected_revision", "Posted warehouse history is immutable", "Stock changes require matching document movements", "Issued/installed materials require matching warehouse documents", "old_materials->>'token'", "revoke all", "auth.uid()", "sparta_warehouse_guard_mirrors"]) assert.ok(sql.includes(required), required);
  checks.push("Migration includes locks, ownership checks, audit immutability, conservation and legacy-write guards");
  return { passed: checks.length, checks };
}
if (require.main === module) runTests(process.argv[2]).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = runTests;
