import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const swSource=await readFile(new URL("../sw.js",import.meta.url),"utf8");
const listeners={};
const writes=[];
const cached=new Response("cached shell");
const sw={
  URL,Response, self:{location:{origin:"https://school.test"},addEventListener:(name,fn)=>listeners[name]=fn},
  caches:{open:async()=>({put:async(...args)=>writes.push(args)}),match:async(key)=>key==="./index.html"?cached:undefined},
  fetch:async()=>{throw new Error("offline");}
};
vm.runInNewContext(swSource,sw);
async function request(url, {authorization=false,mode="cors"}={}) {
  let response;
  const waits=[];
  listeners.fetch({request:{url,method:"GET",mode,headers:{has:()=>authorization}},
    respondWith:(value)=>response=value, waitUntil:(value)=>waits.push(value)});
  const result=await response; await Promise.all(waits);return result;
}
assert.equal(await request("https://project.supabase.co/rest/v1/battle_players"),undefined);
assert.equal(await request("https://school.test/api/ai"),undefined);
assert.equal(await request("https://school.test/private",{authorization:true}),undefined);
assert.equal((await request("https://school.test/arena.js")).type,"error");
assert.equal(await request("https://school.test/",{mode:"navigate"}),cached);
sw.fetch=async()=>new Response("unavailable",{status:503});
assert.equal((await request("https://school.test/arena.js")).status,503);
assert.equal(writes.length,0);
sw.fetch=async()=>new Response("script");
assert.equal((await request("https://school.test/arena.js")).status,200);
assert.equal(writes.length,1);
console.log("PASS API/auth responses are never cached; offline scripts never become HTML; failed responses are not stored");

const app=await readFile(new URL("../app.js",import.meta.url),"utf8");
function extract(name) {
  const start=app.search(new RegExp("(?:async )?function "+name+"\\("));
  assert.ok(start>=0,name);
  return app.slice(start,app.indexOf("\n}",start)+2);
}
let resolveRead;
let applied=0;
const sent=[];
const context={
  Cloud:{enabled:true,loadSnapshot:()=>new Promise((resolve)=>resolveRead=resolve),
    upsertAssignments:async(value)=>sent.push(value)},
  cloudProfile:{role:"teacher"},cloudWriteRevision:0,cloudWritesPending:0,materialSaveInProgress:false,
  cloudSyncQueue:Promise.resolve(),progressRefreshInFlight:false,lastCloudSyncError:null,lastCloudSyncErrorAt:0,
  assignments:[{id:"assignment",classId:"old"}],ASSIGNMENTS_KEY:"assignments",
  localStorage:{setItem:()=>{}},structuredClone,Date,console,applyCloudSnapshot:()=>applied++,
  renderPapers:()=>{},renderAssignments:()=>{},renderTeacherClasses:()=>{},renderClassPerformance:()=>{},
  renderTeacherMetrics:()=>{},activePaperFilter:"",activeWorkspaceView:"arena",showToast:()=>{},localized:(x)=>x
};
vm.createContext(context);
vm.runInContext(["syncCloud","saveAssignments","refreshTeacherProgress"].map(extract).join("\n"),context);
const refresh=context.refreshTeacherProgress();
context.assignments[0].classId="new";
context.saveAssignments();
context.assignments[0].classId="changed after queue";
await context.cloudSyncQueue;
resolveRead({assignments:[{classId:"old"}]});
await refresh;
assert.equal(applied,0,"in-flight stale read must not overwrite newer save, even after save completes");
assert.equal(sent[0][0].classId,"new","queued writes must own immutable snapshots");
context.materialSaveInProgress=true;
await context.refreshTeacherProgress();
assert.equal(context.progressRefreshInFlight,false);
assert.equal(context.cloudWritesPending,0);
console.log("PASS background refresh cannot overwrite class edits; queued assignments save the selected snapshot");

const cloudSource=await readFile(new URL("../cloud.js",import.meta.url),"utf8");
const first=cloudSource.indexOf("  async function readSnapshotRows(");
const end=cloudSource.indexOf("\n  async function loadSnapshot(",first);
const pages=[];
const rows=Array.from({length:235},(_,id)=>({id}));
const paging={requireClient:()=>({from:()=>({
  select(){return this;},order(){return this;},
  async range(start,end){pages.push(start);return {data:rows.slice(start,Math.min(end+1,start+100)),count:rows.length};}
})}),unwrap:(result)=>result.data};
vm.createContext(paging);
vm.runInContext(cloudSource.slice(first,end),paging);
assert.equal((await paging.readSnapshotRows("assignment_questions")).data.length,235);
assert.deepEqual(pages,[0,100,200]);
console.log("PASS class/question snapshots handle server row caps smaller than the requested page size");

const arenaText={nodeValue:"36 / 40",parentElement:{closest:(selector)=>selector.includes("#arena-root")?{}:null}};
const vanillaText={nodeValue:"已完成",parentElement:{closest:()=>null}};
const translation={
  currentLanguage:"en",LANGUAGE_KEY:"language",localStorage:{setItem(){}},NodeFilter:{SHOW_TEXT:4},
  originalTextNodes:new WeakMap(),UI_EN:{"已完成":"Completed"},$$:()=>[],updateAIChatResizeControl(){},
  document:{body:{},documentElement:{},createTreeWalker(){let i=0;return{nextNode:()=>[arenaText,vanillaText][i++]};}}
};
translation.originalTextNodes.set(arenaText,{source:"0 / 40",leading:"",trailing:""});
vm.createContext(translation);
vm.runInContext(extract("applyLanguage"),translation);
translation.applyLanguage("en");
assert.equal(arenaText.nodeValue,"36 / 40","translation must not reset the React room count to its cached initial value");
assert.equal(vanillaText.nodeValue,"Completed","ordinary UI remains translated");
arenaText.nodeValue="750";
translation.applyLanguage("en");
assert.equal(arenaText.nodeValue,"750","subsequent background language refresh must not freeze live scores");
translation.applyLanguage("zh");
assert.equal(arenaText.nodeValue,"750");
assert.equal(vanillaText.nodeValue,"已完成");
console.log("PASS English/Chinese DOM translation cannot overwrite React room counts, scores or timers");
