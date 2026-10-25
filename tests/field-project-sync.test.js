"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function runFieldProjectSyncTests(projectDirectory = path.resolve(__dirname, "..")) {
  const source = fs.readFileSync(path.join(projectDirectory, "app.js"), "utf8");
  const calls = [], alerts = [];
  let remote = { id: "db-project", work_checklist: { marking: false, mounting_system: true }, data_revision: 4 };
  let rpcError = null;
  const client = {
    from(table) {
      calls.push({ kind: "from", table });
      const chain = { select(columns) { calls.push({ kind: "select", columns }); return chain; }, eq() { return chain; }, async maybeSingle() { return { data: remote, error: null }; } };
      return chain;
    },
    async rpc(name, args) {
      calls.push({ kind: "rpc", name, args });
      if (rpcError) return { error: rpcError };
      remote = { ...remote, work_checklist: { ...remote.work_checklist, ...args.p_changes }, data_revision: remote.data_revision + 1 };
      return { data: { checklist: remote.work_checklist, dataRevision: remote.data_revision } };
    },
  };
  const context = vm.createContext({
    window: {}, cloudContextRevision: 0, cloudState: { ready: true, memberRole: "installer", companyId: "company" },
    installerChecklistItemIds: ["marking", "mounting_system"], projects: [],
    guardedCloudWriteClient() { return client; }, normalizeProjectId: String,
    async syncProjectFilesToCloud(project, id) { calls.push({ kind: "media", project, id }); },
    renderProfileView() {}, alert(text) { alerts.push(text); }, Date,
  });
  for (const name of ["normalizeFieldChecklist", "canEditProjectData", "canEditProjectField", "requireProjectRole", "guardProjectRoleAction", "syncFieldProjectsToCloud", "syncProjectsCloudBatch", "syncProjectsToCloud", "addMaterial", "saveProjectFinance"]) {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
    assert.ok(match, name); vm.runInContext(match[0], context);
  }
  for (const name of ["officeProjectControls", "fieldProjectControls"]) vm.runInContext(source.match(new RegExp(`const ${name} = [^\\n]+;`))[0], context);
  let passed = 0;
  const check = async (test) => { await test(); passed += 1; };
  await check(async () => {
    const project = { id: "p", workChecklist: { marking: true, mounting_system: false }, fieldChecklistBase: { marking: false, mounting_system: false } };
    context.projects = [project];
    await context.syncProjectsToCloud();
    const call = calls.find((item) => item.kind === "rpc");
    assert.equal(call.name, "update_project_field_checklist");
    assert.deepEqual(JSON.parse(JSON.stringify(call.args.p_changes)), { marking: true });
    assert.deepEqual(JSON.parse(JSON.stringify(call.args.p_expected)), { marking: false });
    assert.equal(project.workChecklist.mounting_system, true, "Independent remote progress is preserved");
    assert.equal(project.dataRevision, 5);
    assert.equal(calls.filter((item) => item.kind === "media").length, 1, "Photos/files still use the established CAS adapter");
    assert.ok(calls.filter((item) => item.kind === "from").every((item) => item.table === "projects"));
    assert.ok(calls.filter((item) => item.kind === "select").every((item) => !/finance|technical/.test(item.columns)));
  });
  await check(async () => {
    calls.length = 0;
    await context.syncProjectsToCloud();
    assert.equal(calls.filter((item) => item.kind === "rpc").length, 0, "Unchanged checklist is never resent");
    assert.equal(calls.filter((item) => item.kind === "media").length, 1);
  });
  await check(async () => {
    calls.length = 0; rpcError = { code: "40001", message: "Concurrent update" };
    context.projects[0].workChecklist.marking = false;
    await assert.rejects(context.syncProjectsToCloud(), /іншому пристрої/);
    assert.equal(context.projects[0].workChecklist.marking, false);
    assert.equal(context.projects[0].fieldChecklistBase.marking, true);
    assert.equal(calls.filter((item) => item.kind === "media").length, 0);
    rpcError = null;
  });
  await check(async () => {
    const normalRpc = client.rpc;
    let resolve;
    let notifyStarted;
    const started = new Promise((done) => { notifyStarted = done; });
    client.rpc = async () => new Promise((done) => { resolve = done; notifyStarted(); });
    const pending = context.syncProjectsToCloud();
    await started;
    assert.ok(resolve);
    context.projects[0].workChecklist.marking = true;
    resolve({ data: { checklist: { marking: false, mounting_system: true }, dataRevision: 6 } });
    await pending;
    assert.equal(context.projects[0].workChecklist.marking, true, "A new in-flight user edit is not erased by an earlier response");
    assert.equal(context.projects[0].fieldChecklistBase.marking, false);
    client.rpc = normalRpc;
  });
  await check(async () => {
    for (const role of ["warehouse", "viewer"]) {
      context.cloudState.memberRole = role; calls.length = 0;
      await context.syncProjectsToCloud(); assert.equal(calls.length, 0);
      assert.equal(context.canEditProjectData(), false); assert.equal(context.canEditProjectField(), false);
    }
    context.cloudState.memberRole = "installer";
    assert.equal(context.canEditProjectData(), false); assert.equal(context.canEditProjectField(), true);
    for (const role of ["owner", "admin", "engineer", "brigadier"]) { context.cloudState.memberRole = role; assert.equal(context.canEditProjectData(), true); }
    context.cloudState.ready = false; assert.equal(context.canEditProjectData(), false);
    context.window.SPARTA_LOCAL_WORKSPACE = { enabled: true }; assert.equal(context.canEditProjectData(), true);
    context.window.SPARTA_LOCAL_WORKSPACE = null; context.cloudState.ready = true;
  });
  await check(async () => {
    context.cloudState.memberRole = "installer";
    context.addMaterial({}); context.saveProjectFinance({});
    assert.equal(alerts.length, 2, "Direct mutators reject edits unavailable for the current role");
    let prevented = 0;
    context.guardProjectRoleAction({ target: { closest(selector) { return selector.includes("#projectForm") ? {} : null; } }, preventDefault() { prevented += 1; }, stopImmediatePropagation() { prevented += 1; } });
    assert.equal(prevented, 2);
    prevented = 0;
    context.guardProjectRoleAction({ target: { closest(selector) { return selector.includes("#photoForm") ? {} : null; } }, preventDefault() { prevented += 1; }, stopImmediatePropagation() { prevented += 1; } });
    assert.equal(prevented, 0, "Installer uploads remain enabled");
    context.cloudState.memberRole = "viewer";
    context.guardProjectRoleAction({ target: { closest(selector) { return selector.includes("#photoForm") ? {} : null; } }, preventDefault() { prevented += 1; }, stopImmediatePropagation() { prevented += 1; } });
    assert.equal(prevented, 2);
  });
  return { passed };
}
module.exports = runFieldProjectSyncTests;
if (require.main === module) runFieldProjectSyncTests(process.argv[2]).then(console.log).catch((error) => { console.error(error); process.exitCode = 1; });
