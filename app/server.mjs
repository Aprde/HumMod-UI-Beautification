import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {buildCatalog,modelRoot} from './catalog.mjs';
import {ProjectStore,validateSource,fingerprint} from './projects.mjs';
const exec=promisify(execFile),dir=path.dirname(fileURLToPath(import.meta.url));
const bridge=path.join(dir,'NativeBridge.exe'),defaultEngine=process.env.HUMMOD_ENGINE_DIR||path.join(dir,'engine'),sessions=process.env.HUMMOD_SESSION_DIR||path.join(dir,'sessions');
const store=new ProjectStore(process.env.HUMMOD_CONFIG_DIR||path.join(dir,'workspace-state'),modelRoot);
let engine=defaultEngine,readOnly=false,replaying=false,restoreProgress='',profile=null;
try{if(store.prefs.sourcePath)profile=validateSource(store.prefs.sourcePath);}catch(e){store.prefs.sourceError=e.message;}
const token=crypto.randomBytes(24).toString('hex'),port=Number(process.env.HUMMOD_UI_PORT||4318);
let catalog=profile?buildCatalog(profile.root):{nodes:[],panels:{},lists:{},stats:{panels:0,branches:0,leaves:0}};
let data=null,menu=[],connected=false,busy=false,error=null,activity=[],lastExport=null;
fs.mkdirSync(sessions,{recursive:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function native(...args){const {stdout}=await exec(bridge,args.map(String),{cwd:dir,windowsHide:true,timeout:330000,maxBuffer:8*1024*1024,env:{...process.env,HUMMOD_ENGINE_DIR:engine}});return stdout.trim();}
const inspect=async()=>JSON.parse(await native('inspect'));
function flatMenu(items){return items.flatMap(x=>[x,...flatMenu(x.children||[])]);}
function addActivity(text){activity.unshift({text,at:new Date().toISOString(),time:data?.values['System.X']??0});activity=activity.slice(0,80);}
export function parseSolution(text){
 if(!text.includes('<solution>')||!text.includes('</solution>'))throw Error('Incomplete solution file');
 const values={},series={};const indexMatch=text.match(/<index>\s*(\d+)\s*<\/index>/),index=indexMatch?Number(indexMatch[1]):null;
 for(const m of text.matchAll(/<var>\s*<name>\s*([^<]+?)\s*<\/name>([\s\S]*?)<\/var>/g)){
  const vals=[...m[2].matchAll(/<val>\s*([^<]*?)\s*<\/val>/g)].map(x=>{if(!x[1].trim())return null;const n=Number(x[1]);return Number.isFinite(n)?n:null;});
  if(vals.length){const name=m[1].trim();if(index!==null&&index>=vals.length)throw Error('Invalid solution index: '+name);values[name]=index===null?vals.at(-1):vals[index];series[name]=vals;}
 }
 if(!Number.isFinite(values['System.X']))throw Error('Solution has no valid simulation time');
 return {values,series,time:values['System.X'],index:index??series['System.X'].length-1,samples:series['System.X'].length,variables:Object.keys(values).length,capturedAt:new Date().toISOString()};
}
async function refresh(){
 const file=path.join(sessions,`snapshot-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.SOL`);
 await native('snapshot',file);const next=parseSolution(fs.readFileSync(file,'utf8'));
 const old=lastExport;lastExport=file;data=next;
 if(old&&old.startsWith(sessions+path.sep)&&fs.existsSync(old))fs.unlinkSync(old);
 return next;
}
async function attach(){
 if(!profile)throw Error('Configure your local HumMod installation first.');
 if(!fs.existsSync(path.join(engine,'HumMod.EXE')))fs.cpSync(profile.root,engine,{recursive:true});
 if(fingerprint(engine)!==profile.fingerprint)throw Error('Engine copy differs from the configured model. It has not been started.');
 await native('start');let snap;
 for(let i=0;i<200;i++){try{snap=await inspect();if(snap.menu.length>10&&snap.windows.find(w=>w.window.handle===snap.main)?.window.enabled)break;}catch{}await delay(100);}
 if(!snap||snap.menu.length<=10)throw Error('Engine not ready. Inspect the original window.');
 menu=flatMenu(snap.menu);connected=true;await native('hide');
}
const engineFor=p=>p.origin==='legacy'?defaultEngine:path.join(store.root,'engines',p.id);
async function isAlive(){try{await inspect();return true;}catch{return false;}}
function commit(kind,label,command){store.commit(lastExport,data,kind,label,command);}
function equalData(a,b){return a.index===b.index&&a.samples===b.samples&&Object.keys(a.values).length===Object.keys(b.values).length&&Object.keys(a.values).every(k=>a.values[k]===b.values[k])&&Object.keys(a.series).every(k=>JSON.stringify(a.series[k])===JSON.stringify(b.series[k]));}
async function saveCurrent(label='Saved checkpoint'){if(connected&&!readOnly){await refresh();commit('save',label);}}
async function detachCurrent(){
 await saveCurrent('Before switching experiments');
 // Legacy sessions have no reproducible journal. Keep their original process alive.
 if(connected&&store.active?.replayable){await native('close');await delay(600);}
 connected=false;data=null;menu=[];readOnly=false;activity=[];lastExport=null;
}
async function openProject(input){
 const {folder,project:p}=store.read(input);
 if(!profile||p.modelFingerprint!==profile.fingerprint)throw Error('This experiment requires its original model files. Configure the matching HumMod installation.');
 // Validate the checkpoint before leaving the current experiment.
 const previous={active:store.active,folder:store.folder};store.active=p;store.folder=folder;let saved;
 try{saved=store.checkpoint();parseSolution(fs.readFileSync(saved.file,'utf8'));}finally{store.active=previous.active;store.folder=previous.folder;}
 if(store.folder===folder&&connected)return;
 await detachCurrent();store.activate(folder,p);engine=engineFor(p);const expected=parseSolution(fs.readFileSync(saved.file,'utf8'));
 const alive=await isAlive();
 if(!alive&&(!p.replayable||p.pending)){
  data=expected;lastExport=saved.file;readOnly=true;restoreProgress='';addActivity('Saved results opened. This session has no verified replay journal.');return;
 }
 try{
  await attach();await refresh();
  if(!alive){
   replaying=true;
   for(let i=0;i<p.journal.length;i++){
    const command=p.journal[i];restoreProgress=`Restoring operation ${i+1} of ${p.journal.length}`;
    if(command.type==='run'){const item=menu.find(m=>m.id===command.id&&m.path.startsWith('Go/'));if(!item)throw Error('Invalid run in experiment journal');await native('run',item.id);}
    else if(command.type==='set')await setField(command.body);
    else if(command.type==='restart'){await native('command',7);await delay(300);}
    else throw Error('Unsupported journal operation');
   }
  }
  await refresh();
  if(!equalData(expected,data)){
   if(alive&&p.origin==='legacy'){p.replayable=false;commit('save','Live session recovered');}
   else throw Error('Restored engine does not exactly match the saved solution. Continuing is disabled; saved results remain available.');
  }
  p.pending=false;store.save();readOnly=false;addActivity(alive?'Reconnected to the live experiment':'Restored and verified every saved variable and sample');
 }catch(e){readOnly=true;data=expected;lastExport=saved.file;throw e;}
 finally{replaying=false;restoreProgress='';}
}
async function bootstrap(){
 if(store.active)return;
 if(store.prefs.lastProject){await openProject(store.prefs.lastProject);return;}
 if(!profile)return;
 engine=defaultEngine;
 if(await isAlive()){
  await attach();await refresh();store.create('Existing session',store.prefs.projectsHome,profile,'legacy');commit('import','Existing live experiment');addActivity('Existing session preserved without resetting the engine');
 }
}
async function createProject(body){
 if(!profile)throw Error('Configure an engine first');
 await detachCurrent();store.create(body.name,body.folder||store.prefs.projectsHome,profile);engine=engineFor(store.active);
 await attach();await refresh();commit('initial','Initial model state');readOnly=false;addActivity('Created experiment');
}
async function connect(){if(store.active)await openProject(store.folder);else await bootstrap();if(!store.active)throw Error('Create or open an experiment to begin.');}
function panelRoute(id){return catalog.nodes.find(n=>!n.branch&&n.id===id);}
async function navigate(id){const route=panelRoute(id);if(!route)throw Error('Original model page not found');const item=menu.find(m=>m.path===route.path&&m.id>0&&m.id<65535);if(!item)throw Error('Menu entry unavailable in this engine');await native('navigate',item.id);}
function allFields(panel){return [...panel.fields,...panel.groups.flatMap(g=>g.fields)];}
async function setField(body){
 const panel=catalog.panels[body.panel];if(!panel)throw Error('Unknown model page');
 const field=allFields(panel).find(f=>f.name===body.name&&f.kind===body.kind&&f.ordinal===body.ordinal);
 if(!field||!['slidebar','editbox','radiobuttons','checkbox','actionbutton'].includes(field.kind))throw Error('This field is not editable');
 let value=Number(body.value);if(field.kind!=='actionbutton'&&!Number.isFinite(value))throw Error('Enter a valid number');
 const options=catalog.lists[field.list];let index=options?.findIndex(o=>Math.abs(o.value-value)<1e-9*Math.max(1,Math.abs(value)));
 if(['slidebar','radiobuttons'].includes(field.kind)&&(index==null||index<0))throw Error('Choose a value supported by the native control');
 await navigate(body.panel);
 if(field.kind==='slidebar')await native('slider',field.ordinal,index,panel.sliders);
 else if(field.kind==='radiobuttons')await native('radio',field.ordinal+index,panel.radios);
 else if(field.kind==='editbox')await native('edit',field.ordinal,panel.edits,value);
 else if(field.kind==='checkbox'){
  if(value!==0&&value!==1)throw Error('Invalid switch value');
  if(data.values[field.name]!==value)await native('check',field.ordinal,panel.checks);
 }else await native('action',field.ordinal,panel.actions);
 await refresh();
 if(field.kind!=='actionbutton'&&(!Number.isFinite(data.values[field.name])||Math.abs(data.values[field.name]-value)>1e-7*Math.max(1,Math.abs(value))))throw Error('Engine read-back differs from the requested value. Inspect the original page.');
 addActivity(field.kind==='actionbutton'?`Invoked ${field.label}`:`${field.label} → ${value}`);
}
function state(){return {connected,busy,error,data,activity,readOnly,restoreProgress,project:store.summary(),preferences:store.prefs,configured:!!profile,durations:menu.filter(x=>x.path.startsWith('Go/')&&x.id>0&&x.id<65535).map(x=>({label:x.label,id:x.id})),engine:'HumMod 3.0.4',nativeMenu:menu.filter(x=>x.id>0&&x.id<65535).map(x=>({id:x.id,path:x.path,label:x.label})),nativeDialogs:[]};}
async function operate(route,body){
 if(route==='/api/show'){await native('show');if(store.active){store.active.replayable=false;store.save();}return {};}
 if(route==='/api/stop'){if(store.active){store.active.replayable=false;store.save();}await native('command',6);return {};}
 if(busy)throw Error('Another operation is in progress. Please wait.');
 busy=true;error=null;
 try{
  if(route==='/api/pick-folder')return {path:await native('pick-folder',body.path||store.prefs.projectsHome)};
  if(route==='/api/configure'){
   const next=validateSource(body.path);const nextCatalog=buildCatalog(next.root);
   if(store.active&&store.active.modelFingerprint!==next.fingerprint)throw Error('The current experiment uses a different model. Restart the workspace before changing engine versions.');
   profile=next;catalog=nextCatalog;store.prefs.sourcePath=next.root;delete store.prefs.sourceError;store.savePrefs();return {ok:true};
  }
  if(route==='/api/bootstrap')await bootstrap();
  else if(route==='/api/project/create')await createProject(body);
  else if(route==='/api/project/open')await openProject(String(body.path||''));
  else if(route==='/api/project/save'){if(readOnly)throw Error('This experiment is open for viewing only');await saveCurrent();}
  else if(route==='/api/shutdown'){
   await saveCurrent('Before closing');if(connected)await native('close');
   setTimeout(()=>server.close(()=>process.exit(0)),300);return {ok:true};
  }
  else if(route==='/api/connect')await connect();
  else{
   if(!connected)throw Error('Create or open an experiment first.');
   if(readOnly&&!['/api/native-panel'].includes(route))throw Error('This experiment is open for viewing only. Create a new experiment to run the model.');
   if(route==='/api/refresh'){
    const before=data;await refresh();if(store.active&&before&&!equalData(before,data))store.active.replayable=false;
    commit('save','Refreshed from engine');
   }
   else if(route==='/api/run'){
    const item=menu.find(x=>x.path.startsWith('Go/')&&x.id===Number(body.id));if(!item)throw Error('Invalid run duration');
    store.begin();await native('run',item.id);await refresh();commit('run',item.label,{type:'run',id:item.id});addActivity(`Completed run · ${item.label}`);
   }else if(route==='/api/set'){
    store.begin();await setField(body);commit('parameter',body.name,{type:'set',body:{panel:body.panel,name:body.name,kind:body.kind,ordinal:body.ordinal,value:body.value}});
   }else if(route==='/api/native-command'){
    const item=menu.find(m=>m.id===Number(body.id)&&m.id>0&&m.id<65535);if(!item)throw Error('Unknown engine command');
    await saveCurrent('Before native command');
    if([1,2,3,8].includes(item.id)){store.active.replayable=false;store.save();}
    await native('show');await native('command',item.id);addActivity('Native command · '+item.path);
    if(item.id===5)connected=false;
   }
   else if(route==='/api/native-panel'){await navigate(body.panel);await native('show');if(store.active){store.active.replayable=false;store.save();}}
   else if(route==='/api/restart'){await saveCurrent('Before reset');store.begin();await native('command',7);await delay(300);await refresh();commit('reset','Model reset',{type:'restart'});addActivity('Model reset');}
   else throw Error('Unknown operation');
  }
  return {ok:true};
 }catch(e){error=e.stderr?.trim()||e.message;if(store.active?.pending){store.active.replayable=false;store.save();}throw Error(error);}finally{busy=false;}
}
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const origin=`http://127.0.0.1:${port}`;
 if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);return res.end();}
 const url=new URL(req.url,origin);
 const json=(code,obj)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));};
 try{
  if(url.pathname.startsWith('/api/')){
   if(req.headers['x-hummod-token']!==token||(req.headers.origin&&req.headers.origin!==origin))return json(403,{error:'Forbidden'});
   if(req.method==='GET'&&url.pathname==='/api/state')return json(200,state());
   if(req.method==='GET'&&url.pathname==='/api/catalog')return json(200,catalog);
   if(req.method==='GET'&&url.pathname==='/api/checkpoint'){const cp=store.checkpoint(url.searchParams.get('id'));res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="HumMod-'+cp.entry.kind+'-'+cp.entry.time+'min.SOL"'});return fs.createReadStream(cp.file).pipe(res);}
   if(req.method==='GET'&&url.pathname==='/api/export'){
    if(!lastExport)throw Error('No results available');res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="HumMod.SOL"'});return fs.createReadStream(lastExport).pipe(res);
   }
   if(req.method!=='POST')return json(405,{error:'Method not allowed'});
   let raw='';for await(const c of req){raw+=c;if(raw.length>100000)throw Error('Request too large');}
   const out=await operate(url.pathname,JSON.parse(raw||'{}'));return json(200,out);
  }
  const fonts={'/assets/fonts/DMSans.ttf':'DMSans.ttf','/assets/fonts/Lora.ttf':'Lora.ttf','/assets/fonts/Lora-Italic.ttf':'Lora-Italic.ttf'};
  if(fonts[url.pathname]){res.writeHead(200,{'Content-Type':'font/ttf','Cache-Control':'public, max-age=86400'});return fs.createReadStream(path.join(dir,'assets/fonts',fonts[url.pathname])).pipe(res);}
  if(url.pathname==='/assets/hummod.ico'){res.writeHead(200,{'Content-Type':'image/x-icon'});return fs.createReadStream(path.join(dir,'assets/hummod.ico')).pipe(res);}
  if(url.pathname==='/assets/icon-256.png'){res.writeHead(200,{'Content-Type':'image/png'});return fs.createReadStream(path.join(dir,'assets/icon-256.png')).pipe(res);}
  if(url.pathname==='/assets/hummod-mark.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml'});return fs.createReadStream(path.join(dir,'assets/hummod-mark.svg')).pipe(res);}
  const routes={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
  const file=routes[url.pathname];if(!file){res.writeHead(404);return res.end('Not found');}
  const type=file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html';
  res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"});
  res.end(fs.readFileSync(path.join(dir,file),'utf8').replace('__TOKEN__',token));
 }catch(e){json(400,{error:e.message});}
});
if(process.argv[1]===fileURLToPath(import.meta.url))server.listen(port,'127.0.0.1',()=>console.log(`HumMod UI: http://127.0.0.1:${port}`));
