import {T,advance,interpolate,validState} from './law.js';
import {project} from './contours.js';
import {checkpointGeneration,readCheckpoint} from './world.js';
let state,transition,world,attempted=-1;
self.onmessage=async({data})=>{
 try {
  if(data.type==='init') {
   if(!validState(data.state)) throw Error('Invalid world state.');
   state=data.state;world=data.world;transition=advance(state);self.postMessage({type:'ready'});return;
  }
  if(data.type!=='frame'||!state) return;
  if(data.now<state.t0) {self.postMessage({type:'dormant',wait:state.t0-data.now});return;}
  const age=Math.max(0,(data.now-state.t0)/1000),target=Math.floor(age/T);
  let checkpoint=null;
  const n=world?checkpointGeneration(world,data.now):0;
  if(n>state.n&&n!==attempted) {
   attempted=n;
   try {state=await readCheckpoint(world,n);transition=advance(state);checkpoint=state;}
   catch(e){console.warn(e.message);} // Exact generation advance remains the fallback.
  }
  const start=performance.now();
  // Worker catch-up in bounded batches. The UI stays responsive even after years.
  while(state.n<target && performance.now()-start<35) {
   state=transition.next;transition=advance(state);checkpoint=state;
  }
  if(state.n<target) {self.postMessage({type:'catching-up',checkpoint});return;}
  const u=state.n>target?0:(age/T-target);
  const visible=interpolate(state,transition,u);
  const began=performance.now();
  const {lines,patch}=project(visible.entities,.16+.24*visible.lambda[0],data.size,visible.memory,visible.anomaly);
  self.postMessage({type:'frame',lines,patch,lambda:visible.acousticLambda,checkpoint,n:state.n,u,
   audio:{t0:state.t0,n:state.n,current:state.acoustic,next:transition.next.acoustic},
   duration:performance.now()-began},[lines.buffer]);
 }catch(e){self.postMessage({type:'error',message:e.message});}
};
