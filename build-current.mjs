import {readFile,writeFile,readdir,unlink,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initial,advance,validState,T} from './law.js';

const root=fileURLToPath(new URL('.',import.meta.url));
const now=process.env.SOLARIS_NOW?Date.parse(process.env.SOLARIS_NOW):Date.now();
const days=Number(process.env.SOLARIS_DAYS||14),stride=16,packSize=32,span=stride*packSize;
if(!Number.isFinite(now)||!Number.isInteger(days)||days<1||days>32)throw Error('Invalid publication horizon.');
const world=JSON.parse(await readFile(join(root,'universe.json'),'utf8'));
const hash=createHash('sha256');
for(const file of ['law.js','history.js','anomalies.js','acoustic-law.js'])hash.update(await readFile(join(root,file)));
hash.update(JSON.stringify({seed:world.seed,t0:world.t0}));
const fingerprint=hash.digest('hex').slice(0,16),prefix='solaris-state-'+fingerprint+'-';
const target=time=>Math.max(0,Math.floor((time-world.t0)/(T*1000)));
// Complete immutable packs allow consecutive publications to reuse identical bytes.
const from=Math.floor(target(now-86400000)/span)*span;
const through=(Math.floor(target(now+days*86400000)/span)+1)*span-stride;
const chunks=new Map();
async function coarse(n) {
 if(n===0)return initial(world.seed,world.t0);
 const index=Math.floor((n/world.stride-1)/world.chunkSize);
 if(!chunks.has(index)) {
  const nested=join(root,'checkpoints','chunk-'+index+'.json');
  chunks.set(index,JSON.parse(await readFile(existsSync(nested)?nested:join(root,'chunk-'+index+'.json'),'utf8')));
 }
 return chunks.get(index)[n];
}
const valid=s=>validState(s)&&s.seed===world.seed&&s.t0===world.t0;
let state=await coarse(Math.min(world.through,Math.floor(from/world.stride)*world.stride));
if(existsSync(join(root,'state-anchor.json'))) {
 const saved=JSON.parse(await readFile(join(root,'state-anchor.json'),'utf8'));
 if(saved.fingerprint!==fingerprint)throw Error('The saved anchor belongs to a different law.');
 if(!valid(saved.state))throw Error('Invalid saved world anchor.');
 if(saved.state.n<=from&&saved.state.n>state.n)state=saved.state;
}
if(!valid(state))throw Error('Invalid original checkpoint.');
const atomic=async(name,data)=>{await writeFile(join(root,name+'.tmp'),data);await rename(join(root,name+'.tmp'),join(root,name));};
let anchor,pack={},written=0,rawBytes=0,compressedBytes=0,verified=0;
const keep=new Set(),sizes=[],began=performance.now();
while(state.n<=through) {
 if(state.n%world.stride===0&&state.n<=world.through) {
  const original=await coarse(state.n);
  if(JSON.stringify(state)!==JSON.stringify(original))throw Error('History diverged at generation '+state.n);
  verified++;
 }
 if(state.n===from)anchor=structuredClone(state);
 if(state.n>=from&&state.n%stride===0) {
  pack[state.n]=state;written++;
  if((state.n+stride)%span===0) {
   const name=prefix+Math.floor(state.n/span)+'.bin',raw=JSON.stringify(pack),data=gzipSync(raw,{level:6});
   await atomic(name,data);keep.add(name);sizes.push(data.length);rawBytes+=Buffer.byteLength(raw);compressedBytes+=data.length;pack={};
  }
 }
 if(state.n===through)break;
 state=advance(state).next;
}
if(!anchor)throw Error('Missing publication anchor.');
const manifest={version:world.version,seed:world.seed,t0:world.t0,stride,from,through,encoding:'gzip-json',packSize,prefix};
await atomic('current.json',JSON.stringify(manifest));
await atomic('state-anchor.json',JSON.stringify({fingerprint,state:anchor})+'\n');
// Keep the deployed snapshot window bounded. The world's accumulated memory is in every state.
for(const file of await readdir(root)) {
 if(/^solaris-state-[a-f0-9]{16}-\d+\.bin$/.test(file)&&!keep.has(file))await unlink(join(root,file));
}
console.log(JSON.stringify({from,through,states:written,files:keep.size,meanStateBytes:Math.round(rawBytes/written),
 meanDownloadBytes:Math.round(compressedBytes/keep.size),maxDownloadBytes:Math.max(...sizes),compressedBytes,
 verifiedOriginalCheckpoints:verified,milliseconds:Math.round(performance.now()-began),
 reserveUntil:new Date(world.t0+(through+stride)*T*1000).toISOString()}));
