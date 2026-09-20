import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProjectStore} from '../app/projects.mjs';

const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'hummod-ui-check-'));
process.env.HUMMOD_CONFIG_DIR=path.join(temporary,'config');
process.env.HUMMOD_SESSION_DIR=path.join(temporary,'sessions');
try {
 const {parseSolution}=await import('../app/server.mjs');
 const solution='<solution><index>1</index><var><name>System.X</name><val>0</val><val>1</val></var><var><name>Example.Value</name><val>12.5</val><val></val></var></solution>';
 const data=parseSolution(solution);assert.equal(data.time,1);assert.equal(data.values['Example.Value'],null);assert.deepEqual(data.series['Example.Value'],[12.5,null]);
 assert.throws(()=>parseSolution(solution.replace('<index>1','<index>9')),/index/);
 assert.throws(()=>parseSolution(solution.replace('</solution>','')),/Incomplete/);
 const store=new ProjectStore(path.join(temporary,'state'),path.join(temporary,'no-engine'));
 store.create('Experiment',path.join(temporary,'projects'),{version:'Test',fingerprint:'test'});
 const firstFolder=store.folder,source=path.join(temporary,'source.SOL');fs.writeFileSync(source,solution);
 store.begin();store.commit(source,data,'run','1 Min',{type:'run',id:15});assert.equal(store.active.pending,false);assert.equal(store.active.journal.length,1);assert.equal(fs.readFileSync(store.checkpoint().file,'utf8'),solution);
 const saved=store.read(firstFolder);assert.equal(saved.project.name,'Experiment');
 fs.appendFileSync(store.checkpoint().file,'changed');assert.throws(()=>store.checkpoint(),/checksum/);
 store.create('Experiment',path.join(temporary,'projects'),{version:'Test',fingerprint:'test'});assert.notEqual(store.folder,firstFolder);assert.ok(fs.existsSync(path.join(firstFolder,'experiment.hummod')));
 const ico=fs.readFileSync(fileURLToPath(new URL('../app/assets/hummod.ico',import.meta.url)));assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),9);assert.deepEqual(Array.from({length:9},(_,i)=>ico[6+i*16]||256),[16,20,24,32,40,48,64,128,256]);
 console.log('Passed: SOL parsing, missing data, invalid indices, project records, checksums, folder collisions and icon sizes.');
} finally {
 const resolved=path.resolve(temporary),parent=path.resolve(os.tmpdir())+path.sep;
 if(!resolved.startsWith(parent)||!path.basename(resolved).startsWith('hummod-ui-check-'))throw Error('Unexpected temporary directory');
 fs.rmSync(resolved,{recursive:true,force:true});
}
