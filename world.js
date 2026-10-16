import {initial,validState,VERSION,T} from './law.js';

export const MAX_FAST_ADVANCE=15;
export class WorldClock {
 constructor(){this.offset=0;}
 now(){return Date.now()+this.offset;}
 synchronize(response,began,ended) {
  const date=Date.parse(response.headers.get('date'));
  const age=Number(response.headers.get('age')||0);
  if(Number.isFinite(date)&&Number.isFinite(age)&&age>=0)
   this.offset=date+age*1000+500-(began+ended)/2;
 }
}
const url=path=>new URL(path,import.meta.url);
export function targetGeneration(world,now) {
 return Math.max(0,Math.floor((now-world.t0)/(T*1000)));
}
export function checkpointGeneration(world,now) {
 return Math.min(world.through,Math.floor(targetGeneration(world,now)/world.stride)*world.stride);
}
export function checkState(state,world,n) {
 if(!validState(state)||state.seed!==world.seed||state.t0!==world.t0||state.n!==n)
  throw Object.assign(Error('The Solaris state does not match its world.'),{code:'SOLARIS_IDENTITY'});
 return state;
}
export async function readCheckpoint(world,n,fetcher=fetch) {
 if(n===0)return initial(world.seed,world.t0);
 const chunk=Math.floor((n/world.stride-1)/world.chunkSize);
 for(const path of ['./chunk-'+chunk+'.json','./checkpoints/chunk-'+chunk+'.json']) {
  try {
   const response=await fetcher(url(path));
   if(response.ok)return checkState((await response.json())[n],world,n);
  } catch(e) {if(e.code==='SOLARIS_IDENTITY')throw e;}
 }
 throw Error('The shared Solaris state could not be loaded.');
}
export async function readCurrentState(world,now,manifest,fetcher=fetch) {
 const target=targetGeneration(world,now),candidates=[];
 if(manifest) {
  if(manifest.seed!==world.seed||manifest.t0!==world.t0||manifest.version!==VERSION
   ||manifest.stride!==MAX_FAST_ADVANCE+1||!Number.isSafeInteger(manifest.from)
   ||!Number.isSafeInteger(manifest.through)||manifest.from<0||manifest.through<manifest.from
   ||manifest.from%manifest.stride!==0||manifest.through%manifest.stride!==0
   ||(manifest.encoding==='gzip-json'
    ?manifest.packSize!==32||!/^solaris-state-[a-f0-9]{16}-$/.test(manifest.prefix)
    :!/^states\/[a-f0-9]{16}\/$/.test(manifest.directory)))
   throw Error('Invalid Solaris current-state manifest.');
  const n=Math.min(Math.floor(target/manifest.stride)*manifest.stride,manifest.through);
  if(n>=manifest.from) candidates.push({n,fast:true,read:async()=>{
   const packed=manifest.encoding==='gzip-json';
   const path=packed?manifest.prefix+Math.floor(n/(manifest.stride*manifest.packSize))+'.bin':manifest.directory+n+'.json';
   const response=await fetcher(url('./'+path));
   if(!response.ok)throw Error('The compact Solaris state could not be loaded.');
   const value=packed?await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json():await response.json();
   return checkState(packed?value[n]:value,world,n);
  }});
 }
 const coarse=checkpointGeneration(world,now);
 candidates.push({n:coarse,read:()=>readCheckpoint(world,coarse,fetcher)});
 // A fresh compact state is preferred. If renewal stops, use the nearest exact
 // surviving checkpoint and advance it to now; expiration never ends the world.
 candidates.sort((a,b)=>{
  const freshA=a.fast&&target-a.n<=MAX_FAST_ADVANCE;
  const freshB=b.fast&&target-b.n<=MAX_FAST_ADVANCE;
  return Number(freshB)-Number(freshA)||b.n-a.n;
 });
 let failure;
 for(const candidate of candidates) {
  try {
   const state=await candidate.read();
   return {state,maxAdvance:Math.max(MAX_FAST_ADVANCE,target-state.n)};
  } catch(e) {if(e.code==='SOLARIS_IDENTITY')throw e;failure=e;}
 }
 throw failure||Error('Solaris could not load a valid shared state.');
}
export async function loadWorld(clock,fetcher=fetch) {
 const began=Date.now();
 const manifestPromise=fetcher(url('./current.json'),{cache:'no-cache'}).then(async r=>{
  if(r.status===404)return null;
  if(!r.ok)throw Error('Solaris could not load its current-state index.');
  return r.json();
 }).catch(()=>null); // The compact index is an accelerator, not the world's identity.
 const [response,manifest]=await Promise.all([
  fetcher(url('./universe.json'),{cache:'no-cache'}),manifestPromise
 ]);
 if(!response.ok)throw Error('Solaris could not connect to its shared history.');
 clock.synchronize(response,began,Date.now());
 const world=await response.json();
 if(world.version!==VERSION||typeof world.seed!=='string'||!Number.isFinite(world.t0)
  ||!Number.isSafeInteger(world.stride)||world.stride<1||!Number.isSafeInteger(world.through)
  ||world.through<0||world.through%world.stride!==0||!Number.isSafeInteger(world.chunkSize)||world.chunkSize<1)
  throw Error('Invalid shared Solaris identity.');
 return {world,...await readCurrentState(world,clock.now(),manifest,fetcher)};
}
