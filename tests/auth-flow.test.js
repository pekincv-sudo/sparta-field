"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
module.exports=async function(){let passed=0;
 const source=fs.readFileSync(path.join(__dirname,"../auth-flow.js"),"utf8");
 function harness(intent=""){
  const calls=[],listeners={},message={textContent:""},dialog={open:false,showModal(){this.open=true;calls.push('password dialog');}},passwordMessage={textContent:""};
  const elements=Object.fromEntries(['email','password','passwordConfirm','authMode','fullName'].map(name=>[name,{value:name==='email'?' PERSON@example.invalid ':name==='fullName'?'Person':'test-password',required:false,reportValidity:()=>true}]));
  const submit={textContent:"",disabled:false};
  const form={elements,querySelector:()=>submit,querySelectorAll:()=>[]};
  const state={ready:true,user:{id:'user'},companyId:'company',memberRole:'installer',client:{rpc:async(name,args)=>{calls.push({name,args});return{};},auth:{resetPasswordForEmail:async(email,options)=>{calls.push({email,options});return{};},getSession:async()=>({data:{session:{user:{id:'user'}}}})},from:()=>{const q={select(){return q;},eq(){return q;},async maybeSingle(){return{data:{role:'installer',is_active:true}}}};return q;}}};
  const window={location:{search:intent?'?auth='+intent:'',hash:'',href:'https://sparta-field-u2pe.vercel.app/'+(intent?'?auth='+intent:'')},history:{replaceState(...args){calls.push(args.at(-1));}},addEventListener(){},setInterval(){}};
  const context=vm.createContext({window,URL,URLSearchParams,PUBLIC_APP_URL:'https://sparta-field-u2pe.vercel.app/',cloudState:state,
   document:{querySelector(selector){return{'#gateAuthForm':form,'#gateAuthMessage':message,'#passwordDialog':dialog,'#passwordForm':{reset(){}},'#passwordMessage':passwordMessage}[selector];},addEventListener(name,fn){listeners[name]=fn;}},
   FormData:class{constructor(f){this.f=f;}get(k){return this.f.elements[k]?.value;}},authenticateUser:async(...args)=>calls.push({authenticate:args}),logoutCloudUser:async()=>{},clearCompanyContext(){state.ready=false;calls.push('clear');},updateAccessMode(){calls.push('access');},render(){calls.push('render');},applyCloudSession:async(session)=>calls.push({apply:session})});
  vm.runInContext(source,context);return{api:window.SpartaAuthFlow,window,form,state,calls,message,dialog,context};
 }
 let h=harness();h.api.setGateMode('signup');assert.equal(h.form.elements.password.minLength,8);h.form.elements.passwordConfirm.value='mismatch';await h.api.submitGate(h.form);assert.match(h.message.textContent,/не збігаються/);assert(!h.calls.some(c=>c.authenticate));passed++;
 h.form.elements.passwordConfirm.value='test-password';await h.api.submitGate(h.form);const signup=h.calls.find(c=>c.authenticate).authenticate;assert.equal(signup[0],'person@example.invalid');assert.equal(signup[2],'signup');assert.equal(signup[4],'Person');passed++;
 h=harness();h.api.setGateMode('recover');assert.equal(h.form.elements.password.required,false);await h.api.submitGate(h.form);assert.equal(h.calls[0].options.redirectTo,'https://sparta-field-u2pe.vercel.app/?auth=recovery');assert(!h.calls.some(c=>c.authenticate));passed++;
 h=harness('invite');h.window.location.search='';h.api.afterSession();assert.equal(h.dialog.open,true);h.api.passwordCompleted();h.dialog.open=false;h.api.afterSession();assert.equal(h.dialog.open,false);passed++;
 h=harness();h.api.onAuthEvent('PASSWORD_RECOVERY');h.api.afterSession();assert(h.dialog.open);passed++;
 h=harness();await h.api.recordSession('login');assert.equal(h.calls[0].name,'sparta_record_session_event');assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].args)),{p_company_id:'company',p_event:'login'});passed++;
 h=harness();h.state.client.from=()=>{const q={select(){return q;},eq(){return q;},async maybeSingle(){return{data:null};}};return q;};await h.api.refreshAccess();assert.equal(h.state.ready,false);assert(h.calls.includes('clear'));assert.match(h.state.message,/призупинено/);passed++;
 h=harness();h.state.client.from=()=>{const q={select(){return q;},eq(){return q;},async maybeSingle(){return{data:{role:'viewer',is_active:true}};}};return q;};await h.api.refreshAccess();assert(h.calls.some(c=>c.apply));assert(h.calls.includes('clear'));passed++;
 const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');const auth=app.match(/async function authenticateUser\([^]*?\n\}/)[0];
 h=harness();h.context.applyCloudSession=async()=>true;h.state.client.auth.signUp=async(data)=>{h.calls.push(data);return{data:{session:null}};};vm.runInContext(auth,h.context);await h.context.authenticateUser(' PERSON@example.invalid ','test-password','signup',h.message,'Full Person');const created=h.calls[0];assert.equal(created.options.data.full_name,'Full Person');assert.equal(created.options.emailRedirectTo,'https://sparta-field-u2pe.vercel.app/?auth=signup');assert.match(h.message.textContent,/підтверди/);passed++;
 return{passed};
};
