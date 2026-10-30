"use strict";

// Actual PostgreSQL/RLS checks in an isolated database. No real money or stock.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

async function run(PGlite, root = path.resolve(__dirname, ".."), base = process.env.SPARTA_BASE_SCHEMA) {
  if (!base) throw new Error("SPARTA_BASE_SCHEMA is required");
  const db = new PGlite(), checks = [], uuid = () => crypto.randomUUID();
  const company = uuid(), otherCompany = uuid(), buyer = uuid(), foreignBuyer = uuid();
  const ids = Object.fromEntries(["owner", "admin", "engineer", "warehouse", "installer", "buyer", "otherOwner"].map(n => [n, uuid()]));
  let phase = "setup";
  const checked = title => checks.push(title);
  const login = async (name, role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [ids[name] || "", JSON.stringify({ session_id: "finance-test" })]);
    await db.exec("set role " + role);
  };
  const internal = async () => { await db.exec("reset role"); await db.exec("select set_config('request.jwt.claim.sub','',false)"); };
  const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) data`, args)).rows[0].data;
  const action = (orderId, type) => rpc("sparta_sales_order_action", [orderId, type, uuid()]);
  const report = () => rpc("sparta_sales_finance", [company]);
  const find = async id => (await report()).orders.find(x => x.orderId === id);
  const cash = async (order, minor, category = "sale_payment", extra = {}) => {
    const entry = { id: uuid(), company_id: company, currency: order.currency, source_type: "sale", sale_order_id: order.id,
      category, direction: category === "sale_refund" || category === "other_expense" ? "expense" : "income", amount_minor: minor,
      counterparty: "Buyer", purpose: "Actual payment", payment_method: "cash", occurred_at: "2026-10-30T10:00:00Z", ...extra };
    const cols = Object.keys(entry);
    return (await db.query(`insert into public.cash_transactions(${cols.join(",")}) values(${cols.map((_, i) => "$" + (i + 1)).join(",")}) returning *`, Object.values(entry))).rows[0];
  };
  const reverse = original => cash({ id: original.sale_order_id, currency: original.currency }, Number(original.amount_minor), original.category, {
    direction: original.direction === "income" ? "expense" : "income", reverses_id: original.id,
    source_type: original.source_type || (original.project_client_id ? "project" : "general"),
    sale_order_number: original.sale_order_number, buyer_id: original.buyer_id, buyer_name: original.buyer_name,
    project_client_id: original.project_client_id, project_title: original.project_title, payment_method: original.payment_method,
  });
  const submit = async (itemId, total, qty = 1) => {
    await login("buyer");
    return (await rpc("sparta_buyer_submit_order", [buyer, uuid(), [{ itemId, qty }], { method: "pickup", phone: "+380501112233" }, total])).order;
  };
  const complete = async order => {
    await login("owner"); await action(order.id, "confirm");
    await login("warehouse"); await action(order.id, "ready"); await action(order.id, "fulfil");
    await login("owner"); return find(order.id);
  };
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
    await db.query("insert into public.companies(id,name) values($1,'SPARTA'),($2,'Other company')", [company, otherCompany]);
    for (const [name, id] of Object.entries(ids)) {
      await db.query("insert into auth.users values($1,$2,now())", [id, name + "@example.invalid"]);
      await db.query("insert into public.profiles(id,email,full_name) values($1,$2,$3)", [id, name + "@example.invalid", name]);
      if (name !== "buyer") await db.query("insert into public.company_members(company_id,user_id,role) values($1,$2,$3)", [name === "otherOwner" ? otherCompany : company, id, name === "otherOwner" ? "owner" : name]);
    }
    for (const file of ["release34-base.sql", "project-save.sql", "warehouse-cloud.sql", "cash-transactions.sql", "private-storage.sql", "field-project-sync.sql", "currency-usd-build35.sql", "team-build36.sql", "buyer-portal.sql"]) {
      await db.exec(fs.readFileSync(path.join(root, "database", file), "utf8"));
    }
    await login("owner");
    await rpc("sparta_project_save", [company, {
      project: { company_id: company, client_id: "project", title: "Legacy project", currency: "USD", status: "new", app_data: {}, work_checklist: {}, finance: {} },
      technical: { panel_power_w: 450, panel_count: 0, inverter_power_kw: 0, mppt_count: 1, pv_inputs_per_mppt: 1, battery_capacity_kwh: 0, battery_modules_count: 0, equipment_details: {} }, strings: [],
    }, 0]);
    await internal();
    await db.query("insert into public.buyer_accounts(id,company_id,name,email,created_by) values($1,$2,'Buyer','buyer@example.invalid',$3),($4,$5,'Foreign buyer','foreign@example.invalid',$6)", [buyer, company, ids.owner, foreignBuyer, otherCompany, ids.otherOwner]);
    await db.query("insert into public.buyer_members(buyer_id,user_id) values($1,$2)", [buyer, ids.buyer]);
    for (const [itemId, currency, cost, price, known] of [["known", "USD", 80, 150.25, true], ["unknown", "USD", 0, 200, false], ["uah", "UAH", 50, 100, true], ["zero-known", "USD", 0, 10, true]]) {
      await db.query("insert into public.warehouse_items(company_id,client_item_id,category,name,sku,unit,quantity,purchase_price,sale_price,min_quantity,app_data) values($1,$2,'Test',$2,$2,'шт',10,$3,$4,0,$5)", [company, itemId, cost, price, { currency, installerPrice: price, purchasePriceKnown: known }]);
    }
    await login("owner");
    const legacy = (await db.query("insert into public.cash_transactions(company_id,project_client_id,project_title,direction,category,amount_minor,counterparty,purpose,currency) values($1,'project','Legacy project','income','client_payment',12345,'Client','Legacy deposit','USD') returning *", [company])).rows[0];
    const migration = fs.readFileSync(path.join(root, "database/sales-cash-build47.sql"), "utf8");
    phase = "safe reapplication without rewriting old cash";
    await internal(); await db.exec(migration); await db.exec(migration);
    await login("owner");
    const after = (await db.query("select * from public.cash_transactions where id=$1", [legacy.id])).rows[0];
    assert.equal(after.source_type, null); assert.equal(after.sale_order_id, null);
    for (const key of Object.keys(legacy)) assert.deepEqual(after[key], legacy[key], key + " remains unchanged");
    checked("Upgrade reapplies without altering any legacy cash value; legacy classification stays inferable");
    const projectEntry = (await db.query("insert into public.cash_transactions(company_id,project_client_id,project_title,direction,category,amount_minor,counterparty,purpose,currency) values($1,'project','Legacy project','income','client_payment',100,'Client','New deposit','USD') returning *", [company])).rows[0];
    assert.equal(projectEntry.source_type, "project");
    const legacyReverse = await reverse(after); assert.equal(legacyReverse.source_type, "project");
    assert.equal(Number(legacyReverse.amount_minor), 12345);
    checked("Old clients infer project/general source, and a normalized reversal preserves legacy history");

    phase = "issue snapshot and gross margin";
    const knownOrder = await submit("known", 300.5, 2), known = await complete(knownOrder);
    assert.equal(known.revenueMinor, 30050); assert.equal(known.costMinor, 16000); assert.equal(known.grossProfitMinor, 14050);
    assert.equal(known.costKnown, true); assert.equal(known.paidMinor, 0); assert.equal(known.outstandingMinor, 30050);
    assert.equal((await db.query("select count(*)::int n from public.cash_transactions where sale_order_id=$1", [knownOrder.id])).rows[0].n, 0);
    let workspace = await rpc("sparta_warehouse_read", [company]);
    const savedDoc = workspace.state.documents.find(x => x.id === known.documentId);
    assert.equal(savedDoc.lines[0].unitCostKnown, true);
    checked("Issue creates a frozen known-cost margin but never creates a cash payment");
    const core = require(path.join(root, "warehouse-core.js"));
    const receipt = core.postReceipt(workspace.state, { id: "later-receipt", date: "2026-10-30", currency: "USD", lines: [{ itemId: "known", qty: 2, purchasePrice: 200 }] });
    await rpc("sparta_warehouse_write", [company, uuid(), workspace.revision, { ...workspace.state, items: receipt.items, documents: receipt.documents, movements: receipt.movements }, []]);
    assert.equal((await find(knownOrder.id)).costMinor, 16000);
    checked("A later receipt changes catalog weighted cost without changing the issued sale margin");

    phase = "actual cash payments and canonical order binding";
    const payment = await cash(knownOrder, 20000, "sale_payment", { buyer_name: "Forged name", sale_order_number: "FORGED", created_by: ids.otherOwner });
    assert.equal(payment.buyer_name, "Buyer"); assert.equal(payment.buyer_id, buyer); assert.equal(payment.sale_order_number, knownOrder.number); assert.equal(payment.created_by, ids.owner);
    let paid = await find(knownOrder.id); assert.equal(paid.paidMinor, 20000); assert.equal(paid.outstandingMinor, 10050); assert.equal(paid.grossProfitMinor, 14050);
    await cash(knownOrder, 1000, "other_expense"); assert.equal((await find(knownOrder.id)).paidMinor, 20000);
    checked("Explicit payments use database buyer/order snapshots; incidental sales expenses do not change customer paid total or gross margin");
    await assert.rejects(cash(knownOrder, 1, "sale_payment", { currency: "UAH" }), /currency must match sale/);
    await assert.rejects(cash(knownOrder, 1, "sale_payment", { project_client_id: "project", project_title: "Legacy project" }), /no project/);
    await assert.rejects(cash(knownOrder, 1, "sale_payment", { source_type: "general" }), /Only sales cash/);
    await assert.rejects(cash(knownOrder, 1, "client_payment"), /sales cash category/);
    checked("Sales currency, source, category and exclusive project/order linkage are validated by PostgreSQL");

    phase = "refund/reversal safeguards";
    const refund = await cash(knownOrder, 5000, "sale_refund");
    assert.equal((await find(knownOrder.id)).paidMinor, 15000);
    await assert.rejects(cash(knownOrder, 15001, "sale_refund"), /refund exceeds recorded payments/);
    const fullRefund = await cash(knownOrder, 15000, "sale_refund");
    await assert.rejects(cash(knownOrder, 15000, "sale_refund", { id: fullRefund.id, occurred_at: fullRefund.occurred_at }), /duplicate key/);
    const replay = { ...fullRefund, created_by: ids.otherOwner, created_at: "2026-01-01T00:00:00Z" };
    const replayCols = Object.keys(replay);
    const replayQuery = `insert into public.cash_transactions(${replayCols.join(",")}) values(${replayCols.map((_, i) => "$" + (i + 1)).join(",")}) on conflict(id) do nothing returning id`;
    assert.deepEqual((await db.query(replayQuery, Object.values(replay))).rows, []);
    await assert.rejects(cash(knownOrder, 14999, "sale_refund", { id: fullRefund.id, occurred_at: fullRefund.occurred_at }), /identity was already used for different data/);
    checked("A fully-refunded same-ID retry remains idempotent; changed payloads and additional refunds cannot reuse that acknowledgement");
    await reverse(fullRefund);
    await assert.rejects(reverse(payment), /refund exceeds recorded payments/);
    await assert.rejects(cash(knownOrder, 5000, "sale_refund", { reverses_id: refund.id, direction: "income", buyer_name: "Changed", sale_order_number: refund.sale_order_number, buyer_id: buyer }), /reversal must preserve/);
    const refundReverse = await reverse(refund); assert.equal(refundReverse.direction, "income");
    await assert.rejects(reverse(refund), /duplicate key|already/);
    await reverse(payment); assert.equal((await find(knownOrder.id)).paidMinor, 0);
    checked("Refunds cannot exceed net payments; payment reversal respects refunded money and complete immutable linkage");
    await assert.rejects(db.query("update public.cash_transactions set amount_minor=1 where id=$1", [payment.id]), /permission denied|immutable/);
    await assert.rejects(db.query("delete from public.cash_transactions where id=$1", [payment.id]), /permission denied|immutable/);
    await assert.rejects(db.exec("truncate public.cash_transactions"), /permission denied|immutable/);
    checked("Cash remains append-only, including sales records");
    await cash(knownOrder, 35000); paid = await find(knownOrder.id);
    assert.equal(paid.outstandingMinor, 0); assert.equal(paid.creditMinor, 4950);
    checked("A real overpayment is recorded as credit, never negative debt or fabricated revenue");

    phase = "historical document cost handling";
    await internal();
    const historical = { ...savedDoc, lines: savedDoc.lines.map(({ unitCostKnown, ...line }) => line) };
    assert.equal((await rpc("sparta_sales_cost_snapshot", [historical, "USD", 300.5])).grossProfitMinor, 14050);
    const zeroLegacy = { ...historical, lines: historical.lines.map(line => ({ ...line, unitCost: 0 })) };
    assert.equal((await rpc("sparta_sales_cost_snapshot", [zeroLegacy, "USD", 300.5])).grossProfitMinor, null);
    const mixed = { ...historical, lines: historical.lines.map(line => ({ ...line, currency: "UAH" })) };
    assert.equal((await rpc("sparta_sales_cost_snapshot", [mixed, "USD", 300.5])).grossProfitMinor, null);
    assert.equal((await rpc("sparta_sales_cost_snapshot", [historical, "USD", 1])).grossProfitMinor, null);
    const incomplete = { ...historical, lines: historical.lines.map(({ unitCost, ...line }) => line) };
    assert.equal((await rpc("sparta_sales_cost_snapshot", [incomplete, "USD", 300.5])).costKnown, false);
    checked("Historical positive snapshots work; unmarked zero, absent cost, inconsistent totals and mixed-currency documents never fabricate margin");
    await login("owner");

    phase = "incomplete costs and mixed currencies";
    const unknownOrder = await submit("unknown", 200), unknown = await complete(unknownOrder);
    assert.equal(unknown.costKnown, false); assert.equal(unknown.costMinor, null); assert.equal(unknown.grossProfitMinor, null); assert.match(unknown.costUnknownReason, /невідомою/);
    workspace = await rpc("sparta_warehouse_read", [company]);
    assert.equal(workspace.state.documents.find(x => x.id === unknown.documentId).lines[0].unitCostKnown, false);
    const zeroOrder = await submit("zero-known", 10), zero = await complete(zeroOrder);
    assert.equal(zero.costKnown, true); assert.equal(zero.costMinor, 0); assert.equal(zero.grossProfitMinor, 1000);
    const uahOrder = await submit("uah", 100), uah = await complete(uahOrder);
    assert.equal(uah.costMinor, 5000); assert.equal(uah.grossProfitMinor, 5000);
    await cash(uahOrder, 10000);
    const summary = await report(), usd = summary.totals.find(x => x.currency === "USD"), ua = summary.totals.find(x => x.currency === "UAH");
    assert.equal(usd.costMinor, null); assert.equal(usd.grossProfitMinor, null); assert.equal(usd.knownGrossProfitMinor, 15050); assert.equal(usd.unknownCostCount, 1);
    assert.equal(ua.grossProfitMinor, 5000); assert.equal(ua.paidMinor, 10000);
    checked("Unknown imported costs remain unknown; explicit zero costs are valid; USD and UAH aggregates never mix");

    phase = "status and cancellation payments";
    const pending = await submit("known", 150.25); await login("owner");
    assert.equal((await find(pending.id)).outstandingMinor, 0);
    await assert.rejects(cash(pending, 100), /confirmed, ready or completed/);
    await action(pending.id, "confirm"); const cancelledDeposit = await cash(pending, 3000); await action(pending.id, "cancel");
    assert.equal((await find(pending.id)).outstandingMinor, 0); assert.equal((await find(pending.id)).refundDueMinor, 3000);
    await assert.rejects(cash(pending, 100), /confirmed, ready or completed/);
    await assert.rejects(cash(pending, 3000, "sale_payment", { id: cancelledDeposit.id, occurred_at: cancelledDeposit.occurred_at }), /duplicate key/);
    await cash(pending, 3000, "sale_refund"); assert.equal((await find(pending.id)).refundDueMinor, 0);
    checked("Submitted/cancelled orders cannot gain new payment income; cancelled recorded deposits remain explicitly refundable");

    phase = "finance isolation and audit";
    await internal();
    const foreignOrder = { id: uuid(), currency: "USD" };
    await db.query("insert into public.buyer_orders(id,company_id,buyer_id,buyer_name,status,currency,total,delivery_method,phone,created_by) values($1,$2,$3,'Foreign buyer','confirmed','USD',50,'pickup','000',$4)", [foreignOrder.id, otherCompany, foreignBuyer, ids.otherOwner]);
    const auditRows = (await db.query("select after_data from public.company_audit_events where company_id=$1 and entity_type='cash_transactions'", [company])).rows;
    assert(auditRows.some(x => x.after_data?.sale_order_id === knownOrder.id && x.after_data?.source_type === "sale" && x.after_data?.buyer_id === buyer));
    await login("owner"); await assert.rejects(cash(foreignOrder, 100), /does not belong to this company/);
    assert(!(await report()).orders.some(x => x.orderId === foreignOrder.id));
    assert.equal((await db.query("select has_table_privilege('authenticated','public.buyer_orders','update') allowed")).rows[0].allowed, false);
    checked("An owner cannot bind foreign-company sales or read their profit; order UPDATE permissions remain revoked");
    await login("admin"); assert((await report()).orders.length >= 4);
    for (const role of ["engineer", "warehouse", "installer", "buyer", "otherOwner"]) {
      await login(role);
      await assert.rejects(report(), /owner or admin/);
      await assert.rejects(cash(knownOrder, 100), /owner or admin|row-level security/);
    }
    await login("buyer");
    assert.doesNotMatch(JSON.stringify(await rpc("sparta_buyer_orders", [buyer])), /unitCost|grossProfit|costMinor|purchasePriceKnown/);
    await assert.rejects(rpc("sparta_sales_cost_snapshot", [savedDoc, "USD", 300.5]), /permission denied/);
    await login(null, "anon"); await assert.rejects(report(), /permission denied/);
    checked("Only company owner/admin can read sales margin or post cash; buyer histories and helper permissions do not expose costs");
    checked("Sales cash linkage is included in the existing immutable audit trail");
    return { passed: checks.length, checks };
  } catch (error) { error.message = phase + ": " + error.message; throw error; }
  finally { await db.close(); }
}
module.exports = run;
if (require.main === module) run(require(process.env.PGLITE_MODULE || "@electric-sql/pglite").PGlite)
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error.message, error.where || ""); process.exitCode = 1; });
