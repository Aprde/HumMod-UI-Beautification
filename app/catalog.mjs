import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
export const modelRoot=path.resolve(dir,'../hummod-salt-master');
let activeRoot=modelRoot;
function expand(file,stack=[]){
 if(stack.includes(file))throw Error('Include cycle: '+file);
 let base=activeRoot;
 return fs.readFileSync(file,'latin1').replace(/<!--[\s\S]*?-->/g,'').replace(/<\?(path|include)\s+([^?]+)\?>/g,(_,kind,target)=>{
  target=target.trim().replaceAll('\\',path.sep);
  if(kind==='path'){base=path.resolve(activeRoot,target);return '';}
  return expand(path.resolve(base,target),[...stack,file]);
 });
}
function parse(text){
 const root={tag:'root',children:[],text:''},stack=[root];let end=0;
 for(const m of text.matchAll(/<\/?[A-Za-z][\w-]*\s*\/?>/g)){
  stack.at(-1).text+=text.slice(end,m.index);end=m.index+m[0].length;
  const tag=m[0].match(/[A-Za-z][\w-]*/)[0].toLowerCase();
  if(m[0].startsWith('</')){if(stack.at(-1).tag!==tag)throw Error('Mismatched '+tag+' in '+stack.at(-1).tag);stack.pop();}
  else {const n={tag,children:[],text:''};stack.at(-1).children.push(n);if(!m[0].endsWith('/>'))stack.push(n);}
 }
 if(stack.length!==1)throw Error('Unclosed '+stack.at(-1).tag);
 return root;
}
const child=(n,t)=>n.children.find(x=>x.tag===t);
const txt=(n,t)=>child(n,t)?.text.trim()??'';
const find=(n,t)=>n.children.flatMap(x=>[...(x.tag===t?[x]:[]),...find(x,t)]);
function qualify(name,scope){return name&&!name.includes('.')&&scope?scope+'.'+name:name;}
export function buildCatalog(root=modelRoot){
 activeRoot=root;
 const tree=parse(expand(path.join(activeRoot,'Display/Display.DES')));
 const lists={},panels={},unknown=new Set(),widgets={};
 const containers=new Set(['root','display','common','panel','groupbox','page']);
 function walk(node,scope='',panel=null,group=null){
  for(const n of node.children){
   if(n.tag==='structurename'){scope=n.text.trim();continue;}
   if(n.tag==='panel'){
    const id=txt(n,'name');const p={id,title:txt(n.children.find(x=>x.tag==='label')??{children:[]},'text')||id,groups:[],fields:[],charts:[],notes:[],sliders:0,radios:0,edits:0,actions:0,checks:0};
    panels[id]=p;walk(n,scope,p,null);continue;
   }
   if(n.tag==='maplist'||n.tag==='repeatlist'){
    const name=qualify(txt(n,'name'),scope);let values=[];
    if(n.tag==='maplist')values=n.children.filter(x=>x.tag==='map').map(x=>({value:Number(txt(x,'val')),label:txt(x,'img')}));
    else{let value=Number(txt(n,'firstval')||0);values.push({value,label:String(value)});for(const rep of n.children.filter(x=>x.tag==='repeat'))for(let i=0;i<Number(txt(rep,'reps'));i++){value=Number((value+Number(txt(rep,'stepsize'))).toPrecision(12));values.push({value,label:String(value)});}}
    lists[name]=values;continue;
   }
   if(!panel){if(containers.has(n.tag))walk(n,scope,panel,group);continue;}
   if(n.tag==='groupbox'){const g={title:txt(n,'title'),fields:[],charts:[],notes:[]};panel.groups.push(g);scope=walk(n,scope,panel,g);continue;}
   const into=group??panel;
   if(/^(show|edit|slide|radio|check|action|info)/.test(n.tag))widgets[n.tag]=(widgets[n.tag]||0)+1;
   if(n.tag==='showmap'){unknown.add(n.tag);into.charts.push({kind:n.tag,label:'Native map',series:[]});continue;}
   if(['showvalue','checkmark','editbox','radiobuttons','slidebar','checkbox','actionbutton'].includes(n.tag)){
    const kind=n.tag;const name=qualify(txt(n,kind==='actionbutton'?'blockname':'name'),scope);
    const fmt=child(n,'format');const list=qualify(txt(n,'listname'),scope);
    const f={kind,name,label:txt(n,'label')||name.split('.').at(-1),list,format:fmt?{decimal:txt(fmt,'decimal'),integer:!!child(fmt,'integer'),list:qualify(txt(fmt,'list'),scope)}:{},row:Number(txt(n,'row')),col:Number(txt(n,'col'))};
    if(kind==='slidebar')f.ordinal=panel.sliders++;
    if(kind==='editbox')f.ordinal=panel.edits++;
    if(kind==='actionbutton')f.ordinal=panel.actions++;
    if(kind==='radiobuttons'){f.ordinal=panel.radios;panel.radios+=(lists[list]?.length??0);}
    if(kind==='checkbox')f.ordinal=panel.checks++;
    into.fields.push(f);continue;
   }
   if(n.tag==='showgraph'||n.tag==='showcurve'||n.tag==='showxyplot'){
    const x=child(n,'xaxis');const y=child(n,'yaxis');const chart={kind:n.tag,label:txt(y??{children:[]},'label')||'Time series',x:qualify(txt(x??{children:[]},'name'),scope),series:find(n,'yvar').map(v=>({name:qualify(txt(v,'name'),scope),label:txt(v,'label')||txt(v,'name')}))};
    chart.curve=qualify(txt(n,'curvename'),scope);chart.xLabel=txt(x??{children:[]},'label');chart.yLabel=txt(y??{children:[]},'label');
    into.charts.push(chart);continue;
   }
   if(n.tag==='infobutton'){into.notes.push(n.children.filter(x=>x.tag==='line').map(x=>x.text.trim()).join('\n'));continue;}
   if(n.tag==='showbargraph'){
    const scale=child(n,'scale');into.charts.push({kind:'showbargraph',label:txt(n,'title')||'Model variables',min:Number(txt(scale??{children:[]},'min')),max:Number(txt(scale??{children:[]},'max'))||null,initial:!!child(n,'showinitialvalues'),series:n.children.filter(x=>x.tag==='bar').map(bar=>({name:qualify(txt(bar,'name'),scope),label:txt(bar,'label')||txt(bar,'name')}))});
    continue;
   }
   if(n.tag==='showtable'){
    const columns=n.children.filter(x=>x.tag==='column').map(col=>col.children.filter(x=>['textcell','valuecell'].includes(x.tag)).map(x=>{if(x.tag==='textcell')return {text:x.text.trim()};const f=child(x,'format')??{children:[]};return {name:qualify(txt(x,'name'),scope),format:{decimal:txt(f,'decimal'),integer:!!child(f,'integer'),list:qualify(txt(f,'list'),scope)}};}));
    (into.tables??=[]).push(columns);continue;
   }
   if(n.tag==='label'){const label=txt(n,'text');if(label&&(group||Number(txt(n,'row'))>1))into.fields.push({kind:'label',label});continue;}
   if(containers.has(n.tag))walk(n,scope,panel,group);
   else if(!['name','title','showclock','showbitmap','row','col','high','wide','text','color','showbitmapfile','symbol','addarrowsnewline','displayfirst'].includes(n.tag))unknown.add(n.tag);
  }
  return scope;
 }
 walk(tree);
 const branches=find(tree,'branch').map(n=>({id:txt(n,'name'),label:txt(n,'label'),parent:txt(n,'parent'),branch:true}));
 const leaves=find(tree,'leaf').map(n=>({id:txt(n,'name'),label:txt(n,'label'),parent:txt(n,'parent'),branch:false}));
 const nodes=[...branches,...leaves],byId=new Map(branches.map(x=>[x.id,x]));
 const route=n=>{const p=byId.get(n.parent);return p?[...route(p),n.label]:[n.label];};
 for(const n of nodes)n.path=route(n).join('/');
 const catalog={nodes,panels,lists,stats:{panels:Object.keys(panels).length,branches:branches.length,leaves:leaves.length,unsupportedTags:[...unknown],widgets}};
 return catalog;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const c=buildCatalog();fs.writeFileSync(path.join(dir,'catalog.json'),JSON.stringify(c));console.log(c.stats);
}
