"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
module.exports=async function(){
 const source=fs.readFileSync(path.join(__dirname,"../api/send-invitation.js"),"utf8").replace("export const config", "const config").replace("export default async function handler", "async function handler");
 const company="11111111-1111-4111-8111-111111111111",actor="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",invitation="22222222-2222-4222-8222-222222222222";
 const body={companyId:company,invitationId:invitation,email:"person@example.invalid",redirectTo:"https://untrusted.invalid"};let passed=0;
 function harness(options={}){
  const calls=[];const context=vm.createContext({URL,Response,AbortController,setTimeout,clearTimeout,process:{env:{SUPABASE_SERVICE_ROLE_KEY:options.missingKey?"":"test-only-service-key"}},fetch:async(url,init={})=>{
   const u=String(url);calls.push({url:u,body:init.body?JSON.parse(init.body):null});
   const result=(payload,status=200)=>new Response(JSON.stringify(payload),{status});
   if(u.endsWith('/auth/v1/user'))return result({id:actor,email_confirmed_at:options.unconfirmed?null:"2026-10-25T00:00:00Z"});
   if(u.includes('/company_members?'))return result([{role:options.actorRole||"owner",is_active:true}]);
   if(u.endsWith('/sparta_team_prepare_invitation_email'))return options.prepareError?result(options.prepareError,400):result({id:invitation,company_id:company,email:body.email,full_name:"Person",role:options.inviteRole||"installer",accepted_at:null,revoked_at:null,expires_at:"2099-01-01T00:00:00Z"});
   if(u.includes('/auth/v1/invite?'))return options.inviteError?result(options.inviteError,400):result({id:actor});
   if(u.includes('/auth/v1/recover?'))return result({});
   if(u.endsWith('/sparta_team_record_invitation_delivery'))return result(null,options.recordFailure?500:200);
   throw new Error('Unexpected endpoint '+u);
  }});vm.runInContext(source,context);
  const post=(overrides={},auth=true)=>context.handler(new Request("https://sparta-field-u2pe.vercel.app/api/send-invitation",{method:"POST",headers:{"Content-Type":"application/json",...(auth?{Authorization:"Bearer test-session"}:{})},body:JSON.stringify({...body,...overrides})}));
  return{post,calls};
 }
 let h=harness();assert.equal((await h.post({},false)).status,401);assert.equal(h.calls.length,0);passed++;
 h=harness();assert.equal((await h.post({invitationId:"bad"})).status,400);assert.equal(h.calls.length,0);passed++;
 h=harness({missingKey:true});assert.equal((await h.post()).status,503);assert.equal(h.calls.length,1);passed++;
 h=harness({unconfirmed:true});assert.equal((await h.post()).status,403);assert.equal(h.calls.length,1);passed++;
 h=harness({actorRole:"installer"});assert.equal((await h.post()).status,403);assert(!h.calls.some(c=>c.url.includes('/auth/v1/invite')));passed++;
 h=harness({actorRole:"admin",inviteRole:"admin"});assert.equal((await h.post()).status,403);assert(!h.calls.some(c=>c.url.includes('/auth/v1/invite')));passed++;
 h=harness();let response=await h.post();assert.equal(response.status,200);assert.equal((await response.json()).deliveryRecorded,true);let call=h.calls.find(c=>c.url.includes('/auth/v1/invite'));assert.equal(new URL(call.url).searchParams.get('redirect_to'),"https://sparta-field-u2pe.vercel.app/?auth=invite");assert(!JSON.stringify(h.calls).includes('untrusted.invalid'));assert.equal(h.calls.at(-1).body.p_actor_id,actor);passed++;
 h=harness({inviteError:{code:"unexpected_failure",message:"Private SMTP failure"}});response=await h.post();assert.equal(response.status,502);assert(!h.calls.some(c=>c.url.includes('/auth/v1/recover')));assert.equal(h.calls.at(-1).body.p_succeeded,false);assert(!(await response.text()).includes('Private SMTP'));passed++;
 h=harness({inviteError:{code:"email_exists"}});response=await h.post();assert.equal(response.status,200);call=h.calls.find(c=>c.url.includes('/auth/v1/recover'));assert.equal(new URL(call.url).searchParams.get('redirect_to'),"https://sparta-field-u2pe.vercel.app/?auth=recovery");assert.equal(h.calls.at(-1).body.p_mode,"recovery");passed++;
 h=harness({prepareError:{code:"P0001",message:"Invitation email cooldown: wait 60 seconds"}});response=await h.post();assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),"60");assert(!h.calls.some(c=>c.url.includes('/auth/v1/invite')));passed++;
 h=harness({prepareError:{code:"42501"}});assert.equal((await h.post()).status,403);assert(!h.calls.some(c=>c.url.includes('/auth/v1/invite')));passed++;
 h=harness({recordFailure:true});response=await h.post();const sent=await response.json();assert.equal(response.status,200);assert.equal(sent.deliveryRecorded,false);assert(sent.warning);passed++;
 return{passed};
};
