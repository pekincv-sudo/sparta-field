"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
module.exports=async function(){
 const source=fs.readFileSync(path.join(__dirname,"../api/send-invitation.js"),"utf8").replace("export const config", "const config").replace("export default async function handler", "async function handler");
 const company="11111111-1111-4111-8111-111111111111",actor="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",invitation="22222222-2222-4222-8222-222222222222";
 const body={companyId:company,invitationId:invitation,email:"person@example.invalid",redirectTo:"https://untrusted.invalid"};let passed=0;
 function harness(options={}){
  const calls=[];const context=vm.createContext({URL,Response,AbortController,setTimeout,clearTimeout,process:{env:{SUPABASE_SERVICE_ROLE_KEY:options.missingKey?"":options.serviceKey||"test-only-service-key",...(options.anonKey?{SUPABASE_ANON_KEY:options.anonKey}:{})}},fetch:async(url,init={})=>{
   const u=String(url);calls.push({url:u,headers:new Headers(init.headers),body:init.body?JSON.parse(init.body):null});
   const result=(payload,status=200)=>new Response(JSON.stringify(payload),{status});
   if(u.endsWith('/auth/v1/user'))return options.userError?result({},401):result({id:actor,email_confirmed_at:options.unconfirmed?null:"2026-10-25T00:00:00Z"});
   if(u.includes('/company_members?'))return result([{role:options.actorRole||"owner",is_active:true}]);
   if(u.endsWith('/sparta_team_prepare_invitation_email'))return options.prepareError?result(options.prepareError,400):result({id:invitation,company_id:company,email:body.email,full_name:"Person",role:options.inviteRole||"installer",accepted_at:null,revoked_at:null,expires_at:"2099-01-01T00:00:00Z"});
   if(u.includes('/auth/v1/invite?'))return options.inviteError?result(options.inviteError,400):result({id:actor});
   if(u.includes('/auth/v1/recover?'))return result({});
   if(u.endsWith('/sparta_buyer_prepare_invitation_email'))return options.prepareError?result(options.prepareError,400):result({id:invitation,company_id:company,buyer_id:options.badBuyerId?'invalid':'33333333-3333-4333-8333-333333333333',email:body.email,full_name:'Buyer',accepted_at:null,revoked_at:null,expires_at:'2099-01-01T00:00:00Z'});
   if(u.endsWith('/sparta_team_record_invitation_delivery')||u.endsWith('/sparta_buyer_record_invitation_delivery'))return result(null,options.recordFailure?500:200);
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
 // Exercise the complete invite/recovery path for both new keys and legacy JWTs.
 const legacyService="eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.test-signature";
 const legacyAnon="eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.test-signature";
 for(const keys of [
  {serviceKey:"sb_secret_test-only",anonKey:"sb_publishable_test-only",legacy:false},
  {serviceKey:legacyService,anonKey:legacyAnon,legacy:true},
 ]){
  for(const existingUser of [false,true]){
   h=harness({...keys,...(existingUser?{inviteError:{code:"email_exists"}}:{})});
   response=await h.post();assert.equal(response.status,200);assert.equal((await response.json()).mode,existingUser?"recovery":"invite");
   const userCall=h.calls[0];assert(userCall.url.endsWith('/auth/v1/user'));
   assert.equal(userCall.headers.get('apikey'),keys.anonKey);assert.equal(userCall.headers.get('authorization'),"Bearer test-session");
   const serviceCalls=h.calls.filter(c=>c.url.includes('/rest/v1/')||c.url.includes('/auth/v1/invite?'));
   assert.equal(serviceCalls.length,4); // Membership, prepare RPC, invite, delivery RPC.
   for(const serviceCall of serviceCalls){
    assert.equal(serviceCall.headers.get('apikey'),keys.serviceKey);
    assert.equal(serviceCall.headers.get('authorization'),keys.legacy?`Bearer ${keys.serviceKey}`:null);
    assert.equal(serviceCall.headers.get('content-type'),"application/json");
   }
   const recoveryCall=h.calls.find(c=>c.url.includes('/auth/v1/recover?'));
   assert.equal(Boolean(recoveryCall),existingUser);
   if(recoveryCall){
    assert.equal(recoveryCall.headers.get('apikey'),keys.anonKey);
    assert.equal(recoveryCall.headers.get('authorization'),keys.legacy?`Bearer ${keys.anonKey}`:null);
    assert.equal(recoveryCall.headers.get('content-type'),"application/json");
   }
   passed++;
  }
 }
 // The built-in publishable fallback must work without an anon-key env override.
 h=harness({serviceKey:"sb_secret_test-only",inviteError:{code:"email_exists"}});response=await h.post();assert.equal(response.status,200);
 call=h.calls.find(c=>c.url.includes('/auth/v1/recover?'));assert(call.headers.get('apikey').startsWith('sb_publishable_'));assert.equal(call.headers.get('authorization'),null);passed++;
 h=harness({serviceKey:"sb_secret_test-only",userError:true});assert.equal((await h.post()).status,401);assert.equal(h.calls.length,1);assert.equal(h.calls[0].headers.get('authorization'),"Bearer test-session");passed++;
 h=harness({serviceKey:"sb_secret_test-only",actorRole:"admin"});response=await h.post({kind:"buyer"});assert.equal(response.status,200);assert(h.calls.some(c=>c.url.endsWith('/sparta_buyer_prepare_invitation_email')));assert(!h.calls.some(c=>c.url.endsWith('/sparta_team_prepare_invitation_email')));call=h.calls.find(c=>c.url.includes('/auth/v1/invite'));assert.equal(call.body.data.buyer_account_id,'33333333-3333-4333-8333-333333333333');assert.equal(call.body.data.role,undefined);assert(h.calls.at(-1).url.endsWith('/sparta_buyer_record_invitation_delivery'));passed++;
 h=harness({inviteError:{code:"email_exists"}});response=await h.post({kind:"buyer"});assert.equal(response.status,200);assert.equal((await response.json()).mode,'recovery');assert(h.calls.at(-1).url.endsWith('/sparta_buyer_record_invitation_delivery'));passed++;
 h=harness({badBuyerId:true});assert.equal((await h.post({kind:"buyer"})).status,409);assert(!h.calls.some(c=>c.url.includes('/auth/v1/invite')));passed++;
 h=harness();assert.equal((await h.post({kind:"arbitrary_rpc"})).status,400);assert.equal(h.calls.length,0);passed++;
 h=harness({actorRole:"engineer"});assert.equal((await h.post({kind:"buyer"})).status,403);assert(!h.calls.some(c=>c.url.includes('/auth/v1/invite')));passed++;
 return{passed};
};
