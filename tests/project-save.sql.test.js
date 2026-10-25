"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function runProjectSaveSqlTests(PGlite, migrationFile = path.resolve(__dirname, "../database/project-save.sql"), baseFile = "/Users/valera/Documents/Codex/2026-05-31/new-chat/work/solar-object-manager/database/schema.sql", releaseBaseFile = "/Users/valera/Documents/Codex/2026-05-31/new-chat/deploy/sparta-field/database/release34-base.sql") {
  const db = new PGlite();
  const company = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
  const people = { owner: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", engineer: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", brigadier: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", installer: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", warehouse: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", viewer: "ffffffff-ffff-4fff-8fff-ffffffffffff", outsider: "99999999-9999-4999-8999-999999999999" };
  const copy = (value) => JSON.parse(JSON.stringify(value));
  let passed = 0;
  try {
    await db.exec(`create schema auth; create role anon; create role authenticated;
      create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.email() returns text language sql stable as $$ select ''::text $$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid(),auth.email() to authenticated,anon;`);
    await db.exec(fs.readFileSync(baseFile,"utf8").replace('create extension if not exists "pgcrypto";',""));
    await db.exec("grant select,insert,update,delete on all tables in schema public to authenticated;");
    await db.exec(fs.readFileSync(releaseBaseFile,"utf8"));
    await db.query("insert into public.companies(id,name) values($1,'Own'),($2,'Other')",[company,other]);
    for (const [role,id] of Object.entries(people)) {
      await db.query("insert into auth.users values($1,$2)",[id,`${role}@example.invalid`]);
      await db.query("insert into public.profiles(id,full_name) values($1,$2)",[id,role]);
      await db.query("insert into public.company_members(company_id,user_id,role) values($1,$2,$3)",[role==="outsider"?other:company,id,role==="outsider"?"owner":role]);
    }
    await db.exec(fs.readFileSync(migrationFile,"utf8")); await db.exec(fs.readFileSync(migrationFile,"utf8")); passed++;
    const login = async (id,role="authenticated") => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id || ""]); await db.exec(`set role ${role}`); };
    const payload = { project: { company_id:company,client_id:"station-a",title:"Station A",client_name:"Client",client_phone:"+380000000000",address:"Address",object_type:"Home",status:"new",installation_date:null,team_name:"Crew",comment:"Note",app_data:{clientEmail:"client@example.invalid",statusHistory:[]},finance:{contractPrice:1000,equipment:[],expenses:[]},work_checklist:{marking:false},created_by:people.outsider },technical: {panel_manufacturer:"Maker",panel_model:"Panel",panel_power_w:500,panel_count:10,panel_serial_numbers:"S1",inverter_manufacturer:"Deye",inverter_model:"5kw",inverter_power_kw:5,inverter_serial_number:"I1",mppt_count:2,pv_inputs_per_mppt:2,battery_manufacturer:"",battery_model:"",battery_capacity_kwh:0,battery_modules_count:0,battery_serial_numbers:"",equipment_details:{inverters:[],batteries:[],panelGroups:[]}}, strings:[{mppt_number:1,pv_input_number:1,string_number:1,string_type:"normal",panel_count:10,orientation:"South",tilt_angle:30,note:"String one"}] };
    const save = async (data=payload,revision=0,companyId=company) => (await db.query("select public.sparta_project_save($1,$2,$3) as data",[companyId,data,revision])).rows[0].data;
    await login(people.owner);
    let result = await save();
    assert.equal(result.dataRevision,1);
    assert.equal((await db.query("select created_by from public.projects where id=$1",[result.id])).rows[0].created_by,people.owner);
    assert.equal((await db.query("select panel_model from public.project_technical where project_id=$1",[result.id])).rows[0].panel_model,"Panel");
    assert.equal((await db.query("select count(*)::int as n from public.project_strings where project_id=$1",[result.id])).rows[0].n,1); passed++;
    const before = async () => ({ project:(await db.query("select * from public.projects where id=$1",[result.id])).rows,technical:(await db.query("select * from public.project_technical where project_id=$1",[result.id])).rows,strings:(await db.query("select * from public.project_strings where project_id=$1",[result.id])).rows });
    let snapshot=await before();
    await assert.rejects(save(payload,0),/changed on another device/); assert.deepEqual(await before(),snapshot); passed++;
    const invalid=copy(payload);invalid.project.title="Must roll back";invalid.technical.panel_model="Must roll back";invalid.strings[0].string_type="invalid-enum";
    await assert.rejects(save(invalid,1),/invalid input value/);assert.deepEqual(await before(),snapshot);passed++;
    const updated=copy(payload);updated.project.title="Updated";updated.project.status="contract";updated.project.finance.contractPrice=2000;updated.technical.panel_model="Changed panel";updated.strings.push({...updated.strings[0],string_number:2,note:"Second"});
    result=await save(updated,1);assert.equal(result.dataRevision,2);assert.equal((await db.query("select count(*)::int as n from public.project_strings where project_id=$1",[result.id])).rows[0].n,2);passed++;
    snapshot=await before();
    await assert.rejects(db.query("update public.projects set title='Old browser' where id=$1",[result.id]),/Use sparta_project_save/);
    await assert.rejects(db.query("update public.project_technical set panel_model='Old browser' where project_id=$1",[result.id]),/Use sparta_project_save/);
    await assert.rejects(db.query("delete from public.project_strings where project_id=$1",[result.id]),/Use sparta_project_save/);assert.deepEqual(await before(),snapshot);passed++;
    const foreign=copy(updated);foreign.project.company_id=other;await assert.rejects(save(foreign,2),/another company/);assert.deepEqual(await before(),snapshot);passed++;
    for (const role of ["installer","warehouse","viewer","outsider"]) { await login(people[role]);await assert.rejects(save(updated,2),/Only active office staff/); } passed++;
    const staffPayload=copy(updated); delete staffPayload.project.finance;
    await login(people.engineer);await assert.rejects(save({...updated,project:{...updated.project,finance:{contractPrice:9999}}},2),/Only owner or admin/); result=await save(staffPayload,2);assert.equal(result.dataRevision,3);
    await login(people.brigadier);result=await save(staffPayload,3);assert.equal(result.dataRevision,4);passed++;
    await login(people.owner);
    const negative=copy(updated);negative.technical.panel_count=-1;await assert.rejects(save(negative,4),/Negative technical/);
    const coerced=copy(updated);coerced.technical.panel_count="10";await assert.rejects(save(coerced,4),/Invalid technical/);passed++;
    await db.query("delete from public.projects where id=$1",[result.id]);assert.equal((await db.query("select count(*)::int as n from public.project_strings where project_id=$1",[result.id])).rows[0].n,0);passed++;
    await login(null,"anon");await assert.rejects(save(),/permission denied/);passed++;
    return {passed};
  } finally { await db.close(); }
}
module.exports=runProjectSaveSqlTests;
if(require.main===module)runProjectSaveSqlTests(require(process.argv[2]).PGlite).then(console.log).catch(e=>{console.error(e);process.exitCode=1});
