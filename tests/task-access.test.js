"use strict";
const assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
module.exports=async function(){let passed=0;
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8").match(/async function syncCrmTasksToCloud\([^]*?\n\}/)[0];
 function harness(office=false,result={id:"row",updated_at:"new-version"}){
  const calls=[];const task={id:"task",cloudTaskId:"row",cloudUpdatedAt:"old-version",status:"done",note:"Installed",assignedTo:"worker",title:"Installation"};
  const context=vm.createContext({cloudState:{ready:true,companyId:"company",user:{id:"worker"}},crmTasks:[task],pendingCrmDeletes:[],normalizeProjectId:String,Date,
   canCreateCrmTasks:()=>office,canManageCrmTask:(task)=>office||task.assignedTo==="worker",
   crmTaskToDb:(task)=>({title:task.title,status:task.status,note:task.note,assigned_to:task.assignedTo,created_by:"manager"}),
   renderProfileView(){},writeLocalStorage(){},savePendingCrmDeletes(){},guardedCloudWriteClient:()=>({from(){const q={update(data){calls.push({update:data});return q;},insert(data){calls.push({insert:data});return q;},eq(k,v){calls.push({eq:[k,v]});return q;},select(){return q;},async maybeSingle(){return{data:result};}};return q;}})});
  vm.runInContext(source,context);return{context,calls,task};
 }
 let h=harness();h.context.crmTasks.push({id:"someone-else",assignedTo:"other"});await h.context.syncCrmTasksToCloud();assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].update)),{status:"done",note:"Installed"});assert(h.calls.some(c=>c.eq?.[0]==="updated_at"&&c.eq[1]==="old-version"));assert.equal(h.task.cloudUpdatedAt,"new-version");passed++;
 h=harness();h.task.cloudSnapshot=JSON.stringify(h.context.crmTaskToDb(h.task));await h.context.syncCrmTasksToCloud();assert.equal(h.calls.length,0);passed++;
 h=harness(false,null);await assert.rejects(h.context.syncCrmTasksToCloud(),/іншому пристрої/);assert.equal(h.task.cloudUpdatedAt,"old-version");passed++;
 h=harness(true);delete h.task.cloudTaskId;await h.context.syncCrmTasksToCloud();assert(h.calls[0].insert);assert.equal(h.task.cloudTaskId,"row");passed++;
 return{passed};
};
