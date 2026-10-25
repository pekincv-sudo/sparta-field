"use strict";
// Optional real PostgreSQL verification. PGlite is a development-only dependency
// supplied by PGLITE_MODULE; no package is shipped to the browser or production.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");

async function runTests(directory = path.resolve(__dirname, ".."), baseSchema = process.env.SPARTA_BASE_SCHEMA) {
  if (!baseSchema) throw new Error("Set SPARTA_BASE_SCHEMA to the existing database/schema.sql fixture.");
  const core = require(path.join(directory, "warehouse-core.js"));
  const db = new PGlite();
  const company = "11111111-1111-1111-1111-111111111111";
  const otherCompany = "11111111-1111-1111-1111-111111111112";
  const owner = "22222222-2222-2222-2222-222222222222";
  const installer = "22222222-2222-2222-2222-222222222223";
  const outsider = "22222222-2222-2222-2222-222222222224";
  const warehouse = "22222222-2222-2222-2222-222222222225";
  const viewer = "22222222-2222-2222-2222-222222222226";
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const checks = [];
  try {
    await db.exec(`create schema auth; create role anon; create role authenticated;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.email() returns text language sql stable as $$ select ''::text $$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid(),auth.email() to authenticated,anon;`);
    const schema = fs.readFileSync(baseSchema, "utf8").replace('create extension if not exists "pgcrypto";', "");
    await db.exec(schema);
    // Supabase grants these by default. Apply before migration to verify its
    // explicit revoke and real RLS behavior under SET ROLE authenticated.
    await db.exec("grant select,insert,update,delete on all tables in schema public to authenticated;");
    await db.exec(fs.readFileSync(path.join(directory, "database/warehouse-cloud.sql"), "utf8"));
    checks.push("Migration compiles against the original production schema");
    await db.query("insert into public.companies(id,name) values($1,'Company'),($2,'Other company')", [company, otherCompany]);
    for (const [id, role, memberCompany] of [[owner, "owner", company], [installer, "installer", company], [outsider, "owner", otherCompany], [warehouse, "warehouse", company], [viewer, "viewer", company]]) {
      await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${role}@example.invalid`]);
      await db.query("insert into public.profiles(id,full_name) values($1,$2)", [id, role]);
      await db.query("insert into public.company_members(company_id,user_id,role) values($1,$2,$3)", [memberCompany, id, role]);
    }
    await db.query("insert into public.projects(company_id,client_id,title) values($1,'project','Station'),($2,'foreign-project','Other station')", [company, otherCompany]);
    await db.query("insert into public.warehouse_items(company_id,client_item_id,category,name,sku,unit,quantity,purchase_price,sale_price,min_quantity,app_data) values($1,'cable','Кабелі','Cable','C6','м',2.375,20,0,0,$2)", [company, { brand: "Cable maker", powerW: 0, qty: 2.375, installerPrice: 0, serialNumbers: [] }]);
    async function identity(user, role = "authenticated") {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || ""]);
      await db.exec(`set role ${role}`);
    }
    const read = async (companyId = company) => (await db.query("select public.sparta_warehouse_read($1) as data", [companyId])).rows[0].data;
    let state;
    const write = async (nextState, updates = [], revision = state.revision, requestId = crypto.randomUUID()) =>
      (await db.query("select public.sparta_warehouse_write($1,$2,$3,$4,$5) as data", [company, requestId, revision, nextState, updates])).rows[0].data;
    async function rejected(callback, pattern) {
      const before = await read();
      await assert.rejects(callback, pattern);
      assert.deepEqual(await read(), before, "Rejected posting must roll back every warehouse/material row");
    }
    await identity(owner);
    state = await read();
    assert.equal(state.state.items[0].qty, 2.375);
    assert.equal(state.state.items[0].brand, "Cable maker");
    checks.push("Existing company rows seed full metadata and fractional stock without browser data");
    let next = clone(state.state);
    next.items.push({ id: "panel", name: "Panel", category: "Фотомодулі", sku: "PV", unit: "шт", qty: 0, minQty: 0, purchasePrice: 0, retailPrice: 200, salePrice: 200, installerPrice: 140, brand: "Panels", powerW: 450, serialNumbers: [] });
    state = await write(next);
    const receipt = core.postReceipt(state.state, { id: "receipt", number: "R-1", date: "2026-10-25", supplier: "Vendor", createdAt: "2026-10-25T09:00:00Z", createdBy: "forged-user", lines: [{ itemId: "panel", qty: 4, purchasePrice: 100, deliveryCost: 5 }] });
    const requestId = crypto.randomUUID();
    const priorRevision = state.revision;
    state = await write({ ...state.state, ...receipt }, [], priorRevision, requestId);
    assert.equal(state.state.items.find((item) => item.id === "panel").qty, 4);
    assert.equal(state.state.documents[0].createdBy, owner);
    assert.ok(state.state.documents[0].recordedAt);
    const afterReceipt = clone(state);
    assert.deepEqual(await write({ ...state.state, ...receipt }, [], priorRevision, requestId), afterReceipt);
    checks.push("Receipt, server audit identity and idempotent lost-response retry work in PostgreSQL");
    await rejected(() => write(state.state, [], priorRevision), /revision changed/);
    checks.push("A second device using an older revision cannot overwrite the warehouse");
    next = clone(state.state);
    next.reservations.push({ id: "reserve", itemId: "panel", projectId: "project", qty: 3 });
    next.documents.unshift({ id: "reserve-doc", type: "reserve", status: "posted", lines: [{ itemId: "panel", qty: 3 }] });
    state = await write(next);
    next = clone(state.state); next.reservations.push({ id: "over", itemId: "panel", projectId: "project", qty: 2 });
    await rejected(() => write(next), /Reservations exceed/);
    checks.push("Reservations are atomic and their total cannot exceed physical stock");
    const material = { warehouseItemId: "panel", name: "Panel", category: "Фотомодулі", unit: "шт", plannedQty: 2, issuedQty: 2, actualQty: 0, purchasePriceSnapshot: 105, salePriceSnapshot: 140 };
    next = clone(state.state); next.items.find((item) => item.id === "panel").qty = 2;
    next.reservations = core.consumeReservation(next.reservations, "panel", "project", 2);
    next.documents.unshift({ id: "issue-doc", type: "project", status: "posted", lines: [{ itemId: "panel", qty: 2 }] });
    next.movements.unshift({ id: "issue-move", type: "project", itemId: "panel", projectId: "project", qty: 2, unitCost: 105, materialSalePrice: 140, documentId: "issue-doc" });
    const oldMaterialToken = state.projectMaterials[0].token;
    state = await write(next, [{ id: "project", token: oldMaterialToken, materials: [material] }]);
    assert.equal(state.projectMaterials[0].materials[0].issuedQty, 2);
    assert.equal(state.projectMaterials[0].materials[0].actualQty, 0);
    assert.equal(state.state.reservations[0].qty, 1);
    const mirrored = await db.query("select app_data from public.project_materials where name='Panel'");
    assert.equal(mirrored.rows[0].app_data.purchasePriceSnapshot, 105);
    checks.push("Issue commits stock, reservation, material quantities and historical costs together");
    await rejected(() => write(state.state, [{ id: "project", token: oldMaterialToken, materials: [material] }]), /Materials changed/);
    next = clone(state.state); next.items.find((item) => item.id === "panel").qty = 0;
    await rejected(() => write(next), /matching document movements/);
    next = clone(state.state); next.documents = next.documents.filter((doc) => doc.id !== "receipt");
    await rejected(() => write(next), /history is immutable/);
    next = clone(state.state); next.movements[0].qty = 3;
    await rejected(() => write(next), /history is immutable/);
    checks.push("Stale material tokens, unjournaled stock changes and history tampering roll back completely");
    next = clone(state.state); next.items.find((item) => item.id === "panel").purchasePrice = 1;
    await rejected(() => write(next), /Inventory value changes/);
    checks.push("Stock valuation cannot be changed through a catalog edit with existing inventory");
    await rejected(() => write(state.state, [{ id: "project", token: state.projectMaterials[0].token, materials: [{ ...material, purchasePriceSnapshot: 1 }] }]), /Historical material cost snapshots/);
    await rejected(() => write(state.state, [{ id: "project", token: state.projectMaterials[0].token, materials: [{ ...material, salePriceSnapshot: 1 }] }]), /Historical material cost snapshots/);
    await rejected(() => write(state.state, [{ id: "project", token: state.projectMaterials[0].token, materials: [{ ...material, actualQty: 1 }] }]), /matching warehouse documents/);
    checks.push("Issued costs and installed quantity cannot be rewritten by an ordinary object-form save");
    next = clone(state.state);
    next.documents.unshift({ id: "consume-doc", type: "consume", status: "posted", lines: [{ itemId: "panel", qty: 1 }] });
    next.movements.unshift({ id: "consume-move", type: "consume", itemId: "panel", projectId: "project", qty: 1, unitCost: 105, materialSalePrice: 140, documentId: "consume-doc" });
    const used = { ...material, actualQty: 1 };
    state = await write(next, [{ id: "project", token: state.projectMaterials[0].token, materials: [used] }]);
    assert.equal(state.state.items.find((item) => item.id === "panel").qty, 2);
    next = clone(state.state); next.items.find((item) => item.id === "panel").qty = 3;
    next.documents.unshift({ id: "return-doc", type: "return", status: "posted", lines: [{ itemId: "panel", qty: 1 }] });
    next.movements.unshift({ id: "return-move", type: "return", itemId: "panel", projectId: "project", qty: 1, unitCost: 105, materialSalePrice: 140, documentId: "return-doc" });
    state = await write(next, [{ id: "project", token: state.projectMaterials[0].token, materials: [{ ...used, issuedQty: 1 }] }]);
    assert.equal(state.projectMaterials[0].materials[0].issuedQty, 1);
    assert.equal(state.projectMaterials[0].materials[0].actualQty, 1);
    assert.equal(state.state.items.find((item) => item.id === "panel").qty, 3);
    checks.push("Consumption does not decrement stock twice; return preserves already-installed quantities/costs");
    next = clone(state.state); next.reservations = [];
    state = await write(next);
    const stocktake = core.postStocktake(state.state, { id: "stocktake", number: "ST-1", date: "2026-10-25", reason: "Count", lines: [{ itemId: "panel", countedQty: 2 }] });
    state = await write({ ...state.state, ...stocktake });
    assert.equal(state.state.items.find((item) => item.id === "panel").qty, 2);
    const plan = { ...state.projectMaterials[0].materials[0], plannedQty: 5 };
    state = await write(state.state, [{ id: "project", token: state.projectMaterials[0].token, materials: [plan] }]);
    assert.equal(state.projectMaterials[0].materials[0].plannedQty, 5);
    checks.push("Stocktake posts a signed adjustment; planned quantity remains editable without changing issued stock");
    await assert.rejects(db.query("update public.warehouse_items set quantity=999 where client_item_id='panel'"), /Use sparta_warehouse_write/);
    await assert.rejects(db.query("delete from public.project_materials where name='Panel'"), /Use sparta_warehouse_write/);
    await assert.rejects(db.query("select * from public.warehouse_workspaces"), /permission denied/);
    checks.push("Older app tabs cannot bypass posting by direct catalog/material writes or access internal tables");
    await identity(installer);
    assert.equal((await read()).revision, state.revision);
    await assert.rejects(() => write(state.state), /Only an active company/);
    await identity(warehouse);
    assert.equal((await read()).revision, state.revision);
    state = await write(state.state);
    checks.push("Installer has staff read access; the warehouse role can post according to the existing role model");
    await identity(viewer);
    assert.equal((await read()).revision, state.revision);
    await assert.rejects(() => write(state.state), /Only an active company/);
    checks.push("Existing viewer membership keeps company read access without warehouse posting permission");
    await identity(outsider);
    await assert.rejects(() => read(), /Active staff membership required/);
    await assert.rejects(() => write(state.state), /Only an active company/);
    const rows = await db.query("select * from public.warehouse_items where company_id=$1", [company]);
    assert.equal(rows.rows.length, 0);
    await identity(null, "anon");
    await assert.rejects(() => read(), /permission denied/);
    await assert.rejects(() => write(state.state), /permission denied/);
    checks.push("RLS/RPC grants deny anonymous access and cross-company reads/writes");
    return { passed: checks.length, checks };
  } finally { await db.close(); }
}
if (require.main === module) runTests(process.argv[2], process.argv[3]).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = runTests;
