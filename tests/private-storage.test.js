"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function runPrivateStorageTests(projectDirectory = path.resolve(__dirname, "..")) {
  const source = fs.readFileSync(path.join(projectDirectory, "app.js"), "utf8");
  const calls = [];
  let response = async () => ({ data: { signedUrl: "https://storage.example/signed/file?token=private" }, error: null });
  const state = { ready: true, companyId: "company-a", user: { id: "user-a" }, client: { storage: { from(bucket) { return { async createSignedUrl(storagePath, expires) { calls.push({ bucket, storagePath, expires }); return response(); } }; } }, async rpc(name, args) { calls.push({ name, args }); return { data: args.p_expected_revision + 1, error: null }; } } };
  const context = vm.createContext({
    cloudState: state, PHOTO_BUCKET: "project-photos", PROJECT_FILE_BUCKET: "project-files",
    cloudMediaUrls: new Map(), cloudMediaRefreshTimer: null,
    window: { clearTimeout() {}, setTimeout() { return 1; }, SPARTA_LOCAL_WORKSPACE: null },
    Date, Map, projectFilesByProjectId: {}, normalizeProjectId: String, saveProjectFilesByProjectId() {},
    guardedCloudWriteClient() { return state.client; },
  });
  for (const name of ["cloudMediaContext", "clearCloudMediaUrls", "cachedCloudMediaUrl", "signedCloudStorageUrl", "publicPhotoUrl", "publicProjectFileUrl", "saveProjectFileMetadata", "projectMediaPayload", "syncProjectFilesToCloud"]) {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
    assert.ok(match, `Production function ${name} exists`);
    vm.runInContext(match[0], context);
  }
  let passed = 0;
  const check = async (fn) => { await fn(); passed += 1; };
  await check(async () => {
    assert.equal(context.publicPhotoUrl("company-a/p/photo.jpg"), "");
    assert.equal(context.publicProjectFileUrl("https://host/object/public/project-files/secret.pdf"), "");
    assert.doesNotMatch(source, /\/storage\/v1\/object\/public\//);
  });
  await check(async () => {
    const url = await context.signedCloudStorageUrl("project-photos", "company-a/p/photo.jpg");
    assert.match(url, /signed\/file/);
    assert.equal(context.publicPhotoUrl("company-a/p/photo.jpg"), url);
    assert.equal(calls.at(-1).expires, 3600);
    const count = calls.length;
    await context.signedCloudStorageUrl("project-photos", "company-a/p/photo.jpg");
    assert.equal(calls.length, count, "Valid signed URL is reused within the same account");
    await context.signedCloudStorageUrl("project-photos", "company-a/p/photo.jpg", true);
    assert.equal(calls.length, count + 1, "Download refresh requests a new signature");
  });
  await check(async () => {
    for (const storagePath of ["https://bad/path", "data:image/png;base64,abc", "blob:fake", "/absolute/path", "company/../other/file", "company/\nfile"]) {
      await assert.rejects(context.signedCloudStorageUrl("project-files", storagePath), /Некоректний/);
    }
    await assert.rejects(context.signedCloudStorageUrl("untrusted-bucket", "a/b"), /Невідоме/);
  });
  await check(async () => {
    state.ready = false;
    assert.equal(context.publicPhotoUrl("company-a/p/photo.jpg"), "");
    await assert.rejects(context.signedCloudStorageUrl("project-photos", "company-a/p/photo.jpg"), /увійдіть/);
    state.ready = true;
    state.companyId = "company-b";
    assert.equal(context.publicPhotoUrl("company-a/p/photo.jpg"), "");
    state.companyId = "company-a";
  });
  await check(async () => {
    let resolve;
    response = () => new Promise((done) => { resolve = done; });
    const pending = context.signedCloudStorageUrl("project-photos", "company-a/p/late.jpg");
    state.companyId = "company-b";
    resolve({ data: { signedUrl: "https://storage.example/old-account" }, error: null });
    await assert.rejects(pending, /Обліковий запис змінився/);
    state.companyId = "company-a";
    assert.equal(context.publicPhotoUrl("company-a/p/late.jpg"), "");
    response = async () => ({ data: null, error: new Error("Access denied") });
    await assert.rejects(context.signedCloudStorageUrl("project-files", "company-a/p/denied"), /Access denied/);
  });
  await check(async () => {
    context.saveProjectFileMetadata({ id: "p", files: [{ storagePath: "company-a/p/file.pdf", src: "https://signed?secret", fileName: "file.pdf", stage: "contract", crmTaskId: "task", cashEntryId: "cash" }] });
    const saved = context.projectFilesByProjectId.p[0];
    assert.equal(saved.storagePath, "company-a/p/file.pdf");
    assert.equal(saved.src, "");
    assert.equal(saved.stage, "contract");
    assert.equal(saved.crmTaskId, "task");
    assert.equal(saved.cashEntryId, "cash");
  });
  await check(async () => {
    const project = { files: [{ storagePath: "company-a/p/file.pdf", fileName: "file.pdf", stage: "contract", crmTaskId: "task", cashEntryId: "cash", documentNumber: "D-1" }] };
    await context.syncProjectFilesToCloud(project, "uuid-project");
    const call = calls.at(-1);
    assert.equal(call.name, "replace_project_media");
    assert.equal(call.args.p_expected_revision, 0);
    assert.deepEqual(Array.from(call.args.p_photos), []);
    assert.equal(call.args.p_files[0].app_data.documentNumber, "D-1");
    assert.equal(call.args.p_files[0].app_data.cashEntryId, "cash");
    assert.equal(project.mediaRevision, 1);
    const count = calls.length;
    await context.syncProjectFilesToCloud(project, "uuid-project");
    assert.equal(calls.length, count, "Untouched media do not overwrite another device's updates");
    project.files[0].note = "An actual edit";
    state.client.rpc = async () => ({ error: { message: "Database unavailable" } });
    await assert.rejects(context.syncProjectFilesToCloud(project, "uuid-project"), /не збережено.*Database unavailable/);
    state.client.rpc = async () => ({ error: { code: "40001", message: "Stale media revision" } });
    await assert.rejects(context.syncProjectFilesToCloud(project, "uuid-project"), /іншому пристрої/);
    assert.equal(project.mediaRevision, 1, "Rejected stale save cannot advance the revision or clear the local edit");
    assert.equal(project.files[0].note, "An actual edit");
  });
  await check(async () => {
    const sql = fs.readFileSync(path.join(projectDirectory, "database/private-storage.sql"), "utf8");
    assert.match(sql, /warehouse-files[\s\S]*false/);
    assert.equal((sql.match(/on storage\.objects as restrictive/g) || []).length, 4);
    assert.match(sql, /create or replace function public\.replace_project_media/);
    assert.match(sql, /has_company_role\(v_company/);
    assert.match(sql, /revoke all on function public\.replace_project_media/);
  });
  return { passed };
}
module.exports = runPrivateStorageTests;
if (require.main === module) runPrivateStorageTests(process.argv[2]).then(console.log).catch((error) => { console.error(error); process.exitCode = 1; });
