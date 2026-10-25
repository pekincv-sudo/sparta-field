"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
async function run(PGlite,root=path.resolve(__dirname,".."),base=process.env.SPARTA_BASE_SCHEMA){
 const db=new PGlite();let passed=0,phase="setup";
 const company="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222";
 const ids={owner:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",admin:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",engineer:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",brigadier:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",installer:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",viewer:"ffffffff-ffff-4fff-8fff-ffffffffffff",outsider:"99999999-9999-4999-8999-999999999999",new:"88888888-8888-4888-8888-888888888888"};
 const session=crypto.randomUUID();
 try{
  await db.exec(`create schema auth;create schema storage;create role anon;create role authenticated;create role service_role;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function auth.email() returns text language sql stable as $$select ''::text$$;
   grant usage on schema auth,storage to anon,authenticated,service_role;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
   alter table storage.objects enable row level security;`);
  await db.exec(fs.readFileSync(base,"utf8").replace('create extension if not exists "pgcrypto";',""));
  await db.exec("grant select,insert,update,delete on all tables in schema public,storage to authenticated;");
  await db.query("insert into public.companies(id,name) values($1,'Sparta'),($2,'Other')",[company,other]);
  for(const [role,id]of Object.entries(ids)){
   await db.query("insert into auth.users values($1,$2,now())",[id,role+"@example.invalid"]);
   await db.query("insert into public.profiles(id,email,full_name) values($1,$2,$3)",[id,role+"@example.invalid",role]);
   if(role!=="new")await db.query("insert into public.company_members(company_id,user_id,role) values($1,$2,$3)",[role==="outsider"?other:company,id,role==="outsider"?"owner":role]);
  }
  for(const file of ["release34-base.sql","currency-usd-build35.sql","project-save.sql","warehouse-cloud.sql","private-storage.sql","field-project-sync.sql","team-access-audit.sql"]){phase="migration "+file;await db.exec(fs.readFileSync(path.join(root,"database",file),"utf8"));}
  await db.exec(fs.readFileSync(path.join(root,"database/team-access-audit.sql"),"utf8"));passed++;
  const login=async(role)=>{await db.exec("reset role");await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[ids[role]||"",JSON.stringify({session_id:session})]);await db.exec("set role "+(role?"authenticated":"anon"));};
  const rpc=async(name,args=[])=> (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as data`,args)).rows[0]?.data;
  phase="team read";await login("owner");assert.equal((await rpc("sparta_team_list",[company])).members.length,6);passed++;
  await login("installer");await assert.rejects(rpc("sparta_team_list",[company]),/owner or admin/);await assert.rejects(rpc("sparta_audit_list",[company]),/owner or admin/);passed++;
  phase="invite";await login("owner");let invitation=await rpc("sparta_team_invite",[company," NEW@example.invalid ","New person","installer"]);assert.equal(invitation.email,"new@example.invalid");assert.equal(invitation.status,"pending");passed++;
  let same=await rpc("sparta_team_invite",[company,"new@example.invalid","New person","installer"]);assert.equal(same.id,invitation.id);passed++;
  await assert.rejects(db.query("update public.company_members set role='owner' where user_id=$1",[ids.installer]),/authorized team management/);passed++;
  await login("admin");await assert.rejects(rpc("sparta_team_invite",[company,"admin2@example.invalid","Admin2","admin"]),/role cannot/);await assert.rejects(rpc("sparta_team_update_member",[company,ids.owner,"installer",true]),/Only owner/);passed++;
  await login("owner");await assert.rejects(rpc("sparta_team_update_member",[company,ids.owner,"installer",true]),/own access/);passed++;
  phase="confirmed email acceptance";await db.exec("reset role");await db.query("update auth.users set email_confirmed_at=null where id=$1",[ids.new]);await login("new");await assert.rejects(db.query("select * from public.accept_company_invitation()"),/confirmed email/);passed++;
  await db.exec("reset role");await db.query("update auth.users set email_confirmed_at=now() where id=$1",[ids.new]);await login("new");let accepted=(await db.query("select * from public.accept_company_invitation()")).rows;assert.equal(accepted[0].role,"installer");passed++;
  phase="revocation";await login("owner");await rpc("sparta_team_update_member",[company,ids.new,"installer",false]);await login("new");assert.equal((await db.query("select * from public.accept_company_invitation()")).rows.length,0);await assert.rejects(rpc("sparta_project_list",[company]),/Active company/);passed++;
  await login("owner");invitation=await rpc("sparta_team_invite",[company,"new@example.invalid","New person","brigadier"]);await login("new");accepted=(await db.query("select * from public.accept_company_invitation()")).rows;assert.equal(accepted[0].role,"brigadier");passed++;
  phase="session log";await rpc("sparta_record_session_event",[company,"login"]);await rpc("sparta_record_session_event",[company,"login"]);await rpc("sparta_record_session_event",[company,"logout"]);await login("owner");let audit=await rpc("sparta_audit_list",[company,100]);assert.equal(audit.entries.filter(e=>e.actorId===ids.new&&e.action==="login").length,1);assert.equal(audit.entries.filter(e=>e.actorId===ids.new&&e.action==="logout").length,1);passed++;
  await assert.rejects(db.query("update public.company_audit_events set actor_name='Spoof'"),/permission denied|immutable/);await assert.rejects(rpc("sparta_audit_record",[company,"login","session","spoof","spoof",null,{},ids.owner,null]),/permission denied/);passed++;
  phase="project";const payload={project:{company_id:company,client_id:"station",title:"Station",currency:"USD",status:"new",app_data:{statusHistory:[]},work_checklist:{marking:false},finance:{contractPrice:5000,crewPayroll:1000}},technical:{panel_power_w:500,panel_count:10,inverter_power_kw:5,mppt_count:2,pv_inputs_per_mppt:2,battery_capacity_kwh:0,battery_modules_count:0,equipment_details:{}},strings:[{mppt_number:1,pv_input_number:1,string_number:1,string_type:"normal",panel_count:10,tilt_angle:30,orientation:"south",note:""}]};
  let result=await rpc("sparta_project_save",[company,payload,0]);assert.equal((await rpc("sparta_project_list",[company]))[0].finance.crewPayroll,1000);passed++;
  const projectId=result.id;
  phase="finance mask";await login("engineer");assert.deepEqual((await rpc("sparta_project_list",[company]))[0].finance,{});await assert.rejects(db.query("select finance from public.projects"),/permission denied/);assert.equal((await db.query("select id,title from public.projects")).rows.length,1);passed++;
  const office=structuredClone(payload);delete office.project.finance;office.project.title="Manager edit";result=await rpc("sparta_project_save",[company,office,1]);assert.equal(result.dataRevision,2);passed++;
  await login("brigadier");await assert.rejects(rpc("sparta_project_save",[company,office,2]),/office staff/);await rpc("update_project_field_checklist",[projectId,{marking:true},{marking:false}]);passed++;
  phase="history net changes";await login("owner");audit=await rpc("sparta_audit_list",[company,100,null,"project_strings"]);const count=audit.entries.length;
  result=await rpc("sparta_project_save",[company,{...payload,project:{...payload.project,title:"Manager edit",work_checklist:{marking:true}}},3]);
  audit=await rpc("sparta_audit_list",[company,100,null,"project_strings"]);assert.equal(audit.entries.length,count,"Same string layout must not invent delete/recreate events");passed++;
  phase="actor identity";audit=await rpc("sparta_audit_list",[company,100,null,"projects",ids.engineer]);assert(audit.entries.some(e=>e.actorId===ids.engineer&&e.changes.title?.after==="Manager edit"));assert(audit.entries.every(e=>e.actorEmail==="engineer@example.invalid"));passed++;
  phase="pagination";const page=await rpc("sparta_audit_list",[company,2]);assert.equal(page.entries.length,2);assert.equal(page.hasMore,true);const older=await rpc("sparta_audit_list",[company,2,page.nextCursor]);assert(older.entries.every(e=>BigInt(e.id)<BigInt(page.nextCursor)));passed++;
  phase="cross-company";await login("outsider");assert.equal((await rpc("sparta_project_list",[other])).length,0);await assert.rejects(rpc("sparta_project_list",[company]),/membership/);await assert.rejects(rpc("sparta_audit_list",[company]),/owner or admin/);passed++;
  phase="delivery guard";await login("owner");await assert.rejects(rpc("sparta_team_prepare_invitation_email",[invitation.id,ids.owner]),/permission denied/);passed++;
  phase="immutable committed rows";await db.exec("reset role");await assert.rejects(db.query("delete from public.company_audit_events"),/immutable/);await assert.rejects(db.query("truncate public.company_audit_events"),/immutable/);passed++;
  phase="last owner";await db.query("select set_config('request.jwt.claim.sub','',false)");await assert.rejects(db.query("update public.company_members set role='installer' where company_id=$1 and user_id=$2",[company,ids.owner]),/last active owner/);passed++;
  phase="manager tasks";await login("engineer");const task=(await db.query("insert into public.project_tasks(company_id,client_task_id,title,assigned_to,created_by) values($1,'task','Install panels',$2,$3) returning id",[company,ids.brigadier,ids.engineer])).rows[0].id;passed++;
  await login("brigadier");await db.query("update public.project_tasks set status='in_progress',note='Started' where id=$1",[task]);await assert.rejects(db.query("update public.project_tasks set title='Rewrite plan' where id=$1",[task]),/assigned tasks only/);await assert.rejects(db.query("insert into public.project_tasks(company_id,client_task_id,title,assigned_to,created_by) values($1,'bad','Assign someone',$2,$2)",[company,ids.brigadier]),/row-level security/);passed++;
  phase="email delivery";await login("owner");const pending=await rpc("sparta_team_invite",[company,"another@example.invalid","Another person","installer"]);await db.exec("reset role");await db.query("select set_config('request.jwt.claim.sub','',false)");await db.exec("set role service_role");let prepared=await rpc("sparta_team_prepare_invitation_email",[pending.id,ids.owner]);assert.equal(prepared.id,pending.id);await assert.rejects(rpc("sparta_team_prepare_invitation_email",[pending.id,ids.owner]),/cooldown/);await rpc("sparta_team_record_invitation_delivery",[pending.id,ids.owner,false,"invite"]);passed++;
  await login("owner");audit=await rpc("sparta_audit_list",[company,100,null,"company_invitations",ids.owner,"invitation_delivery_failed"]);assert(audit.entries.some(e=>e.entityId===pending.id));passed++;
  return {passed};
 }catch(error){error.message=phase+": "+error.message;throw error;}finally{await db.close();}
}
module.exports=run;
if(require.main===module)run(require(process.env.PGLITE_MODULE).PGlite).then(console.log).catch(e=>{console.error(e.message,e.where||"");process.exitCode=1;});
