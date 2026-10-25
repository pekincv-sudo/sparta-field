"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function runFieldProjectSqlTests(PGlite, projectDirectory = path.resolve(__dirname, "..")) {
  const db = new PGlite(); let passed = 0;
  const company = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", project = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", foreign = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  try {
    await db.exec(`
      create role authenticated; create schema auth;
      create type public.member_role as enum('owner','admin','engineer','brigadier','installer','warehouse','viewer');
      create function public.has_company_role(company uuid, roles public.member_role[]) returns boolean language sql stable as $$select company='${company}' and current_setting('test.role',true)=any(roles::text[])$$;
      create table public.projects(id uuid primary key,company_id uuid,work_checklist jsonb default '{}'::jsonb,data_revision bigint not null default 0,finance jsonb default '{"contractPrice":12345}'::jsonb);
      insert into public.projects(id,company_id) values('${project}','${company}'),('${foreign}','dddddddd-dddd-4ddd-8ddd-dddddddddddd');
      create function public.guard_test_write() returns trigger language plpgsql as $$begin if current_setting('sparta.project_write_company',true) is distinct from new.company_id::text then raise exception 'Direct project writes blocked'; end if; return new; end$$;
      create trigger test_direct_guard before update on public.projects for each row execute function public.guard_test_write();
    `);
    const sql = fs.readFileSync(path.join(projectDirectory,"database/field-project-sync.sql"),"utf8");
    await db.exec(sql); await db.exec(sql); passed += 1;
    const role = (value) => db.query("select set_config('test.role',$1,false)",[value]);
    const change = (changes, expected, id = project) => db.query("select public.update_project_field_checklist($1,$2::jsonb,$3::jsonb) as result",[id,JSON.stringify(changes),JSON.stringify(expected)]);
    await role("installer");
    let result = (await change({marking:true},{marking:false})).rows[0].result;
    assert.equal(result.checklist.marking,true); assert.equal(result.dataRevision,1); passed += 1;
    result = (await change({mounting_system:true},{mounting_system:false})).rows[0].result;
    assert.equal(result.checklist.marking,true); assert.equal(result.checklist.mounting_system,true); assert.equal(result.dataRevision,2); passed += 1;
    await assert.rejects(change({marking:false},{marking:false}),/changed on another device/);
    result = (await change({},{})).rows[0].result;
    assert.equal(result.checklist.marking,true); assert.equal(result.dataRevision,2); passed += 1;
    for (const pair of [[{finance:true},{finance:false}],[{marking:"true"},{marking:false}],[{marking:true},{}]]) await assert.rejects(change(...pair),/boolean|keys/);
    assert.equal((await db.query("select finance from public.projects where id=$1",[project])).rows[0].finance.contractPrice,12345); passed += 1;
    await assert.rejects(change({marking:false},{marking:true},foreign),/No permission/); passed += 1;
    for (const name of ["viewer","warehouse"]) { await role(name); await assert.rejects(change({marking:false},{marking:true}),/No permission/); } passed += 1;
    await role("owner");
    result = (await change({marking:false},{marking:true})).rows[0].result;
    assert.equal(result.checklist.marking,false); assert.equal(result.dataRevision,3); passed += 1;
    return {passed};
  } finally { await db.close(); }
}
module.exports=runFieldProjectSqlTests;
if(require.main===module) runFieldProjectSqlTests(require(process.argv[2]).PGlite,process.argv[3]).then(console.log).catch(error=>{console.error(error);process.exitCode=1});
