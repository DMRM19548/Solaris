import {initial,validState,VERSION,T} from './law.js';

export class WorldClock {
 constructor(){this.offset=0;}
 now(){return Date.now()+this.offset;}
 synchronize(response,began,ended) {
  const date=Date.parse(response.headers.get('date'));
  const age=Number(response.headers.get('age')||0);
  // HTTP dates have one-second precision. Use the midpoint of that second,
  // including cache age and a symmetric estimate of request transit time.
  if(Number.isFinite(date)&&Number.isFinite(age)&&age>=0)
   this.offset=date+age*1000+500-(began+ended)/2;
 }
}
export function checkpointGeneration(world,now) {
 const target=Math.max(0,Math.floor((now-world.t0)/(T*1000)));
 return Math.min(world.through,Math.floor(target/world.stride)*world.stride);
}
export async function readCheckpoint(world,n,fetcher=fetch) {
 if(n===0)return initial(world.seed,world.t0);
 const chunk=Math.floor((n/world.stride-1)/world.chunkSize);
 const response=await fetcher(new URL('./checkpoints/chunk-'+chunk+'.json',import.meta.url));
 if(!response.ok)throw Error('The shared Solaris history could not be loaded.');
 const state=(await response.json())[n];
 if(!validState(state)||state.seed!==world.seed||state.t0!==world.t0||state.n!==n)
  throw Error('The shared Solaris checkpoint does not match its world.');
 return state;
}
export async function loadWorld(clock,fetcher=fetch) {
 const began=Date.now();
 const response=await fetcher(new URL('./universe.json',import.meta.url),{cache:'no-store'});
 if(!response.ok)throw Error('Solaris could not connect to its shared history.');
 clock.synchronize(response,began,Date.now());
 const world=await response.json();
 if(world.version!==VERSION||typeof world.seed!=='string'||!Number.isFinite(world.t0)
  ||!Number.isSafeInteger(world.stride)||world.stride<1||!Number.isSafeInteger(world.through)
  ||world.through<0||world.through%world.stride!==0||!Number.isSafeInteger(world.chunkSize)||world.chunkSize<1)
  throw Error('Invalid shared Solaris identity.');
 const n=checkpointGeneration(world,clock.now());
 // A missing acceleration file must never create a different universe.
 const state=await readCheckpoint(world,n,fetcher).catch(()=>initial(world.seed,world.t0));
 return {world,state};
}
