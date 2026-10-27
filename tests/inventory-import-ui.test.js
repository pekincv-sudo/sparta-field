"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
module.exports=async function(directory=path.resolve(__dirname,'..')){
 const source=fs.readFileSync(path.join(directory,'inventory-import-ui.js'),'utf8');
 const api=require(path.join(directory,'inventory-import.js')).create(require(path.join(directory,'warehouse-core.js')));
 const csv='name;sku;unit;category;currency;purchasePrice;installerPrice;retailPrice;wholesalePrice;qty;sourceRow\nПанель;PV;шт;Фотомодулі;UAH;3000;3200;3500;;100;3\nІнвертор;INV;шт;Інвертори;UAH;;;;;100;4\n';
 const clone=v=>JSON.parse(JSON.stringify(v));
 const flush=async()=>{for(let i=0;i<24;i++)await new Promise(setImmediate);};
 function setup(options={}){
  const calls={loads:0,writes:0,commits:0,downloads:[],blobs:[],renders:0};
  let server={revision:1,items:[],movements:[],documents:[],reservations:[],projects:[],orderReservations:[]};
  const nodes=[];
  function element(tag){const listeners={};return {tag,innerHTML:'',open:false,hidden:false,files:[],listeners,setAttribute(){},addEventListener(t,fn){listeners[t]=fn;},contains(){return true;},showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;},click(){if(tag==='a')calls.downloads.push(this.download);}};}
  const state={ready:true,client:{},user:{id:'owner'},companyId:'company',memberRole:options.role||'owner',audience:options.audience||'staff'};
  let blockRead=null;
  const cloud={async load(){calls.loads++;if(blockRead)await blockRead;return clone(server);},snapshot(){return clone(server);},async transact(fn){calls.writes++;const next=fn(clone(server));server={...clone(next),revision:server.revision+1};calls.commits++;if(options.loseResponse){options.loseResponse=false;throw new Error('Connection lost after commit');}return clone(server);}};
  const sandbox={cloudState:state,cloudContextRevision:1,window:{SPARTA_LOCAL_WORKSPACE:{enabled:!!options.local},SpartaWarehouseCloud:cloud,SpartaInventoryImport:api,SpartaWarehouseUI:{render(){calls.renders++;}}},document:{body:{append(n){nodes.push(n);}},createElement:element,querySelector(){return {}; }},crypto:crypto.webcrypto,Blob,TextDecoder,Uint8Array,Date,Intl,URL:{createObjectURL(blob){calls.blobs.push(blob);return 'blob:'+calls.blobs.length;},revokeObjectURL(){}},setTimeout(){},console};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);
  const ui=sandbox.window.SpartaInventoryImportUI;
  const dialog=()=>nodes.findLast(n=>n.tag==='dialog'&&!n.removed);
  const dispatch=async(type,target)=>{dialog().listeners[type]?.({target,preventDefault(){}});await flush();};
  const click=action=>dispatch('click',{dataset:{whImportAction:action},closest(){return this;}});
  const choose=async(text=csv)=>{const b=Buffer.from(text);await dispatch('change',{id:'whImportFile',files:[{name:'Номенклатура СЕС.csv',size:b.length,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.length)}]});
   // WebCrypto completes on the worker pool, not after a fixed number of
   // immediate callbacks. Wait for its observable result, including cancellation.
   const deadline=Date.now()+2000;
   while(dialog()?.innerHTML.includes('Перевіряємо файл')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,1));
   if(dialog()?.innerHTML.includes('Перевіряємо файл'))throw new Error('File preview did not settle');
  };
  const ack=()=>dispatch('change',{id:'whImportBackupAck',checked:true});
  const submit=()=>dispatch('submit',{});
  return {ui,state,calls,sandbox,dialog,click,choose,ack,submit,server:()=>server,setRevision(){server.revision++;},block(p){blockRead=p;}};
 }
 const checks=[],check=async(name,fn)=>{await fn();checks.push(name);};
 await check('Only active owner/admin/warehouse cloud sessions can open an import',async()=>{
  for(const opt of [{role:'engineer'},{role:'installer'},{audience:'buyer'},{local:true}]){const f=setup(opt);await assert.rejects(f.ui.open());assert.equal(f.calls.loads,0);assert.equal(f.calls.commits,0);}
 });
 await check('Actual CSV is previewed with known/unknown costs; backup and explicit acknowledgment gate one atomic write',async()=>{
  const f=setup();await f.ui.open();await f.choose();
  assert.match(f.dialog().innerHTML,/невідомою собівартістю: 1/);assert.match(f.dialog().innerHTML,/UAH/);assert.doesNotMatch(f.dialog().innerHTML,/undefined/);
  await f.submit();assert.equal(f.calls.commits,0);
  await f.click('backup');assert.equal(f.calls.downloads.length,1);const backup=JSON.parse(await f.calls.blobs[0].text());assert.equal(backup.companyId,'company');assert.equal(backup.warehouse.items.length,0);
  await f.submit();assert.equal(f.calls.commits,0);await f.ack();await f.submit();assert.equal(f.calls.commits,1);assert.equal(f.server().items.length,2);assert(f.server().items.every(i=>i.qty===100&&i.currency==='UAH'));
  assert.match(f.dialog().innerHTML,/Обладнання додано/);assert.equal(f.calls.renders,1);await f.submit();assert.equal(f.calls.commits,1);
 });
 await check('Reloading the same file after success recognizes posted import instead of adding another 100',async()=>{
  const f=setup();await f.ui.open();await f.choose();await f.click('backup');await f.ack();await f.submit();f.ui.reset();await f.ui.open();await f.choose();assert.match(f.dialog().innerHTML,/уже додано до складу/);await f.submit();assert.equal(f.calls.commits,1);
 });
 await check('Concurrent stock edits invalidate the backup and stop the import before mutation',async()=>{
  const f=setup();await f.ui.open();await f.choose();await f.click('backup');await f.ack();f.setRevision();await f.submit();assert.equal(f.calls.commits,0);assert.match(f.dialog().innerHTML,/Склад змінився після створення резервної копії/);assert.equal(f.server().items.length,0);
 });
 await check('A response lost after commit is reconciled through the real deterministic plan without another posting',async()=>{
  const f=setup({loseResponse:true});await f.ui.open();await f.choose();await f.click('backup');await f.ack();await f.submit();assert.equal(f.calls.commits,1);assert.match(f.dialog().innerHTML,/Сервер підтвердив імпорт/);await f.submit();assert.equal(f.calls.commits,1);
 });
 await check('Role changes and stale async responses close the dialog and never show another identity data',async()=>{
  const f=setup();await f.ui.open();let resume;const pending=new Promise(r=>{resume=r;});f.block(pending);const chosen=f.choose();await flush();f.state.user={id:'other'};resume();await chosen;await flush();assert.equal(f.calls.commits,0);assert(!f.dialog());
 });
 await check('Unexpected quantities cannot be posted through the initial-stock UI',async()=>{
  const f=setup();await f.ui.open();await f.choose(csv.replaceAll(';100;',';99;'));assert.match(f.dialog().innerHTML,/рівно 100/);await f.submit();assert.equal(f.calls.commits,0);
 });
 return {passed:checks.length,checks};
};
if(require.main===module)module.exports().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e);process.exitCode=1;});
