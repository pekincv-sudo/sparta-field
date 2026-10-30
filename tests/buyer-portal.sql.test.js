"use strict";

// Actual PostgreSQL/RLS verification in an isolated in-memory PGlite database.
// No network, Supabase account, email delivery or production record is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

async function run(PGlite, root = path.resolve(__dirname, ".."), base = process.env.SPARTA_BASE_SCHEMA) {
  if (!base) throw new Error("SPARTA_BASE_SCHEMA must point to the existing database/schema.sql fixture");
  const db = new PGlite();
  let phase = "setup";
  const checks = [];
  const company = "11111111-1111-4111-8111-111111111111";
  const otherCompany = "22222222-2222-4222-8222-222222222222";
  const ids = Object.fromEntries(["owner", "admin", "engineer", "warehouse", "installer", "viewer", "otherOwner", "buyerA", "buyerB", "buyerOther", "unconfirmed"].map(name => [name, crypto.randomUUID()]));
  const session = crypto.randomUUID();
  const uuid = () => crypto.randomUUID();
  const clone = value => JSON.parse(JSON.stringify(value));
  const checked = name => checks.push(name);
  const migration = path.join(root, "database/buyer-portal.sql");
  const detailsUpgrade = path.join(root, "database/buyer-catalog-details-build46.sql");
  const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, index) => "$" + (index + 1)).join(",")}) as data`, args)).rows[0]?.data;
  const login = async (name, databaseRole = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [ids[name] || "", JSON.stringify({ session_id: session })]);
    await db.exec("set role " + databaseRole);
  };
  const internal = async () => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub','',false)"); };
  const delivery = { method: "pickup", phone: "+380501112233", address: "", comment: "Повторне замовлення" };
  const submit = async (buyerId, lines, total, request = uuid(), details = delivery) => rpc("sparta_buyer_submit_order", [buyerId, request, lines, details, total]);
  const action = async (orderId, type, request = uuid()) => rpc("sparta_sales_order_action", [orderId, type, request]);
  const staffRead = async () => rpc("sparta_warehouse_read", [company]);
  const staffWrite = async (state, revision, request = uuid()) => rpc("sparta_warehouse_write", [company, request, revision, state, []]);
  const accountInput = (name, suffix, extra = {}) => ({ name, email: suffix + "@example.invalid", phone: "+380501112233", ...extra });
  let buyerA, buyerB, buyerOther, invitationA;
  try {
    await db.exec(`create schema auth; create schema storage; create role anon; create role authenticated; create role service_role;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.email() returns text language sql stable as $$select ''::text$$;
      grant usage on schema auth,storage to anon,authenticated,service_role;
      grant execute on function auth.uid(),auth.email() to anon,authenticated,service_role;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;`);
    await db.exec(fs.readFileSync(base, "utf8").replace('create extension if not exists "pgcrypto";', ""));
    await db.exec("grant select,insert,update,delete on all tables in schema public,storage to authenticated;");
    await db.query("insert into public.companies(id,name) values($1,'SPARTA'),($2,'Other seller')", [company, otherCompany]);
    for (const [name, id] of Object.entries(ids)) {
      await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)", [id, name.toLowerCase() + "@example.invalid", name === "unconfirmed" ? null : new Date().toISOString()]);
      await db.query("insert into public.profiles(id,email,full_name) values($1,$2,$3)", [id, name.toLowerCase() + "@example.invalid", name]);
      if (["owner", "admin", "engineer", "warehouse", "installer", "viewer", "otherOwner"].includes(name)) {
        await db.query("insert into public.company_members(company_id,user_id,role) values($1,$2,$3)", [name === "otherOwner" ? otherCompany : company, id, name === "otherOwner" ? "owner" : name]);
      }
    }
    phase = "current production migration chain";
    for (const file of ["release34-base.sql", "project-save.sql", "warehouse-cloud.sql", "cash-transactions.sql", "private-storage.sql", "field-project-sync.sql", "currency-usd-build35.sql", "team-build36.sql"]) {
      await db.exec(fs.readFileSync(path.join(root, "database", file), "utf8"));
    }
    phase = "buyer migration compilation and safe reapplication";
    await db.exec(fs.readFileSync(migration, "utf8"));
    await db.exec(fs.readFileSync(migration, "utf8"));
    checked("Migration compiles and reapplies after the complete existing production migration chain");

    phase = "seed isolated inventory";
    const publicSpecs = {
      characteristics: "Public product characteristics sentinel",
      powerW: 450, powerKw: 12.5, capacityKwh: 10.24,
      voltageV: 51.2, phases: 3, crossSectionMm2: 6,
    };
    const items = [
      { id: "panel", name: "Panel 450W", unit: "шт", qty: 6, cost: 80, retail: 999, meta: {
        currency: "USD", installerPrice: 150.25, wholesalePrice: 120,
        brand: "Brand", model: "P450", ...publicSpecs,
        supplier: "PRIVATE-SUPPLIER", location: "PRIVATE-LOCATION",
        serialNumber: "PRIVATE-SERIAL", serialNumbers: ["PRIVATE-SERIAL-2"],
        barcode: "PRIVATE-BARCODE", internalNotes: "PRIVATE-NOTES",
        technical: { internal: "PRIVATE-NESTED-TECHNICAL" },
        extraCost: 0, deliveryCost: 0,
      } },
      { id: "retail-only", name: "No installer price", unit: "шт", qty: 5, cost: 60, retail: 899, meta: { currency: "USD", supplier: "PRIVATE-SUPPLIER" } },
      { id: "zero-price", name: "Zero installer price", unit: "шт", qty: 5, cost: 60, retail: 899, meta: { currency: "USD", installerPrice: 0 } },
      { id: "cable", name: "Cable", unit: "м", qty: 12.5, cost: 1, retail: 20, meta: { currency: "USD", installerPrice: 2.35 } },
      { id: "uah", name: "UAH product", unit: "шт", qty: 2, cost: 50, retail: 200, meta: { currency: "UAH", installerPrice: 100 } },
      { id: "service", name: "Installation labor", unit: "шт", qty: 1, cost: 0, retail: 500, meta: { currency: "USD", installerPrice: 500, type: "service" } },
    ];
    for (const item of items) {
      await db.query("insert into public.warehouse_items(company_id,client_item_id,category,name,sku,unit,quantity,purchase_price,sale_price,min_quantity,app_data) values($1,$2,'Фотомодулі',$3,$4,$5,$6,$7,$8,0,$9)", [company, item.id, item.name, item.id.toUpperCase(), item.unit, item.qty, item.cost, item.retail, item.meta]);
    }
    await db.query("insert into public.warehouse_items(company_id,client_item_id,category,name,unit,quantity,purchase_price,sale_price,min_quantity,app_data) values($1,'foreign-product','Other','PRIVATE-OTHER-COMPANY','шт',10,1,1,0,'{\"installerPrice\":1}')", [otherCompany]);
    await login("owner");
    await rpc("sparta_project_save", [company, {
      project: { company_id: company, client_id: "project", title: "PRIVATE-PROJECT", currency: "USD", status: "new", app_data: {}, work_checklist: {}, finance: { crewPayroll: 900, contractPrice: 5000 } },
      technical: { panel_power_w: 450, panel_count: 0, inverter_power_kw: 0, mppt_count: 1, pv_inputs_per_mppt: 1, battery_capacity_kwh: 0, battery_modules_count: 0, equipment_details: {} }, strings: [],
    }, 0]);

    phase = "buyer account creation and invitations";
    await login("engineer");
    await assert.rejects(rpc("sparta_sales_save_buyer", [company, accountInput("Buyer A", "buyera")]), /owner or admin/);
    await login("owner");
    let saved = await rpc("sparta_sales_save_buyer", [company, accountInput("Buyer A", "buyera")]);
    buyerA = saved.buyer; invitationA = saved.invitation;
    assert.equal(invitationA.status, "pending");
    saved = await rpc("sparta_sales_save_buyer", [company, accountInput("Buyer A", "buyera", { id: buyerA.id })]);
    assert.equal(saved.invitation.id, invitationA.id);
    buyerB = (await rpc("sparta_sales_save_buyer", [company, accountInput("Buyer B", "buyerb")])).buyer;
    await rpc("sparta_sales_save_buyer", [company, accountInput("Unconfirmed", "unconfirmed")]);
    await assert.rejects(rpc("sparta_sales_save_buyer", [company, { ...buyerA, email: "replacement@example.invalid" }]), /email is immutable/);
    await login("otherOwner");
    buyerOther = (await rpc("sparta_sales_save_buyer", [otherCompany, accountInput("Other buyer", "buyerother")])).buyer;
    await assert.rejects(rpc("sparta_sales_save_buyer", [otherCompany, buyerA]), /company access/);
    checked("Only owner/admin manage buyers, tenant boundaries hold, emails cannot transfer purchase history, saves preserve pending invitation identity");

    phase = "service-only mail preparation and durable cooldown";
    await login("owner");
    await assert.rejects(rpc("sparta_buyer_prepare_invitation_email", [invitationA.id, ids.owner]), /permission denied/);
    await login(null, "service_role");
    await assert.rejects(rpc("sparta_buyer_prepare_invitation_email", [invitationA.id, ids.otherOwner]), /authorized sender/);
    const prepared = await rpc("sparta_buyer_prepare_invitation_email", [invitationA.id, ids.owner]);
    assert.equal(prepared.company_id, company); assert.equal(prepared.buyer_id, buyerA.id); assert.equal(prepared.email, "buyera@example.invalid");
    await assert.rejects(rpc("sparta_buyer_prepare_invitation_email", [invitationA.id, ids.owner]), /cooldown/);
    await assert.rejects(rpc("sparta_buyer_record_invitation_delivery", [invitationA.id, ids.otherOwner, true, "invite"]), /delivery report/);
    await rpc("sparta_buyer_record_invitation_delivery", [invitationA.id, ids.owner, false, "invite"]);
    await login("owner");
    saved = await rpc("sparta_sales_save_buyer", [company, { ...buyerA }]);
    assert.equal(saved.invitation.lastSendStatus, "failed");
    await login(null, "service_role");
    await assert.rejects(rpc("sparta_buyer_prepare_invitation_email", [invitationA.id, ids.owner]), /cooldown/);
    checked("Mail preparation/delivery are service-only, recheck the actual staff actor, and retain a database cooldown across saves");

    phase = "verified buyer invitation acceptance";
    await login("unconfirmed");
    await assert.rejects(rpc("sparta_buyer_accept_invitation"), /confirmed email/);
    for (const name of ["buyerA", "buyerB", "buyerOther"]) { await login(name); assert.equal(await rpc("sparta_buyer_accept_invitation"), true); }
    await login("buyerA");
    assert.equal(await rpc("sparta_buyer_accept_invitation"), false);
    const context = await rpc("sparta_buyer_context");
    assert.equal(context.accounts.length, 1); assert.equal(context.accounts[0].id, buyerA.id); assert.equal(context.accounts[0].companyName, "SPARTA");
    await internal();
    assert.equal((await db.query("select count(*) n from public.company_members where user_id in ($1,$2,$3)", [ids.buyerA, ids.buyerB, ids.buyerOther])).rows[0].n, 0);
    checked("Acceptance requires the verified Auth email, creates only buyer membership and cannot turn buyers into staff");

    phase = "safe legacy catalog and installer-only prices";
    await login("buyerA");
    let catalog = await rpc("sparta_buyer_catalog", [buyerA.id]);
    assert.equal(catalog.items.find(item => item.id === "panel").price, 150.25);
    assert.equal(catalog.items.find(item => item.id === "retail-only").price, null);
    assert.equal(catalog.items.find(item => item.id === "zero-price").price, null);
    assert(!catalog.items.some(item => ["service", "foreign-product"].includes(item.id)));
    assert(!/PRIVATE-|purchasePrice|purchase_price|unitCost|supplier|retailPrice|salePrice/.test(JSON.stringify(catalog)));
    const assertCatalogDetails = (result) => {
      const product = result.items.find(item => item.id === "panel");
      const allowedFields = ["id", "name", "sku", "category", "brand", "model", "unit", "currency", "price", "availableQty", ...Object.keys(publicSpecs)];
      assert.deepEqual(Object.keys(product).sort(), allowedFields.sort(), "Product detail uses an explicit public field whitelist");
      assert.deepEqual(Object.fromEntries(Object.keys(publicSpecs).map(field => [field, product[field]])), publicSpecs);
      for (const field of Object.keys(publicSpecs).filter(field => field !== "characteristics")) {
        assert.equal(typeof product[field], "number", `${field} retains its saved numeric value`);
      }
      const unfilled = result.items.find(item => item.id === "retail-only");
      assert.equal(unfilled.characteristics, "");
      for (const field of Object.keys(publicSpecs).filter(field => field !== "characteristics")) {
        assert.equal(unfilled[field], null, `Missing ${field} is not invented or changed to zero`);
      }
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE-|"(?:purchasePrice|purchase_price|unitCost|supplier|location|serialNumber|serialNumbers|barcode|internalNotes|technical|retailPrice|salePrice|installerPrice|wholesalePrice|deliveryCost|extraCost)"\s*:/);
      assert.equal(product.price, 150.25, "The buyer still receives only the assigned tier price");
    };
    assertCatalogDetails(catalog);
    await assert.rejects(rpc("sparta_buyer_catalog", [buyerB.id]), /buyer access/);
    await assert.rejects(rpc("sparta_buyer_catalog", [buyerOther.id]), /buyer access/);
    checked("Baseline catalog exposes the seven saved product specifications and numeric nulls through a private-data whitelist with own-buyer access");

    phase = "product-detail upgrade reapplication and unchanged access boundaries";
    for (let application = 0; application < 2; application += 1) {
      await internal();
      await db.exec(fs.readFileSync(detailsUpgrade, "utf8"));
      await login("buyerA");
      const upgradedCatalog = await rpc("sparta_buyer_catalog", [buyerA.id]);
      assertCatalogDetails(upgradedCatalog);
      assert.deepEqual(upgradedCatalog, catalog, "The standalone upgrade preserves the baseline RPC's data and assigned price");
      await assert.rejects(rpc("sparta_buyer_catalog", [buyerB.id]), /buyer access/);
      await assert.rejects(rpc("sparta_buyer_catalog", [buyerOther.id]), /buyer access/);
      await login(null, "anon");
      await assert.rejects(rpc("sparta_buyer_catalog", [buyerA.id]), /permission denied/);
    }
    await login("buyerA");
    checked("Standalone product-detail upgrade applies twice and preserves real specifications, private-field exclusion and buyer/anonymous authorization");

    phase = "safe legacy catalog and installer-only prices";
    await assert.rejects(submit(buyerA.id, [{ itemId: "retail-only", qty: 1 }], 899), /tier price/);
    await assert.rejects(submit(buyerA.id, [{ itemId: "zero-price", qty: 1 }], 0), /tier price/);
    await login("owner");
    const seededByStaff = await staffRead();
    assert.equal(seededByStaff.state.items.find(item => item.id === "retail-only").installerPrice, 0);
    await staffWrite(seededByStaff.state, seededByStaff.revision);
    await login("buyerA");
    catalog = await rpc("sparta_buyer_catalog", [buyerA.id]);
    assert.equal(catalog.items.find(item => item.id === "retail-only").price, null);
    assertCatalogDetails(catalog);
    checked("Buyer catalog uses explicit installer prices without retail fallback, filters services and projects no costs/suppliers/foreign stock");

    phase = "raw RLS privacy and RPC boundaries";
    assert.equal((await db.query("select id from public.buyer_accounts")).rows.length, 1);
    assert.equal((await db.query("select buyer_id from public.buyer_members")).rows.length, 1);
    assert.equal((await db.query("select id,purchase_price from public.warehouse_items")).rows.length, 0);
    assert.equal((await db.query("select id,title from public.projects")).rows.length, 0);
    await assert.rejects(db.query("select * from public.warehouse_workspaces"), /permission denied/);
    await assert.rejects(db.query("select * from public.buyer_stock_holds"), /permission denied/);
    await assert.rejects(db.query("select * from public.buyer_requests"), /permission denied/);
    await assert.rejects(db.query("select * from public.buyer_invitations"), /permission denied/);
    await assert.rejects(db.query("update public.buyer_accounts set is_active=false"), /permission denied/);
    await assert.rejects(rpc("sparta_warehouse_read", [company]), /staff membership/);
    await assert.rejects(rpc("sparta_warehouse_staff_read", [company]), /permission denied/);
    await assert.rejects(rpc("sparta_buyer_order_json", [uuid()]), /permission denied/);
    await assert.rejects(rpc("sparta_buyer_change_order", [uuid(), "cancel", uuid(), true]), /permission denied/);
    await assert.rejects(rpc("sparta_buyer_catalog", [buyerB.id]), /buyer access/);
    await assert.rejects(rpc("sparta_buyer_orders", [buyerOther.id]), /buyer access/);
    await assert.rejects(rpc("sparta_sales_buyers", [company]), /Sales staff/);
    await login(null, "anon"); await assert.rejects(rpc("sparta_buyer_context"), /permission denied/);
    checked("Actual authenticated/anonymous SQL roles enforce own-only RLS and deny staff warehouse, internal helpers, invitations and direct mutations");

    phase = "server pricing, quantity, currency and delivery validation";
    await login("buyerA");
    await assert.rejects(submit(buyerA.id, [{ itemId: "panel", qty: 1, unitPrice: 1 }], 1), /only itemId/);
    await assert.rejects(submit(buyerA.id, [{ itemId: "panel", qty: 1 }], 1), /prices changed/);
    await assert.rejects(submit(buyerA.id, [{ itemId: "panel", qty: 0.5 }], 75.13), /Invalid order quantity/);
    await assert.rejects(submit(buyerA.id, [{ itemId: "panel", qty: -1 }], 0), /Invalid order quantity/);
    await assert.rejects(submit(buyerA.id, [{ itemId: "cable", qty: 1.0001 }], 2.35), /Invalid order quantity/);
    await assert.rejects(submit(buyerA.id, [{ itemId: "panel", qty: "1" }], 150.25), /numeric qty/);
    await assert.rejects(submit(buyerA.id, [{ itemId: "panel", qty: 1 }, { itemId: "uah", qty: 1 }], 250.25), /one currency/);
    await assert.rejects(submit(buyerA.id, [{ itemId: "panel", qty: 1 }, { itemId: "panel", qty: 1 }], 300.5), /Duplicate/);
    await assert.rejects(submit(buyerA.id, [{ itemId: "panel", qty: 100 }], 15025), /available stock/);
    await assert.rejects(submit(buyerA.id, [{ itemId: "foreign-product", qty: 1 }], 1), /not available/);
    await assert.rejects(submit(buyerA.id, [{ itemId: "panel", qty: 1 }], 150.25, uuid(), { ...delivery, method: "delivery", address: "" }), /delivery method/);
    const fractional = (await submit(buyerA.id, [{ itemId: "cable", qty: 1.125 }], 2.64)).order;
    assert.equal(fractional.lines[0].qty, 1.125); assert.equal(fractional.lines[0].lineTotal, 2.64);
    checked("PostgreSQL rejects forged prices, totals, missing installer prices, fractional whole units, excessive precision, mixed currencies, duplicates and invalid delivery");

    phase = "project reservations are included in buyer availability";
    await login("owner");
    let stock = await staffRead();
    assert.deepEqual(stock.orderReservations, []);
    const next = clone(stock.state);
    next.reservations.push({ id: "project-hold", itemId: "panel", projectId: "project", qty: 1 });
    stock = await staffWrite(next, stock.revision);
    await login("buyerA");
    catalog = await rpc("sparta_buyer_catalog", [buyerA.id]);
    assert.equal(catalog.items.find(item => item.id === "panel").availableQty, 5);
    assert.equal(catalog.items.find(item => item.id === "retail-only").price, null, "Workspace initialization must retain the no-retail-fallback rule");
    checked("Buyer availability subtracts existing project holds and workspace initialization retains unset installer prices");

    phase = "submission idempotency and unreserved pending orders";
    const submitRequestA = uuid();
    const orderA = (await submit(buyerA.id, [{ itemId: "panel", qty: 4 }], 601, submitRequestA)).order;
    assert.deepEqual((await submit(buyerA.id, [{ itemId: "panel", qty: 4 }], 601, submitRequestA)).order, orderA);
    await assert.rejects(submit(buyerA.id, [{ itemId: "panel", qty: 3 }], 450.75, submitRequestA), /already used/);
    assert.equal((await rpc("sparta_buyer_catalog", [buyerA.id])).items.find(item => item.id === "panel").availableQty, 5);
    await login("buyerB");
    const orderB = (await submit(buyerB.id, [{ itemId: "panel", qty: 4 }], 601)).order;
    assert.equal((await db.query("select id from public.buyer_orders")).rows.length, 1);
    assert.equal((await db.query("select item_id from public.buyer_order_lines")).rows.length, 1);
    await assert.rejects(rpc("sparta_buyer_cancel_order", [orderA.id, uuid()]), /buyer access/);
    checked("Submitted orders do not reserve stock, repeated request UUIDs return the same snapshot and raw order/line reads remain own-only");

    phase = "manager confirmation and competing final stock";
    await login("warehouse");
    await assert.rejects(action(orderA.id, "confirm"), /Staff role/);
    await login("engineer");
    const confirmRequest = uuid();
    assert.equal((await action(orderA.id, "confirm", confirmRequest)).order.status, "confirmed");
    assert.equal((await action(orderA.id, "confirm", confirmRequest)).order.status, "confirmed");
    await assert.rejects(action(orderB.id, "confirm"), /Insufficient available stock/);
    await assert.rejects(action(orderA.id, "ready"), /Staff role/);
    await assert.rejects(action(orderA.id, "fulfil"), /Staff role/);
    await login("owner");
    stock = await staffRead();
    assert.equal(stock.state.items.find(item => item.id === "panel").qty, 6);
    assert.equal(stock.orderReservations.length, 1); assert.equal(stock.orderReservations[0].qty, 4);
    assert(!stock.state.reservations.some(hold => hold.orderId), "Order holds must stay outside editable project reservations");
    await login("buyerA");
    assert.equal((await rpc("sparta_buyer_catalog", [buyerA.id])).items.find(item => item.id === "panel").availableQty, 1);
    await assert.rejects(rpc("sparta_buyer_cancel_order", [orderA.id, uuid()]), /cannot be cancelled/);
    checked("Only manager confirmation reserves, physical stock remains unchanged, confirmation retry is idempotent and a competing order cannot overbook the last stock");

    phase = "cancellation releases only its own holds";
    await login("engineer");
    await action(orderA.id, "cancel");
    await action(orderB.id, "confirm");
    await login("owner");
    stock = await staffRead();
    assert.equal(stock.orderReservations.length, 1); assert.equal(stock.orderReservations[0].orderId, orderB.id);
    assert.equal(stock.state.reservations[0].id, "project-hold");
    checked("Staff cancellation atomically releases the cancelled order only and leaves project/other-order reservations intact");

    phase = "ordinary staff withdrawals cannot consume buyer holds";
    const saleState = clone(stock.state);
    saleState.items.find(item => item.id === "panel").qty -= 2;
    saleState.documents.unshift({ id: "ordinary-sale", currency: "USD", type: "sale", status: "posted", lines: [{ itemId: "panel", qty: 2, unitCost: 80, salePrice: 150.25 }] });
    saleState.movements.unshift({ id: "ordinary-sale-move", currency: "USD", type: "sale", itemId: "panel", qty: 2, unitCost: 80, salePrice: 150.25, documentId: "ordinary-sale" });
    await assert.rejects(staffWrite(saleState, stock.revision), /reserved for confirmed buyer orders/);
    assert.equal((await staffRead()).revision, stock.revision, "Rejected issue must roll back revision, journal and mirrors");
    const projectOverbook = clone(stock.state);
    projectOverbook.reservations.push({ id: "steal-via-project", itemId: "panel", projectId: "project", qty: 2 });
    await assert.rejects(staffWrite(projectOverbook, stock.revision), /reserved for confirmed buyer orders/);
    await assert.rejects(staffWrite(stock.state, stock.revision - 1), /revision changed/);
    await internal();
    const removed = clone(stock.state); removed.items = removed.items.filter(item => item.id !== "panel");
    await assert.rejects(db.query("update public.warehouse_workspaces set state=$1 where company_id=$2", [removed, company]), /prevent removing product/);
    await assert.rejects(db.query("delete from public.warehouse_workspaces where company_id=$1", [company]), /prevent deleting warehouse/);
    checked("The database trigger protects buyer holds against ordinary sales, new project reservations, deleted products and stale staff writes with complete rollback");

    phase = "catalog changes cannot rewrite pending purchase prices";
    await login("owner");
    stock = await staffRead();
    const repriced = clone(stock.state); repriced.items.find(item => item.id === "panel").installerPrice = 300.99;
    await staffWrite(repriced, stock.revision);
    await login("buyerA");
    assert.equal((await submit(buyerA.id, [{ itemId: "panel", qty: 4 }], 601, submitRequestA)).order.total, 601, "A lost-response retry returns the original submitted snapshot even after price/status changes");
    await login("buyerB");
    assert.equal((await rpc("sparta_buyer_orders", [buyerB.id])).orders[0].lines[0].unitPrice, 150.25);
    assert.equal((await rpc("sparta_buyer_catalog", [buyerB.id])).items.find(item => item.id === "panel").price, 300.99);
    await assert.rejects(db.query("update public.buyer_order_lines set unit_price=1"), /permission denied/);
    await internal();
    await assert.rejects(db.query("update public.buyer_order_lines set unit_price=1 where order_id=$1", [orderB.id]), /snapshots are immutable/);
    await assert.rejects(db.query("update public.buyer_orders set total=1 where id=$1", [orderB.id]), /snapshots are immutable/);
    checked("Pending and historical prices are immutable server snapshots; catalog changes affect only future orders and retries preserve their original response");

    phase = "atomic fulfilment uses the existing warehouse journal exactly once";
    await login("warehouse");
    assert.equal((await action(orderB.id, "ready")).order.status, "ready");
    const fulfilRequest = uuid();
    const complete = (await action(orderB.id, "fulfil", fulfilRequest)).order;
    assert.equal(complete.status, "completed"); assert.equal(complete.total, 601);
    stock = await staffRead();
    assert.equal(stock.state.items.find(item => item.id === "panel").qty, 2);
    assert.equal(stock.orderReservations.length, 0);
    const saleDoc = stock.state.documents.find(doc => doc.id === complete.warehouseDocumentId);
    assert.equal(saleDoc.type, "sale"); assert.equal(saleDoc.lines[0].salePrice, 150.25); assert.equal(saleDoc.lines[0].unitCost, 80);
    assert.equal(saleDoc.createdBy, ids.warehouse);
    assert.equal(stock.state.movements.filter(move => move.documentId === saleDoc.id).length, 1);
    const afterComplete = clone(stock);
    assert.deepEqual((await action(orderB.id, "fulfil", fulfilRequest)).order, complete);
    assert.deepEqual(await staffRead(), afterComplete);
    await assert.rejects(action(orderB.id, "fulfil"), /Only confirmed or ready/);
    await assert.rejects(action(orderB.id, "cancel", fulfilRequest), /already used/);
    await internal();
    assert.equal((await db.query("select quantity from public.warehouse_items where company_id=$1 and client_item_id='panel'", [company])).rows[0].quantity, "2.000");
    assert.equal((await db.query("select count(*) n from public.cash_transactions")).rows[0].n, 0);
    checked("Fulfilment commits one existing sale document, inventory-cost movement, relational stock mirror and order status atomically, with no cash entry or duplicate deduction");

    phase = "buyer history, own cancellation and inactive-access checks";
    await login("buyerB");
    const history = (await rpc("sparta_buyer_orders", [buyerB.id])).orders;
    assert.equal(history.length, 1); assert.equal(history[0].status, "completed"); assert.equal(history[0].lines[0].unitPrice, 150.25);
    assert(!/unitCost|purchasePrice|PRIVATE-|supplier/.test(JSON.stringify(history)));
    await login("buyerA");
    const cancelRequest = uuid();
    assert.equal((await rpc("sparta_buyer_cancel_order", [fractional.id, cancelRequest])).order.status, "cancelled");
    assert.equal((await rpc("sparta_buyer_cancel_order", [fractional.id, cancelRequest])).order.status, "cancelled");
    await login("owner"); await rpc("sparta_sales_save_buyer", [company, { ...buyerA, isActive: false }]);
    await login("buyerA"); assert.equal((await rpc("sparta_buyer_context")).accounts.length, 0);
    assert.equal((await db.query("select id from public.buyer_orders")).rows.length, 0);
    await assert.rejects(rpc("sparta_buyer_catalog", [buyerA.id]), /buyer access/);
    await assert.rejects(rpc("sparta_buyer_orders", [buyerA.id]), /buyer access/);
    await assert.rejects(submit(buyerA.id, [{ itemId: "cable", qty: 1 }], 2.35), /buyer access/);
    await login("owner"); await rpc("sparta_sales_save_buyer", [company, { ...buyerA, isActive: true }]);
    await login("buyerA"); assert.equal((await rpc("sparta_buyer_context")).accounts.length, 1);
    checked("Completed own history retains old prices, buyer cancellation is submitted-only/idempotent and inactive accounts lose RPC plus raw-table access immediately");

    phase = "separate buyer-session audit with actual actor and deduplication";
    await rpc("sparta_buyer_record_session_event", [buyerA.id, "login"]);
    await rpc("sparta_buyer_record_session_event", [buyerA.id, "login"]);
    await rpc("sparta_buyer_record_session_event", [buyerA.id, "logout"]);
    await assert.rejects(rpc("sparta_buyer_record_session_event", [buyerB.id, "login"]), /buyer access/);
    await assert.rejects(rpc("sparta_audit_list", [company]), /owner or admin/);
    await login("owner");
    const audit = await rpc("sparta_audit_list", [company, 100]);
    assert.equal(audit.entries.filter(entry => entry.actorId === ids.buyerA && entry.action === "buyer_login").length, 1);
    assert.equal(audit.entries.filter(entry => entry.actorId === ids.buyerA && entry.action === "buyer_logout").length, 1);
    assert(audit.entries.some(entry => entry.action === "order_fulfil" && entry.actorId === ids.warehouse));
    checked("Buyer login/logout and order events record the real Auth actor in the owner audit; session events deduplicate without exposing audit to buyers");

    phase = "staff role and tenant regression boundaries";
    await login("engineer"); assert.equal((await rpc("sparta_sales_buyers", [company])).buyers.length, 3); assert.equal((await rpc("sparta_sales_orders", [company])).orders.length, 3);
    await login("installer"); await assert.rejects(rpc("sparta_sales_orders", [company]), /Sales staff/); await assert.rejects(action(orderB.id, "confirm"), /Staff role/);
    await login("otherOwner"); await assert.rejects(rpc("sparta_sales_orders", [company]), /Sales staff/); await assert.rejects(action(orderB.id, "cancel"), /Staff role/);
    await login("buyerOther"); assert.deepEqual((await rpc("sparta_buyer_orders", [buyerOther.id])).orders, []); assert.equal((await db.query("select id from public.buyer_orders")).rows.length, 0);
    checked("Existing installer and foreign-company roles gain no sales authority; staff sales reads stay company-scoped and foreign buyers see no orders");

    phase = "post historical direct sales with original snapshots";
    await login("owner");
    stock = await staffRead();
    const historical = clone(stock.state);
    historical.items.find(item => item.id === "cable").qty -= 1.75;
    historical.documents.unshift({ id: "phone-sale", number: "PHONE-OLD-15", date: "2025-01-14", customer: "+380501112233", currency: "USD", type: "sale", status: "posted",
      note: "PRIVATE-INTERNAL-NOTE", attachments: [{ fileName: "PRIVATE-SUPPLIER-INVOICE.pdf" }], lines: [
        { itemId: "cable", sku: "OLD-C6", itemName: "Original cable name", unit: "м", qty: 1, salePrice: 1.25, unitCost: 1, supplier: "PRIVATE-SUPPLIER" },
        { itemId: "cable", sku: "OLD-C6", itemName: "Original cable name", unit: "м", qty: 0.5, salePrice: 1.10, unitCost: 1 },
      ] });
    historical.documents.unshift({ id: "zero-historical-sale", number: "PHONE-OLD-15", date: "2025-01-15", customer: "+380501112233", currency: "USD", type: "sale", status: "posted",
      lines: [{ itemId: "cable", sku: "OLD-C6", itemName: "Original cable name", unit: "м", qty: 0.25, salePrice: 0, unitCost: 1 }] });
    historical.documents.unshift({ id: "incomplete-historical-sale", number: "INCOMPLETE", date: "2025-01-16", customer: "Phone buyer", currency: "USD", type: "sale", status: "posted",
      lines: [{ itemId: "cable", itemName: "Original cable name", unit: "м", qty: 1, unitCost: 1 }] });
    historical.documents.unshift({ id: "draft-historical-sale", number: "DRAFT", date: "2025-01-17", currency: "USD", type: "sale", status: "draft", lines: [] });
    for (const [index, qty] of [1, 0.5, 0.25].entries()) historical.movements.unshift({ id: "historical-move-" + index, currency: "USD", type: "sale", itemId: "cable", qty, unitCost: 1,
      salePrice: [1.25, 1.10, 0][index], documentId: index === 2 ? "zero-historical-sale" : "phone-sale" });
    stock = await staffWrite(historical, stock.revision);
    const changedCatalog = clone(stock.state);
    Object.assign(changedCatalog.items.find(item => item.id === "cable"), { name: "New cable name", sku: "NEW-C6", installerPrice: 7.99 });
    stock = await staffWrite(changedCatalog, stock.revision);
    const beforeHistoryLink = clone(stock);
    await login("otherOwner");
    const foreignStock = await rpc("sparta_warehouse_read", [otherCompany]);
    const foreignSale = clone(foreignStock.state);
    foreignSale.items.find(item => item.id === "foreign-product").qty -= 1;
    foreignSale.documents.unshift({ id: "foreign-sale", number: "FOREIGN", date: "2025-01-14", type: "sale", status: "posted", currency: "UAH",
      lines: [{ itemId: "foreign-product", itemName: "Foreign product", unit: "шт", qty: 1, salePrice: 3, unitCost: 1 }] });
    foreignSale.movements.unshift({ id: "foreign-sale-move", type: "sale", currency: "UAH", itemId: "foreign-product", qty: 1, salePrice: 3, unitCost: 1, documentId: "foreign-sale" });
    await rpc("sparta_warehouse_write", [otherCompany, uuid(), foreignStock.revision, foreignSale, []]);
    checked("Historical fixtures use real posted warehouse sales and preserve duplicate product lines, original prices/dates and duplicate legacy document numbers");

    phase = "unlinked direct-sales projection is scoped and excludes costs";
    await login("engineer");
    let unlinked = (await rpc("sparta_sales_unlinked_sales", [company])).documents;
    assert(unlinked.some(document => document.id === "phone-sale" && document.total === 1.8 && document.canLink));
    assert(unlinked.some(document => document.id === "zero-historical-sale" && document.total === 0 && document.canLink));
    assert(unlinked.some(document => document.id === "incomplete-historical-sale" && document.canLink === false));
    assert(!unlinked.some(document => ["draft-historical-sale", "foreign-sale", complete.warehouseDocumentId].includes(document.id)));
    assert(!/unitCost|purchasePrice|supplier|PRIVATE-|attachments|note/.test(JSON.stringify(unlinked)));
    await assert.rejects(rpc("sparta_sales_link_purchase", [buyerA.id, "phone-sale", uuid()]), /owner, admin or warehouse/);
    await login("buyerA");
    await assert.rejects(rpc("sparta_sales_unlinked_sales", [company]), /Sales staff/);
    await assert.rejects(rpc("sparta_sales_link_purchase", [buyerA.id, "phone-sale", uuid()]), /owner, admin or warehouse/);
    await assert.rejects(rpc("sparta_buyer_sale_snapshot", [historical.documents[0]]), /permission denied/);
    await login("owner");
    await assert.rejects(rpc("sparta_sales_unlinked_sales", [otherCompany]), /Sales staff/);
    await assert.rejects(rpc("sparta_sales_link_purchase", [buyerOther.id, "phone-sale", uuid()]), /owner, admin or warehouse/);
    await assert.rejects(rpc("sparta_sales_link_purchase", [buyerA.id, "foreign-sale", uuid()]), /posted company sale/);
    await assert.rejects(rpc("sparta_sales_link_purchase", [buyerA.id, "draft-historical-sale", uuid()]), /posted company sale/);
    await assert.rejects(rpc("sparta_sales_link_purchase", [buyerA.id, "incomplete-historical-sale", uuid()]), /snapshot is incomplete/);
    checked("Sales staff can list safe unlinked posted sales; buyers/managers cannot link and cross-company/draft/incomplete documents are rejected without cost exposure");

    phase = "manual history association is atomic, idempotent and stock neutral";
    await login("warehouse");
    const historyRequest = uuid();
    const linked = (await rpc("sparta_sales_link_purchase", [buyerA.id, "phone-sale", historyRequest])).order;
    assert.equal(linked.status, "completed"); assert.equal(linked.total, 1.8); assert.equal(linked.warehouseDocumentNumber, "PHONE-OLD-15");
    assert.equal(linked.createdAt.slice(0, 10), "2025-01-14");
    assert.deepEqual(linked.lines.map(line => [line.name, line.sku, line.qty, line.unitPrice]), [["Original cable name", "OLD-C6", 1, 1.25], ["Original cable name", "OLD-C6", 0.5, 1.10]]);
    assert.deepEqual((await rpc("sparta_sales_link_purchase", [buyerA.id, "phone-sale", historyRequest])).order, linked);
    assert.deepEqual((await rpc("sparta_sales_link_purchase", [buyerA.id, "phone-sale", uuid()])).order, linked);
    await assert.rejects(rpc("sparta_sales_link_purchase", [buyerB.id, "phone-sale", uuid()]), /different buyer/);
    await assert.rejects(rpc("sparta_sales_link_purchase", [buyerA.id, "zero-historical-sale", historyRequest]), /already used/);
    const zeroLinked = (await rpc("sparta_sales_link_purchase", [buyerA.id, "zero-historical-sale", uuid()])).order;
    assert.equal(zeroLinked.total, 0); assert.equal(zeroLinked.lines[0].unitPrice, 0); assert.notEqual(zeroLinked.number, linked.number);
    assert.deepEqual(await staffRead(), beforeHistoryLink, "Linking old purchases must not change stock, reservations, revision, documents or movements");
    unlinked = (await rpc("sparta_sales_unlinked_sales", [company])).documents;
    assert(!unlinked.some(document => ["phone-sale", "zero-historical-sale"].includes(document.id)));
    await internal();
    assert.equal((await db.query("select count(*) n from public.buyer_orders where warehouse_document_id='phone-sale'")).rows[0].n, 1);
    assert.equal((await db.query("select count(*) n from public.cash_transactions")).rows[0].n, 0);
    checked("Explicit historical links preserve original prices after catalog changes, cannot be reassigned, and create exactly one completed order without stock/cash/revision changes");

    phase = "buyer sees only explicitly linked historical purchases";
    await login("buyerA");
    const completeHistory = (await rpc("sparta_buyer_orders", [buyerA.id])).orders.filter(order => order.status === "completed");
    assert.equal(completeHistory.length, 2);
    assert(completeHistory.some(order => order.id === linked.id && order.lines[0].unitPrice === 1.25));
    assert(!/unitCost|purchasePrice|supplier|PRIVATE-|attachments/.test(JSON.stringify(completeHistory)));
    await login("buyerB");
    assert(!(await rpc("sparta_buyer_orders", [buyerB.id])).orders.some(order => order.warehouseDocumentId === "phone-sale"));
    await login("owner");
    const historyAudit = await rpc("sparta_audit_list", [company, 100]);
    assert.equal(historyAudit.entries.filter(entry => entry.action === "purchase_history_link" && entry.entityId === linked.id).length, 1);
    assert(historyAudit.entries.some(entry => entry.action === "purchase_history_link" && entry.actorId === ids.warehouse));
    checked("Own-only history includes explicitly associated phone/direct purchases and records the real staff actor once in the owner audit");
    phase = "three server-assigned buyer price tiers";
    await login("owner");
    let tierState = await staffRead();
    const tierItem = tierState.state.items.find(item => item.id === "retail-only");
    tierItem.retailPrice = 400; tierItem.salePrice = 400; tierItem.installerPrice = 350; tierItem.wholesalePrice = 300;
    await staffWrite(tierState.state, tierState.revision);
    const tierOrders = [];
    for (const [tier, price] of [["retail",400],["installer",350],["wholesale",300]]) {
      await login("owner");
      const assigned = await rpc("sparta_sales_save_buyer", [company, { ...buyerA, priceType:tier }]);
      assert.equal(assigned.buyer.priceType,tier);
      await login("buyerA");
      const priced = await rpc("sparta_buyer_catalog", [buyerA.id]);
      assert.equal(priced.buyer.priceType,tier);
      assert.equal(priced.items.find(item => item.id === "retail-only").price,price);
      assert(!/retailPrice|wholesalePrice|installerPrice|purchasePrice/.test(JSON.stringify(priced)));
      const snapshot = (await submit(buyerA.id,[{itemId:"retail-only",qty:1}],price)).order;
      assert.equal(snapshot.priceType,tier); assert.equal(snapshot.lines[0].unitPrice,price);
      tierOrders.push(snapshot);
    }
    checked("Server-selected retail, installer and wholesale tiers project only the assigned price and freeze tier/price in the order");
    await assert.rejects(rpc("sparta_sales_save_buyer", [company,{...buyerA,priceType:"wholesale"}]), /owner or admin/);
    await assert.rejects(submit(buyerA.id,[{itemId:"retail-only",qty:1,priceType:"retail"}],400), /only itemId and numeric qty/);
    await login("engineer");
    await assert.rejects(rpc("sparta_sales_save_buyer", [company,{...buyerA,priceType:"wholesale"}]), /owner or admin/);
    await login("owner");
    await assert.rejects(rpc("sparta_sales_save_buyer", [company,{...buyerA,priceType:"cost"}]), /price type/);
    checked("Buyers and managers cannot change price tier, forged line tiers are rejected and unknown tiers are invalid");
    tierState = await staffRead();
    tierState.state.items.find(item => item.id === "retail-only").wholesalePrice=0;
    await staffWrite(tierState.state,tierState.revision);
    await login("buyerA");
    assert.equal((await rpc("sparta_buyer_catalog",[buyerA.id])).items.find(item=>item.id==="retail-only").price,null);
    await assert.rejects(submit(buyerA.id,[{itemId:"retail-only",qty:1}],400), /tier price/);
    const frozen = (await rpc("sparta_buyer_orders",[buyerA.id])).orders;
    for (const snapshot of tierOrders) assert.deepEqual(frozen.find(order=>order.id===snapshot.id),snapshot);
    checked("An unset wholesale price never falls back to another tier; changes preserve every existing order price");
    await login("owner");
    await rpc("sparta_sales_save_buyer",[company,{...buyerA,priceType:"retail"}]);
    await login("buyerA");
    assert.equal((await rpc("sparta_buyer_catalog",[buyerA.id])).items.find(item=>item.id==="retail-only").price,400);
    await internal();
    const beforeWholesale = (await db.query("select state from public.warehouse_workspaces where company_id=$1",[company])).rows[0].state;
    const tierIndex = beforeWholesale.items.findIndex(item=>item.id==="retail-only");
    for (const bad of [-1,"broken"]) {
      await assert.rejects(db.query("update public.warehouse_workspaces set state=jsonb_set(state,$2,$3::jsonb) where company_id=$1",[company,["items",String(tierIndex),"wholesalePrice"],JSON.stringify(bad)]));
    }
    assert.deepEqual((await db.query("select state from public.warehouse_workspaces where company_id=$1",[company])).rows[0].state,beforeWholesale);
    checked("The warehouse trigger validates wholesale prices even for writers predating the new field and rolls back malformed writes");
    phase = "authenticated batch inventory import with buyer protections installed";
    await login("owner");
    const importApi = require(path.join(root,"inventory-import.js")).create(require(path.join(root,"warehouse-core.js")));
    const sourceBytes = process.env.SPARTA_IMPORT_CSV ? fs.readFileSync(process.env.SPARTA_IMPORT_CSV) : Buffer.from("isolated-inventory-test");
    const importRows = process.env.SPARTA_IMPORT_CSV ? importApi.parseCsv(sourceBytes.toString("utf8")) : [
      {name:"Сонячна панель імпорт",sku:"IMPORT-PV",unit:"шт",category:"Фотомодулі",currency:"UAH",purchasePrice:3000,installerPrice:3300,retailPrice:3600,wholesalePrice:null,qty:100,sourceRow:3},
      {name:"Гібридний інвертор імпорт",sku:"IMPORT-INV",unit:"шт",category:"Інвертори",currency:"UAH",purchasePrice:null,installerPrice:null,retailPrice:null,wholesalePrice:null,qty:100,sourceRow:4}
    ];
    const importInput={sourceName:"Номенклатура СЕС.csv",sourceHash:crypto.createHash("sha256").update(sourceBytes).digest("hex"),items:importRows};
    const beforeImport=await staffRead(), planned=importApi.plan(beforeImport.state,importInput,{date:"2026-10-27"});
    const afterImport=await staffWrite(planned.state,beforeImport.revision);
    assert.equal(afterImport.state.items.length,beforeImport.state.items.length+importRows.length);
    for(const row of planned.summary.rows){
      const saved=afterImport.state.items.find(item=>item.id===row.itemId);
      assert.equal(saved.qty,row.afterQty); assert.equal(saved.currency,row.currency);
      if(!row.purchasePriceKnown) assert.equal(saved.purchasePriceKnown,false);
    }
    for(const doc of afterImport.state.documents.filter(doc=>planned.summary.documentIds.includes(doc.id))){
      assert.equal(doc.createdBy,ids.owner); assert(doc.recordedAt);
    }
    assert.equal((await db.query("select count(*)::int n from public.cash_transactions")).rows[0].n,0);
    const replayed=importApi.plan(afterImport.state,importInput,{date:"2026-10-27"});
    assert.equal(replayed.alreadyImported,true); assert.deepEqual(replayed.state,afterImport.state);
    for(const existing of beforeImport.state.items) assert.deepEqual(afterImport.state.items.find(item=>item.id===existing.id),existing);
    assert.deepEqual(afterImport.state.reservations,beforeImport.state.reservations);
    checked("A complete batch import posts known/unknown costs, mirror rows and real owner audit atomically; replay preserves stock, history, project holds and cash");
    return { passed: checks.length, checks };
  } catch (error) {
    error.message = phase + ": " + error.message;
    throw error;
  } finally {
    await db.close();
  }
}

module.exports = run;
if (require.main === module) {
  run(require(process.env.PGLITE_MODULE || "@electric-sql/pglite").PGlite, process.env.SPARTA_SOURCE_ROOT || path.resolve(__dirname, ".."))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message, error.where || ""); process.exitCode = 1; });
}
