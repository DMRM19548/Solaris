import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';

// Add exact checkpoints without changing the world's identity or its law.
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const publicRoot=existsSync(join(root,'dist/index.html'))?join(root,'dist'):root;
const {initial,advance,validState,T,VERSION}=await import(pathToFileURL(join(publicRoot,'law.js')));
const manifestPath=join(publicRoot,'universe.json');
const world=JSON.parse(await readFile(manifestPath,'utf8'));
if(world.version!==VERSION)throw Error('The checkpoint law version must match the world.');
const days=Number(process.argv[2]??366);
if(!Number.isFinite(days)||days<0)throw Error('Pass a nonnegative number of days ahead.');
const target=Math.ceil(Math.max(0,(Date.now()+days*86400000-world.t0)/(T*1000))/world.stride)*world.stride;
const directory=join(publicRoot,'checkpoints');await mkdir(directory,{recursive:true});
const chunkNumber=n=>Math.floor((n/world.stride-1)/world.chunkSize);
const chunkPath=n=>join(directory,'chunk-'+chunkNumber(n)+'.json');
let chunk=world.through?JSON.parse(await readFile(chunkPath(world.through),'utf8')):{};
let state=world.through?chunk[world.through]:initial(world.seed,world.t0);
if(!validState(state)||state.seed!==world.seed||state.t0!==world.t0||state.n!==world.through)throw Error('Checkpoint identity mismatch.');
let written=0;
const flush=async n=>{
 await writeFile(chunkPath(n)+'.tmp',JSON.stringify(chunk));
 await rename(chunkPath(n)+'.tmp',chunkPath(n));
};
while(state.n<target) {
 state=advance(state).next;
 if(state.n%world.stride===0) {
  if(world.through&&chunkNumber(state.n)!==chunkNumber(world.through))chunk={};
  chunk[state.n]=state;
  world.through=state.n;written++;
  if((state.n/world.stride)%world.chunkSize===0||state.n===target)await flush(state.n);
  if(written%30===0)console.log('Exact checkpoints:',written,'; generation:',state.n);
 }
}
await writeFile(manifestPath+'.tmp',JSON.stringify(world,null,2)+'\n');
await rename(manifestPath+'.tmp',manifestPath);
console.log(JSON.stringify({through:world.through,coveredUntil:new Date(world.t0+world.through*T*1000).toISOString(),written}));
