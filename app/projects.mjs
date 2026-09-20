import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function atomicJSON(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2));fs.renameSync(tmp,file);}
export function fingerprint(root){
 const files=[];function walk(rel=''){for(const e of fs.readdirSync(path.join(root,rel),{withFileTypes:true})){const name=path.join(rel,e.name);if(e.isDirectory())walk(name);else if(/\.(exe|des|ics)$/i.test(name))files.push(name);}}walk();
 const digest=crypto.createHash('sha256');for(const name of files.sort())digest.update(name.replaceAll('\\','/').toLowerCase()+'\0'+hash(path.join(root,name))+'\n');return digest.digest('hex');
}
export function validateSource(input){
 let root=path.resolve(String(input||''));if(fs.existsSync(root)&&fs.statSync(root).isFile())root=path.dirname(root);
 if(!fs.existsSync(path.join(root,'HumMod.EXE'))&&fs.existsSync(path.join(root,'hummod-salt-master','HumMod.EXE')))root=path.join(root,'hummod-salt-master');
 for(const file of ['HumMod.EXE','HumMod.DES','Display/Display.DES','Structure/Structure.DES','Control/Control.DES'])if(!fs.existsSync(path.join(root,file)))throw Error('Not a complete HumMod installation: missing '+file);
 if(hash(path.join(root,'HumMod.EXE'))!=='4243e8721f77a5fabf3128fac5ac139588b20a8285d35d2021c6852d596803cb')throw Error('This engine build has not been validated. Choose the supported HumMod 3.0.4 installation.');
 return {root,fingerprint:fingerprint(root),version:'HumMod 3.0.4'};
}
export class ProjectStore {
 constructor(root,defaultSource){this.root=root;this.configFile=path.join(root,'config.json');this.prefs=fs.existsSync(this.configFile)?JSON.parse(fs.readFileSync(this.configFile,'utf8')):{sourcePath:fs.existsSync(defaultSource)?defaultSource:'',projectsHome:process.env.HUMMOD_PROJECTS_HOME||path.resolve(root,'../Experiments'),recent:[]};this.active=null;this.folder=null;}
 savePrefs(){atomicJSON(this.configFile,this.prefs);}
 remember(){const item={path:this.folder,name:this.active.name,openedAt:new Date().toISOString()};this.prefs.lastProject=this.folder;this.prefs.recent=[item,...(this.prefs.recent||[]).filter(x=>x.path.toLowerCase()!==this.folder.toLowerCase())].slice(0,16);this.savePrefs();}
 read(input){const folder=path.resolve(input.endsWith('.hummod')?path.dirname(input):input),file=path.join(folder,'experiment.hummod');const p=JSON.parse(fs.readFileSync(file,'utf8'));if(p.format!=='hummod-studio'||p.schema!==1||!/^[-a-f0-9]{36}$/.test(p.id)||!Array.isArray(p.journal)||!Array.isArray(p.checkpoints))throw Error('Unsupported experiment file');if(p.journal.length>100000)throw Error('Experiment journal is too large');return {folder,project:p};}
 activate(folder,p){this.folder=folder;this.active=p;this.remember();}
 create(name,parent,profile,origin='recorded'){
  name=String(name||'').trim();if(!name||name.length>100)throw Error('Use an experiment name between 1 and 100 characters');
  if(!path.isAbsolute(parent))throw Error('Choose an absolute folder path');
  let base=name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/,'');if(!base||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base))base='Experiment-'+crypto.randomBytes(3).toString('hex');
  fs.mkdirSync(parent,{recursive:true});let folder=path.join(parent,base);for(let n=2;fs.existsSync(folder);n++)folder=path.join(parent,base+' '+n);
  fs.mkdirSync(path.join(folder,'checkpoints'),{recursive:true});const p={format:'hummod-studio',schema:1,id:crypto.randomUUID(),name,createdAt:new Date().toISOString(),engineVersion:profile.version,modelFingerprint:profile.fingerprint,origin,replayable:origin==='recorded',journal:[],checkpoints:[],latest:null,pending:false};
  this.folder=folder;this.active=p;this.prefs.projectsHome=parent;this.save();this.remember();return p;
 }
 save(){if(this.active)atomicJSON(path.join(this.folder,'experiment.hummod'),this.active);}
 begin(){if(!this.active)return;this.active.pending=true;this.save();}
 commit(source,data,kind='save',label='Checkpoint',command=null){
  if(!this.active)return;
  const id=crypto.randomUUID(),file='checkpoints/'+id+'.SOL',target=path.join(this.folder,file);
  fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);
  const p=this.active;if(command)p.journal.push(command);
  const entry={id,file,sha256:hash(target),at:new Date().toISOString(),time:data.time,samples:data.samples,kind,label,journalLength:p.journal.length};p.checkpoints.push(entry);p.latest=id;p.pending=false;p.savedAt=entry.at;this.save();
 }
 checkpoint(id=this.active?.latest){const cp=this.active?.checkpoints.find(c=>c.id===id);if(!cp)throw Error('Checkpoint not found');if(!/^checkpoints\/[a-f0-9-]+\.SOL$/.test(cp.file))throw Error('Invalid checkpoint path');const file=path.join(this.folder,cp.file);if(hash(file)!==cp.sha256)throw Error('Checkpoint checksum mismatch. The file has changed.');return {entry:cp,file};}
 summary(){return this.active?{...this.active,folder:this.folder,journal:undefined,checkpoints:this.active.checkpoints.slice().reverse()}:null;}
}
