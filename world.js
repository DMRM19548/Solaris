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
  throw Error('The Solaris state does not match its world.');
 return state;
}
export async function readCheckpoint(world,n,fetcher=fetch) {
 if(n===0)return initial(world.seed,world.t0);
 const chunk=Math.floor((n/world.stride-1)/world.chunkSize);
 // Earlier manual uploads also placed these unchanged files in the root.
 for(const path of ['./checkpoints/chunk-'+chunk+'.json','./chunk-'+chunk+'.json']) {
  const response=await fetcher(url(path));
  if(response.ok)return checkState((await response.json())[n],world,n);
 }
 throw Error('The shared Solaris state could not be loaded.');
}
export async function readCurrentState(world,now,manifest,fetcher=fetch) {
 const target=targetGeneration(world,now);
 if(manifest) {
  if(manifest.seed!==world.seed||manifest.t0!==world.t0||manifest.version!==VERSION
   ||manifest.stride!==MAX_FAST_ADVANCE+1||!Number.isSafeInteger(manifest.from)
   ||!Number.isSafeInteger(manifest.through)||manifest.from<0||manifest.through<manifest.from
   ||(manifest.encoding==='gzip-json'
    ?manifest.packSize!==32||!/^solaris-state-[a-f0-9]{16}-$/.test(manifest.prefix)
    :!/^states\/[a-f0-9]{16}\/$/.test(manifest.directory)))
   throw Error('Invalid Solaris current-state manifest.');
  const n=Math.floor(target/manifest.stride)*manifest.stride;
  if(n<manifest.from||n>manifest.through)
   throw Error('The current Solaris state is temporarily unavailable. Please try again later.');
  const packed=manifest.encoding==='gzip-json';
  const path=packed?manifest.prefix+Math.floor(n/(manifest.stride*manifest.packSize))+'.bin':manifest.directory+n+'.json';
  const response=await fetcher(url('./'+path));
  if(!response.ok)throw Error('The current Solaris state could not be loaded. Please try again.');
  const value=packed?await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json():await response.json();
  return {state:checkState(packed?value[n]:value,world,n),maxAdvance:MAX_FAST_ADVANCE};
 }
 // Compatibility during installation only. Never replay months from birth.
 const n=checkpointGeneration(world,now);
 if(target-n>=world.stride)throw Error('Solaris needs an updated current-state publication.');
 return {state:await readCheckpoint(world,n,fetcher),maxAdvance:world.stride-1};
}
export async function loadWorld(clock,fetcher=fetch) {
 const began=Date.now();
 const manifestPromise=fetcher(url('./current.json'),{cache:'no-cache'}).then(async r=>{
  if(r.status===404)return null;
  if(!r.ok)throw Error('Solaris could not load its current-state index.');
  return r.json();
 });
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
