"use strict";
// Optional PostgreSQL migration/restore verification. No production data is used.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

async function run(PGlite, root = path.resolve(__dirname, ".."), base = process.env.SPARTA_BASE_SCHEMA) {
  if (!base) throw new Error("SPARTA_BASE_SCHEMA must point to the original schema fixture");
  const db = new PGlite(); let passed = 0;
  const company = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  try {
    await db.exec(`create schema auth; create schema storage; create role anon; create role authenticated; create role service_role;
      create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.email() returns text language sql stable as $$select ''::text$$;
      grant usage on schema auth,storage to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;`);
    await db.exec(fs.readFileSync(base,"utf8").replace('create extension if not exists "pgcrypto";',""));
    await db.exec("grant select,insert,update,delete on all tables in schema public,storage to authenticated;");
    await db.query("insert into public.companies(id,name) values($1,'Test company'),($2,'Other company')",[company,other]);
    await db.query("insert into auth.users values($1,'owner@example.invalid')",[user]);
    await db.query("insert into public.profiles(id,full_name) values($1,'Owner')",[user]);
    await db.query("insert into public.company_members(company_id,user_id,role) values($1,$2,'owner')",[company,user]);
    const project = (await db.query("insert into public.projects(company_id,client_id,title) values($1,'test-station','Station') returning id",[company])).rows[0].id;
    await db.query("insert into public.projects(company_id,client_id,title) values($1,'other','Untouched')",[other]);
    await db.query("insert into public.project_technical(project_id,panel_model) values($1,'Panel')",[project]);
    await db.query("insert into public.project_strings(project_id,mppt_number,pv_input_number,string_number,panel_count) values($1,1,1,1,10)",[project]);
    await db.query("insert into public.project_materials(project_id,name,quantity) values($1,'Material',2)",[project]);
    await db.query("insert into public.project_tasks(company_id,client_task_id,title) values($1,'task','Survey')",[company]);
    await db.query("insert into public.material_catalog(company_id,category,name) values($1,'Cable','Cable')",[company]);
    await db.query("insert into public.warehouse_items(company_id,client_item_id,name,quantity) values($1,'stock','Cable',8)",[company]);
    await db.query("insert into public.company_invitations(company_id,email) values($1,'test@example.invalid')",[company]);
    const migrations = ["release34-base.sql","project-save.sql","warehouse-cloud.sql","cash-transactions.sql","private-storage.sql","field-project-sync.sql","archive-test-data.sql"];
    for (const file of migrations) await db.exec(fs.readFileSync(path.join(root,"database",file),"utf8"));
    for (const file of migrations) await db.exec(fs.readFileSync(path.join(root,"database",file),"utf8")); passed++;
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
    await db.exec("set role authenticated");
    let media = (await db.query("select public.replace_project_media($1,0,$2,$3) as revision",[project,[{storage_path:`${company}/test/photo.jpg`,file_name:"photo.jpg"}],[{storage_path:`${company}/test/receipt.pdf`,file_name:"receipt.pdf",app_data:{cashEntryId:"cash-link"}}]])).rows[0].revision;
    assert.equal(Number(media),1); passed++;
    const field = (await db.query("select public.update_project_field_checklist($1,'{\"marking\":true}','{\"marking\":false}') as result",[project])).rows[0].result;
    assert.equal(field.dataRevision,1); assert.equal(field.checklist.marking,true); passed++;
    const state = (await db.query("select public.sparta_warehouse_read($1) as result",[company])).rows[0].result;
    const warehouse = (await db.query("select public.sparta_warehouse_write($1,gen_random_uuid(),0,$2,'[]') as result",[company,state.state])).rows[0].result;
    assert.equal(warehouse.revision,1); passed++;
    await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub','',false)");
    const tables = ["projects","project_technical","project_strings","project_materials","project_photos","project_files","project_tasks","warehouse_items","material_catalog","company_invitations","warehouse_workspaces","warehouse_requests"];
    const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table,(await db.query(`select to_jsonb(t) as row from public.${table} t order by to_jsonb(t)::text`)).rows.map(r=>r.row)])));
    const before = await snapshot();
    const backup = (await db.query("select sparta_archive.archive_company($1,'release34-test') as id",[company])).rows[0].id;
    assert.equal((await db.query("select count(*)::int as count from public.projects where company_id=$1",[company])).rows[0].count,0);
    assert.equal((await db.query("select count(*)::int as count from public.projects where company_id=$1",[other])).rows[0].count,1); passed++;
    await db.query("insert into public.project_tasks(company_id,client_task_id,title) values($1,'new','New work')",[company]);
    assert.equal((await db.query("select sparta_archive.archive_company($1,'release34-test') as id",[company])).rows[0].id,backup);
    assert.equal((await db.query("select count(*)::int as count from public.project_tasks where company_id=$1",[company])).rows[0].count,1); passed++;
    await assert.rejects(db.query("select sparta_archive.restore_snapshot($1)",[backup]),/empty company/); passed++;
    await db.query("delete from public.project_tasks where company_id=$1",[company]);
    // Simulate an archive created before the currency column existed.
    await db.query("update sparta_archive.snapshots set data=jsonb_set(data,'{projects}',(select jsonb_agg(value-'currency') from jsonb_array_elements(data->'projects'))) where id=$1",[backup]);
    await db.query("select sparta_archive.restore_snapshot($1)",[backup]);
    assert.deepEqual(await snapshot(),before); passed++;
    await db.query("select sparta_archive.restore_snapshot($1)",[backup]);
    assert.deepEqual(await snapshot(),before); passed++;
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
    await db.query("insert into public.cash_transactions(company_id,currency,direction,category,amount_minor,counterparty,purpose) values($1,'USD','income','opening_balance',100,'Owner','Test balance')",[company]);
    await assert.rejects(db.query("select sparta_archive.archive_company($1,'must-not-remove-money')",[company]),/Cash history exists/); passed++;
    await db.exec("set role authenticated");
    const original = (await db.query("insert into public.cash_transactions(company_id,currency,direction,category,amount_minor,counterparty,purpose) values($1,'USD','income','other_income',12345,'Client','Verified receipt') returning id",[company])).rows[0].id;
    await db.query("insert into public.cash_transactions(company_id,currency,direction,category,amount_minor,counterparty,purpose,reverses_id) values($1,'USD','expense','other_income',12345,'Client','Correction',$2)",[company,original]);
    await assert.rejects(db.query("insert into public.cash_transactions(company_id,currency,direction,category,amount_minor,counterparty,purpose,reverses_id) values($1,'USD','expense','other_income',12345,'Client','Duplicate',$2)",[company,original]),/unique constraint/); passed++;
    await assert.rejects(db.query("update public.cash_transactions set purpose='Rewrite' where id=$1",[original]),/permission denied|immutable/);
    await assert.rejects(db.query("delete from public.cash_transactions where id=$1",[original]),/permission denied|immutable/); passed++;
    await assert.rejects(db.query("select * from sparta_archive.snapshots"),/permission denied/); passed++;
    return {passed};
  } finally { await db.close(); }
}
module.exports = run;
if (require.main === module) run(require(process.env.PGLITE_MODULE || "@electric-sql/pglite").PGlite).then(console.log).catch(e=>{console.error(e);process.exitCode=1;});
