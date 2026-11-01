"use strict";

// Real PostgreSQL/RLS verification in an isolated PGlite database. No live data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

async function run(PGlite, root = path.resolve(__dirname, ".."), base = process.env.SPARTA_BASE_SCHEMA) {
  if (!base) throw new Error("SPARTA_BASE_SCHEMA is required");
  const db = new PGlite(), checks = [], uuid = () => crypto.randomUUID(), clone = x => JSON.parse(JSON.stringify(x));
  const company = uuid(), foreignCompany = uuid();
  const ids = Object.fromEntries(["owner", "warehouse", "engineer", "installer", "viewer", "otherOwner"].map(name => [name, uuid()]));
  const core = require(path.join(root, "installation-core.js"));
  let stage = "setup", response;
  const login = async (name, role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids[name] || ""]);
    await db.exec("set role " + role);
    activeUser = name;
  };
  const internal = async () => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub','',false)"); };
  const read = async () => (await db.query("select public.sparta_warehouse_read($1) data", [company])).rows[0].data;
  const state = () => ({ ...clone(response.state), orderReservations: clone(response.orderReservations || []), projects: response.projectMaterials.map(row => ({ id: row.id, title: row.id, currency: "USD", materials: clone(row.materials) })) });
  const write = async (next, requestId = uuid(), revision = response.revision, updates) => {
    const nextState = Object.fromEntries(["version", "items", "movements", "documents", "reservations"].map(key => [key, next[key]]));
    const materialUpdates = updates || (next.projects || []).flatMap(project => {
      const old = response.projectMaterials.find(row => row.id === project.id);
      return JSON.stringify(project.materials) === JSON.stringify(old.materials) ? [] : [{ id: project.id, token: old.token, materials: project.materials }];
    });
    return (await db.query("select public.sparta_warehouse_write($1,$2,$3,$4,$5) data", [company, requestId, revision, nextState, materialUpdates])).rows[0].data;
  };
  const digest = async () => {
    const output = {};
    for (const table of ["warehouse_workspaces", "warehouse_items", "warehouse_requests", "projects", "project_materials", "cash_transactions", "buyer_stock_holds"]) {
      output[table] = (await db.query(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text) digest from public.${table} t`)).rows[0].digest;
    }
    return output;
  };
  const rejected = async (fn, pattern) => {
    const before = await read();
    await assert.rejects(fn, pattern);
    assert.deepEqual(await read(), before, "Rejected completion must roll back stock, documents and materials");
  };
  let activeUser = "owner";
  const complete = (projectId, qty = 3) => core.complete(state(), { projectId, completedOn: "2026-01-01", today: "2026-01-02", lines: [{ itemId: "panel", qty }], actor: { id: ids[activeUser], name: activeUser }, recordedAt: "2026-01-01T12:00:00Z" });
  try {
    await db.exec(`create schema auth;create schema storage;create role anon;create role authenticated;create role service_role;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.email() returns text language sql stable as $$select ''::text$$;
      grant usage on schema auth,storage to anon,authenticated,service_role;
      grant execute on function auth.uid(),auth.email() to anon,authenticated,service_role;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;`);
    await db.exec(fs.readFileSync(base, "utf8").replace('create extension if not exists "pgcrypto";', ""));
    await db.exec("grant select,insert,update,delete on all tables in schema public,storage to authenticated");
    await db.query("insert into public.companies(id,name) values($1,'SPARTA'),($2,'Other')", [company, foreignCompany]);
    for (const [name, id] of Object.entries(ids)) {
      await db.query("insert into auth.users values($1,$2,now())", [id, name + "@example.invalid"]);
      await db.query("insert into public.profiles(id,email,full_name) values($1,$2,$3)", [id, name + "@example.invalid", name]);
      await db.query("insert into public.company_members(company_id,user_id,role) values($1,$2,$3)", [name === "otherOwner" ? foreignCompany : company, id, name === "otherOwner" ? "owner" : name]);
    }
    for (const file of ["release34-base.sql", "project-save.sql", "warehouse-cloud.sql", "cash-transactions.sql", "private-storage.sql", "field-project-sync.sql", "currency-usd-build35.sql", "team-build36.sql", "buyer-portal.sql", "sales-cash-build47.sql"]) {
      await db.exec(fs.readFileSync(path.join(root, "database", file), "utf8"));
    }
    await internal();
    await db.query("select set_config('sparta.project_write_company',$1,false)", [company]);
    for (const name of ["fresh", "issued", "extra", "future", "shortage", "wrongcost", "metadatadone", "otherproject", "oldtamper", "omitted"]) {
      await db.query("insert into public.projects(company_id,client_id,title,currency) values($1,$2,$2,'USD')", [company, name]);
    }
    await db.query("select set_config('sparta.project_write_company',$1,false)", [foreignCompany]);
    await db.query("insert into public.projects(company_id,client_id,title,currency) values($1,'foreign','Foreign','USD')", [foreignCompany]);
    await db.query("select set_config('sparta.warehouse_rpc','on',false)");
    await db.query("insert into public.warehouse_items(company_id,client_item_id,category,name,sku,unit,quantity,purchase_price,sale_price,min_quantity,app_data) values($1,'panel','Фотомодулі','Panel','PV','шт',40,100,180,0,$2),($1,'uah','Фотомодулі','UAH panel','UAH','шт',10,200,300,0,$3)", [company, { currency: "USD", installerPrice: 150, serialNumbers: [] }, { currency: "UAH", installerPrice: 250, serialNumbers: [] }]);
    for (const [name, issuedQty, actualQty, cost] of [["issued", 5, 2, 80], ["extra", 5, 2, 80], ["metadatadone", 2, 2, 100], ["oldtamper", 5, 2, 80], ["omitted", 2, 2, 100]]) {
      await db.query("insert into public.project_materials(project_id,category,name,unit,quantity,app_data) select id,'Фотомодулі','Panel','шт',$3,$4 from public.projects where company_id=$1 and client_id=$2", [company, name, actualQty, { name: "Panel", category: "Фотомодулі", unit: "шт", currency: "USD", warehouseItemId: "panel", plannedQty: issuedQty, issuedQty, actualQty, purchasePriceSnapshot: cost, salePriceSnapshot: 130 }]);
    }
    await db.query("insert into public.project_materials(project_id,category,name,unit,quantity,app_data) select id,'Фотомодулі','Legacy unlinked equipment','шт',1,$2 from public.projects where company_id=$1 and client_id='omitted'", [company, { name: "Legacy unlinked equipment", unit: "шт", currency: "USD", plannedQty: 1, issuedQty: 1, actualQty: 1, warehouseItemId: "", purchasePriceSnapshot: 10, salePriceSnapshot: 20 }]);
    await db.query("select set_config('sparta.project_write_company','',false),set_config('sparta.warehouse_rpc','',false)");
    await login("owner"); response = await read();
    // Exercise migration against a populated workspace and a real cash row.
    response = await write({ ...state(), reservations: [{ id: "otherhold", projectId: "otherproject", itemId: "panel", qty: 2 }] });
    await db.query("insert into public.cash_transactions(company_id,project_client_id,project_title,direction,category,amount_minor,counterparty,purpose,currency) values($1,'fresh','Fresh','income','client_payment',12345,'Client','Deposit','USD')", [company]);
    await internal();
    const beforeMigration = await digest();
    const migration = fs.readFileSync(path.join(root, "database/installation-completion.sql"), "utf8");
    await db.exec(migration); await db.exec(migration);
    assert.deepEqual(await digest(), beforeMigration);
    checks.push("Migration compiles and reapplies without changing existing stock, cash, projects or buyer holds");
    await login("owner"); response = await read();

    stage = "first issue and consume";
    const first = complete("fresh", 3), request = uuid(), revision = response.revision;
    response = await write(first, request);
    assert.equal(response.state.items.find(x => x.id === "panel").qty, 37);
    let material = response.projectMaterials.find(x => x.id === "fresh").materials[0];
    assert.equal(material.issuedQty, 3); assert.equal(material.actualQty, 3); assert.equal(material.purchasePriceSnapshot, 100);
    assert.deepEqual(response.state.reservations, [{ id: "otherhold", projectId: "otherproject", itemId: "panel", qty: 2 }]);
    const completionDoc = response.state.documents.find(x => x.kind === "installation_completion");
    assert.equal(completionDoc.completedOn, "2026-01-01"); assert.equal(completionDoc.createdBy, ids.owner);
    assert.equal(completionDoc.actor.id, ids.owner);
    assert.notEqual(completionDoc.recordedAt, first.document.recordedAt);
    assert.equal(response.state.movements.filter(x => x.documentId === completionDoc.id).length, 2);
    checks.push("First installation atomically issues only missing goods and consumes them with authoritative audit identity");
    const afterFirst = clone(response);
    assert.deepEqual(await write(first, request, revision), afterFirst);
    checks.push("Lost-response retry returns the original completion without duplicate warehouse deduction");

    stage = "old issue stock unchanged";
    response = await write(complete("issued", 5));
    assert.equal(response.state.items.find(x => x.id === "panel").qty, 37);
    material = response.projectMaterials.find(x => x.id === "issued").materials[0];
    assert.equal(material.actualQty, 5); assert.equal(material.purchasePriceSnapshot, 80);
    checks.push("Five already-issued goods with two installed become five installed without second stock deduction");

    stage = "additional issue weighted cost";
    response = await write(complete("extra", 6));
    assert.equal(response.state.items.find(x => x.id === "panel").qty, 36);
    material = response.projectMaterials.find(x => x.id === "extra").materials[0];
    assert.equal(material.issuedQty, 6); assert.equal(material.actualQty, 6); assert.equal(material.purchasePriceSnapshot, 500 / 6);
    assert.equal(response.state.movements.find(x => x.projectId === "extra" && x.type === "consume").unitCost, 80);
    checks.push("Additional unit uses current stock cost, preserves old consume cost and updates weighted project valuation");

    stage = "metadata-only completion";
    const priorQuantity = response.state.items.find(x => x.id === "panel").qty;
    response = await write(complete("metadatadone", 2));
    assert.equal(response.state.items.find(x => x.id === "panel").qty, priorQuantity);
    assert.equal(response.state.movements.filter(x => x.projectId === "metadatadone").length, 0);
    checks.push("Already-installed goods accept actual completion date without fake stock movements or material rewrite");

    stage = "future and malformed dates";
    let forged = complete("future", 1); forged.documents[0].completedOn = "2999-01-01";
    await rejected(() => write(forged), /future/);
    forged = complete("future", 1); forged.documents[0].completedOn = "2026-02-31";
    await rejected(() => write(forged), /date|range/);
    checks.push("Server rejects future and impossible dates even if browser validation is bypassed");

    stage = "duplicate and quantities";
    forged = state(); const duplicate = clone(forged.documents.find(x => x.projectId === "fresh" && x.kind === "installation_completion"));
    duplicate.id = "duplicate-completion"; forged.documents.unshift(duplicate);
    await rejected(() => write(forged), /already been completed/);
    forged = complete("future", 1); forged.documents[0].finalLines[0].qty = 2;
    await rejected(() => write(forged), /actual installed quantities/);
    forged = complete("future", 1); forged.documents[0].finalLines[0].unit = "м";
    await rejected(() => write(forged), /currency and unit/);
    checks.push("Duplicate project completion and forged final quantities or units roll back atomically");

    forged = complete("future", 1); forged.documents[0].actor.id = ids.warehouse;
    await rejected(() => write(forged), /actor must match the authenticated user/);
    forged = complete("future", 1); delete forged.documents[0].actor;
    await rejected(() => write(forged), /actor must match the authenticated user/);
    checks.push("Nested actor cannot impersonate another staff member or be omitted; audit time is server-owned");

    forged = state();
    const omitted = clone(forged.documents.find(x => x.projectId === "metadatadone" && x.kind === "installation_completion"));
    omitted.id = "omitted-equipment"; omitted.projectId = "omitted"; forged.documents.unshift(omitted);
    await rejected(() => write(forged), /include all actual equipment/);
    forged = complete("future", 1); forged.documents[0].projectId = "foreign";
    await rejected(() => write(forged), /does not belong to company/);
    checks.push("Completion cannot hide legacy actual equipment or attach the document to another company");

    stage = "cost, currency, materials token";
    forged = complete("wrongcost", 1); forged.movements.find(x => x.projectId === "wrongcost" && x.type === "consume").unitCost = 1;
    await rejected(() => write(forged), /matching atomic issue cost/);
    forged = complete("oldtamper", 5); forged.movements.find(x => x.projectId === "oldtamper" && x.type === "consume").unitCost = 1;
    await rejected(() => write(forged), /original material cost snapshots/);
    forged = complete("wrongcost", 1); delete forged.documents[0].kind;
    await rejected(() => write(forged), /original material cost snapshots/);
    checks.push("Existing cost snapshots stay immutable and ordinary documents cannot bypass the first-issue guard");
    forged = complete("wrongcost", 1); forged.items.find(x => x.id === "panel").serialTracking = true;
    await rejected(() => write(forged), /serial-number handling/);
    forged = complete("wrongcost", 1); forged.projects.find(x => x.id === "wrongcost").materials[0].unit = "м";
    await rejected(() => write(forged), /materials must match warehouse currency and unit/);
    checks.push("Bypassed browser validation cannot confirm serial equipment or a mismatched material unit");
    forged = complete("future", 1); forged.documents[0].currency = "UAH";
    await rejected(() => write(forged), /project currency/);
    forged = complete("future", 1);
    await rejected(() => write(forged, uuid(), response.revision, [{ id: "future", token: "stale-token", materials: forged.projects.find(x => x.id === "future").materials }]), /Materials changed/);
    checks.push("Forged cost/currency and stale project materials cannot confirm an installation");

    await login("warehouse"); activeUser = "warehouse"; response = await read();
    response = await write(complete("future", 1));
    assert.equal(response.state.documents.find(x => x.kind === "installation_completion" && x.projectId === "future").createdBy, ids.warehouse);
    checks.push("Existing warehouse role can post a completion with server-owned audit attribution");

    stage = "buyer holds";
    await internal();
    const buyerId = uuid();
    await db.query("insert into public.buyer_accounts(id,company_id,name,email,created_by) values($1,$2,'Buyer','buyer@example.invalid',$3)", [buyerId, company, ids.owner]);
    const orderId = uuid();
    await db.query("insert into public.buyer_orders(id,company_id,buyer_id,buyer_name,number,status,currency,total,delivery_method,phone,created_by) values($1,$2,$3,'Buyer','TEST','confirmed','USD',100,'pickup','+380501112233',$4)", [orderId, company, buyerId, ids.owner]);
    await db.query("insert into public.buyer_stock_holds(company_id,order_id,item_id,qty) values($1,$2,'panel',33)", [company, orderId]);
    await login("owner"); response = await read();
    forged = core.complete({ ...state(), orderReservations: [] }, { projectId: "shortage", completedOn: "2026-01-01", lines: [{ itemId: "panel", qty: 1 }], actor: { id: ids.owner, name: "owner" } });
    await rejected(() => write(forged), /reserved for confirmed buyer orders/);
    checks.push("Confirmed buyer holds stay protected by the original warehouse trigger after migration");

    stage = "roles";
    const safe = core.complete({ ...state(), orderReservations: [] }, { projectId: "shortage", completedOn: "2026-01-01", lines: [{ itemId: "panel", qty: 1 }] });
    for (const role of ["engineer", "installer", "viewer", "otherOwner"]) {
      await login(role);
      await assert.rejects(() => write(safe), /Only|owner|stock documents|membership/i);
    }
    await login("warehouse");
    assert.ok((await read()).state.documents.some(x => x.kind === "installation_completion"));
    checks.push("Existing stock-posting permissions remain unchanged; field/viewer/foreign users cannot complete stock documents");
    await internal();
    assert.equal((await db.query("select amount_minor from public.cash_transactions")).rows[0].amount_minor, 12345);
    assert.equal((await db.query("select count(*)::int n from public.cash_transactions")).rows[0].n, 1);
    checks.push("No completion posts, modifies or duplicates the cash deposit");
    return { passed: checks.length, checks };
  } catch (error) { error.message = stage + ": " + error.message; throw error; }
  finally { await db.close(); }
}

if (require.main === module) {
  const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");
  run(PGlite).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = run;
