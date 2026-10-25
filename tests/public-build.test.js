"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

async function runPublicBuildTests(projectDirectory = path.resolve(__dirname, "..")) {
  let passed = 0;
  const source = fs.readFileSync(path.join(projectDirectory, "sw.js"), "utf8");
  const handlers = {};
  const writes = [];
  let status = 200;
  let intercepted = 0;
  const context = vm.createContext({
    URL, Set, Response,
    self: { location: { origin: "https://sparta.example" }, addEventListener(type, callback) { handlers[type] = callback; } },
    caches: { async open() { return { async put(key) { writes.push(key); } }; }, async match() { return null; } },
    async fetch() { return { ok: status === 200, type: "basic", status, clone() { return this; } }; },
  });
  vm.runInContext(source, context);
  for (const url of ["https://sparta.example/api/private", "https://sparta.example/documents/receipt.pdf", "https://sparta.example/public-update-sparta-field.zip", "https://supabase.example/storage/signed?token=secret"]) {
    handlers.fetch({ request: { method: "GET", url, mode: "navigate" }, respondWith() { intercepted += 1; } });
  }
  assert.equal(intercepted, 0, "Private/API/unknown requests never enter the service-worker cache"); passed += 1;
  const dispatch = async () => {
    let response;
    const lifetime = [];
    handlers.fetch({ request: { method: "GET", url: "https://sparta.example/app.js?v=34" }, respondWith(promise) { response = promise; }, waitUntil(promise) { lifetime.push(promise); } });
    await response; await Promise.all(lifetime);
  };
  await dispatch();
  assert.deepEqual(writes, ["/app.js"]); passed += 1;
  status = 500; await dispatch();
  assert.equal(writes.length, 1, "Failed requests cannot overwrite the working offline shell"); passed += 1;

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sparta-build-test-"));
  try {
    const script = fs.readFileSync(path.join(projectDirectory, "scripts/build-public.js"), "utf8");
    const list = script.match(/const files = (\[[\s\S]*?\]);/)[1];
    const files = vm.runInNewContext(list);
    fs.mkdirSync(path.join(temporary, "scripts"));
    fs.writeFileSync(path.join(temporary, "scripts/build-public.js"), script);
    for (const file of files) { const target = path.join(temporary, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, "runtime"); }
    fs.writeFileSync(path.join(temporary, "public-update-sparta-field.zip"), "private source archive");
    fs.mkdirSync(path.join(temporary, "database")); fs.writeFileSync(path.join(temporary, "database/private.sql"), "private sql");
    execFileSync(process.execPath, [path.join(temporary, "scripts/build-public.js")]);
    for (const file of files) assert.ok(fs.existsSync(path.join(temporary, "public-build", file)), `Runtime ${file} is included`);
    assert.equal(fs.existsSync(path.join(temporary, "public-build/public-update-sparta-field.zip")), false);
    assert.equal(fs.existsSync(path.join(temporary, "public-build/database")), false);
    passed += 1;
    fs.unlinkSync(path.join(temporary, "warehouse-cloud.js"));
    assert.throws(() => execFileSync(process.execPath, [path.join(temporary, "scripts/build-public.js")], { stdio: "pipe" }), "Missing required adapter aborts the release build");
    passed += 1;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  const config = JSON.parse(fs.readFileSync(path.join(projectDirectory, "vercel.json"), "utf8"));
  assert.equal(config.outputDirectory, "public-build");
  assert.equal(config.buildCommand, "node scripts/build-public.js"); passed += 1;
  return { passed };
}
module.exports = runPublicBuildTests;
if (require.main === module) runPublicBuildTests(process.argv[2]).then(console.log).catch((error) => { console.error(error); process.exitCode = 1; });
