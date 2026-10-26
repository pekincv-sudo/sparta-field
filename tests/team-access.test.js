"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");

async function run(directory=path.resolve(__dirname,".."),cashDirectory=directory){
  const source=fs.readFileSync(path.join(directory,"team-access.js"),"utf8");
  const Cash=require(path.join(cashDirectory,"cash-ledger.js"));
  const clone=value=>JSON.parse(JSON.stringify(value));
  const initial={members:[
    {userId:"owner",fullName:"Власник",email:"owner@example.invalid",role:"owner",isActive:true,lastLoginAt:"2026-10-25T10:00:00Z"},
    {userId:"admin",fullName:"Адміністратор",email:"admin@example.invalid",role:"admin",isActive:true},
    {userId:"worker",fullName:'<img src=x onerror="bad()">',email:"worker@example.invalid",role:"installer",isActive:true},
    {userId:"blocked",fullName:"Призупинений",email:"blocked@example.invalid",role:"engineer",isActive:false}],
    invitations:[{id:"invite",email:"new@example.invalid",fullName:"Новий працівник",role:"installer",status:"pending",lastSendStatus:"failed",createdAt:"2026-10-25T12:00:00Z",expiresAt:"2099-10-25T12:00:00Z"},{id:"admin-invite",email:"admin2@example.invalid",role:"admin",status:"pending",expiresAt:"2099-10-25T12:00:00Z"}]};
  function harness(options={}){
    const events={},calls=[],target={innerHTML:"",contains:()=>true};let team=clone(initial),fail=null,holdTeam=null;
    const state={ready:true,user:{id:options.userId||"owner"},companyId:"company",memberRole:options.role||"owner"};
    const entry={id:"9007199254740997",occurredAt:"2026-10-25T12:00:00Z",actorId:"worker",actorName:'<script>bad()</script>',actorEmail:"worker@example.invalid",actorRole:"installer",action:"update",entityType:"projects",entityId:"project",entityTitle:'<img src=x onerror="bad()">',summary:"Оновлено об’єкт",changes:{title:{before:"До",after:'<svg onload="bad()">'},role:{before:"installer",after:"brigadier"}}};
    const client={async rpc(name,payload){
      calls.push({name,payload:clone(payload)});
      if(fail)return{error:fail,data:null};
      if(name==="sparta_team_list"){
        if(holdTeam){const wait=holdTeam;holdTeam=null;return wait;}
        return{data:clone(team),error:null};
      }
      if(name==="sparta_audit_list")return{data:{entries:[{...entry,id:payload.p_before_id?"100":entry.id}],hasMore:!payload.p_before_id,nextCursor:payload.p_before_id?null:entry.id,total:2},error:null};
      if(name==="sparta_team_update_member"){
        const member=team.members.find(item=>item.userId===payload.p_user_id);member.role=payload.p_role;member.isActive=payload.p_is_active;return{data:{ok:true},error:null};
      }
      if(name==="sparta_team_revoke_invitation"){team.invitations.find(item=>item.id===payload.p_invitation_id).status="revoked";return{data:{ok:true},error:null};}
      throw new Error("Unexpected RPC "+name);
    }};state.client=client;
    const context={window:{SPARTA_LOCAL_WORKSPACE:{enabled:Boolean(options.local)},SpartaCash:Cash},cloudState:state,
      document:{addEventListener(name,fn){(events[name]||=[]).push(fn);}},
      FormData:class{constructor(form){this.data=form.data||{};}get(key){return this.data[key]??null;}},
      Date,Intl,console,Map,Set};
    vm.createContext(context);vm.runInContext(source,context);
    function click(attr,value=""){
      const button={dataset:{[attr]:value},hasAttribute(name){return name===attr.replace(/[A-Z]/g,c=>"-"+c.toLowerCase()).replace(/^team-/,"data-team-");}};
      const event={target:{closest:()=>button}};events.click.forEach(fn=>fn(event));
    }
    function submit(attr,data){const form={dataset:{},data,hasAttribute:name=>name===attr};let prevented=false;events.submit.forEach(fn=>fn({target:form,preventDefault(){prevented=true;}}));assert(prevented);}
    return{api:context.window.SpartaTeamAccess,target,state,calls,click,submit,context,team:()=>team,setTeam(value){team=clone(value);},fail(value){fail=value;},hold(value){holdTeam=value;}};
  }
  const flush=async()=>{for(let index=0;index<10;index++)await Promise.resolve();};let passed=0;
  const local=harness({local:true});local.api.render(local.target);await local.api.refresh();assert.equal(local.calls.length,0);assert.match(local.target.innerHTML,/Локальна база/);assert(!local.api.canManage());passed++;
  const staff=harness({role:"brigadier",userId:"worker"});staff.api.render(staff.target);await staff.api.refresh();assert.equal(staff.calls.length,0);assert.match(staff.target.innerHTML,/Майстер/);assert.doesNotMatch(staff.target.innerHTML,/data-team-member=|worker@example/);assert.match(staff.api.descriptions.brigadier,/призначені/);passed++;
  const owner=harness();owner.api.render(owner.target);await owner.api.refresh();assert.equal(owner.calls.filter(c=>c.name==="sparta_team_list").length,1);assert.match(owner.target.innerHTML,/data-team-member="worker"/);assert.match(owner.target.innerHTML,/&lt;img/);assert.doesNotMatch(owner.target.innerHTML,/<img src=x/);assert.match(owner.target.innerHTML,/Останній вхід/);assert.match(owner.target.innerHTML,/Власний доступ/);passed++;
  await assert.rejects(owner.api.updateMember("owner","installer",false),/Власний доступ/);assert.equal(owner.calls.filter(c=>c.name==="sparta_team_update_member").length,0);passed++;
  await owner.api.updateMember("worker","brigadier",true);assert.equal(owner.team().members.find(m=>m.userId==="worker").role,"brigadier");assert.match(owner.target.innerHTML,/Зміну збережено в журналі/);assert.equal(owner.calls.find(c=>c.name==="sparta_team_update_member").payload.p_company_id,"company");passed++;
  await owner.api.updateMember("worker","brigadier",false);assert.equal(owner.team().members.find(m=>m.userId==="worker").isActive,false);await owner.api.updateMember("worker","brigadier",true);assert.equal(owner.team().members.find(m=>m.userId==="worker").isActive,true);passed++;
  const admin=harness({role:"admin",userId:"admin"});admin.api.render(admin.target);await admin.api.refresh();await assert.rejects(admin.api.updateMember("owner","installer",false),/власник/);await assert.rejects(admin.api.updateMember("worker","admin",true),/власник/);await assert.rejects(admin.api.revokeInvitation("admin-invite"),/власник/);assert.equal(admin.calls.filter(c=>/update_member|revoke_invitation/.test(c.name)).length,0);passed++;
  owner.click("teamTab","invitations");assert.match(owner.target.innerHTML,/Очікує прийняття/);assert.match(owner.target.innerHTML,/Не вдалося надіслати лист/);assert.match(owner.target.innerHTML,/data-team-resend="new@example.invalid"/);await owner.api.revokeInvitation("invite");assert.equal(owner.team().invitations[0].status,"revoked");assert.match(owner.target.innerHTML,/Історію збережено/);passed++;
  owner.click("teamTab","activity");await flush();assert.match(owner.target.innerHTML,/Що змінилося/);assert.match(owner.target.innerHTML,/&lt;script&gt;/);assert.match(owner.target.innerHTML,/&lt;svg/);assert.doesNotMatch(owner.target.innerHTML,/<script>|<svg onload/);assert.match(owner.target.innerHTML,/Події фіксуються з моменту/);passed++;
  const auditCallsBefore=owner.calls.filter(c=>c.name==="sparta_audit_list").length;owner.click("teamAuditNext");await flush();const nextCall=owner.calls.filter(c=>c.name==="sparta_audit_list").at(-1);assert.equal(nextCall.payload.p_before_id,"9007199254740997");assert.equal(owner.calls.filter(c=>c.name==="sparta_audit_list").length,auditCallsBefore+1);assert.match(owner.target.innerHTML,/Сторінка 2/);owner.click("teamAuditPrev");await flush();assert.equal(owner.calls.filter(c=>c.name==="sparta_audit_list").at(-1).payload.p_before_id,null);passed++;
  owner.submit("data-team-audit-filter",{actor:"worker",entity:"projects",action:"update",from:"2026-10-25",to:"2026-10-25"});await flush();const filterCall=owner.calls.filter(c=>c.name==="sparta_audit_list").at(-1);assert.equal(filterCall.payload.p_actor,"worker");assert.equal(filterCall.payload.p_entity,"projects");assert.equal(filterCall.payload.p_action,"update");assert.equal(filterCall.payload.p_before_id,null);assert.equal(filterCall.payload.p_from,"2026-10-24T21:00:00.000Z");assert.equal(filterCall.payload.p_to,"2026-10-25T22:00:00.000Z");passed++;
  const callsBeforeInvalid=owner.calls.length;owner.submit("data-team-audit-filter",{from:"2026-11-01",to:"2026-10-25"});await flush();assert.equal(owner.calls.length,callsBeforeInvalid);assert.match(owner.target.innerHTML,/Початок періоду/);passed++;
  const stale=harness();let resolveOld;stale.hold(new Promise(resolve=>{resolveOld=resolve;}));stale.api.render(stale.target);stale.state.companyId="company-b";stale.setTeam({members:[{userId:"owner",fullName:"Company B owner",role:"owner",isActive:true}],invitations:[]});stale.api.render(stale.target);await stale.api.refresh();resolveOld({data:clone(initial),error:null});await flush();assert.match(stale.target.innerHTML,/Company B owner/);assert.doesNotMatch(stale.target.innerHTML,/worker@example/);passed++;
  stale.state.memberRole="installer";stale.api.render(stale.target);assert(!stale.api.canManage());assert.doesNotMatch(stale.target.innerHTML,/Company B owner|data-team-member=/);passed++;
  const unavailable=harness();unavailable.fail({code:"PGRST202",message:"Missing migration"});unavailable.api.render(unavailable.target);await unavailable.api.refresh();assert.match(unavailable.target.innerHTML,/ще не налаштовано/);assert.doesNotMatch(unavailable.target.innerHTML,/worker@example/);assert.equal(unavailable.calls.length,1);passed++;
  const revoked=harness();revoked.api.render(revoked.target);await revoked.api.refresh();revoked.click("teamTab","activity");await flush();assert.match(revoked.target.innerHTML,/worker@example/);revoked.fail({code:"42501",message:"Permission changed"});await revoked.api.refresh();assert.match(revoked.target.innerHTML,/Доступ до керування командою змінився/);assert.doesNotMatch(revoked.target.innerHTML,/worker@example|&lt;script&gt;/);passed++;
  const resendButton=(instance,email)=>{const match=[...instance.target.innerHTML.matchAll(/<button\b[^>]*data-team-resend="([^"]+)"[^>]*>/g)].find(item=>item[1]===email);assert(match,`Missing resend button for ${email}`);return match[0];};
  const delivery=harness();const sendingTeam=delivery.team();sendingTeam.invitations[0].lastSendStatus="sending";delivery.setTeam(sendingTeam);
  delivery.api.render(delivery.target);await delivery.api.refresh();delivery.click("teamTab","invitations");
  assert.match(delivery.target.innerHTML,/Лист надсилається/);assert.match(resendButton(delivery,"new@example.invalid"),/data-team-resend=/);assert.doesNotMatch(resendButton(delivery,"new@example.invalid"),/\bdisabled\b/);passed++;
  const callsBeforeDelivery=delivery.calls.length;
  delivery.api.setInvitationDelivery(" NEW@EXAMPLE.INVALID ",{pending:true});
  assert.match(resendButton(delivery,"new@example.invalid"),/\bdisabled\b/);assert.doesNotMatch(resendButton(delivery,"admin2@example.invalid"),/\bdisabled\b/);assert.match(delivery.target.innerHTML,/Надсилаю…/);assert.equal(delivery.calls.length,callsBeforeDelivery);passed++;
  await delivery.api.refresh();assert.match(resendButton(delivery,"new@example.invalid"),/\bdisabled\b/);
  delivery.api.setInvitationDelivery("admin2@example.invalid",{pending:true});assert.match(resendButton(delivery,"admin2@example.invalid"),/\bdisabled\b/);
  delivery.api.setInvitationDelivery("new@example.invalid",{pending:false,ok:false,message:'Не надіслано <script>bad()</script>'});
  assert.match(delivery.target.innerHTML,/role="alert">Не надіслано &lt;script&gt;/);assert.doesNotMatch(delivery.target.innerHTML,/<script>/);assert.doesNotMatch(resendButton(delivery,"new@example.invalid"),/\bdisabled\b/);assert.match(resendButton(delivery,"admin2@example.invalid"),/\bdisabled\b/);passed++;
  await delivery.api.refresh();delivery.api.setInvitationDelivery("admin2@example.invalid",{pending:false,ok:true,message:"Лист для адміністратора надіслано."});
  assert.match(delivery.target.innerHTML,/role="status">Лист для адміністратора надіслано\./);assert.doesNotMatch(delivery.target.innerHTML,/role="alert"/);assert.doesNotMatch(resendButton(delivery,"new@example.invalid"),/\bdisabled\b/);assert.doesNotMatch(resendButton(delivery,"admin2@example.invalid"),/\bdisabled\b/);passed++;
  delivery.api.setInvitationDelivery("new@example.invalid",{pending:true});delivery.api.setInvitationDelivery("admin2@example.invalid",{pending:true});
  delivery.state.companyId="company-b";delivery.api.render(delivery.target);await delivery.api.refresh();delivery.click("teamTab","invitations");
  assert.doesNotMatch(resendButton(delivery,"new@example.invalid"),/\bdisabled\b/);assert.doesNotMatch(resendButton(delivery,"admin2@example.invalid"),/\bdisabled\b/);assert.doesNotMatch(delivery.target.innerHTML,/Лист для адміністратора надіслано\./);passed++;
  staff.api.setInvitationDelivery("new@example.invalid",{pending:false,ok:false,message:"Private delivery result"});assert.equal(staff.calls.length,0);assert.doesNotMatch(staff.target.innerHTML,/Private delivery result|data-team-resend=/);passed++;
  return{passed};
}
module.exports=run;
if(require.main===module)run(process.argv[2],process.argv[3]).then(console.log).catch(error=>{console.error(error);process.exitCode=1;});
