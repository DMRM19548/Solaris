import {T,advance,interpolate,validState} from './law.js';
import {project} from './contours.js';
import {loadWorld} from './world.js';
let state,transition,world,maxAdvance=15;
self.onmessage=async({data})=>{
 try {
  if(data.type==='init') {
   if(!validState(data.state)) throw Error('Invalid world state.');
   state=data.state;world=data.world;maxAdvance=data.maxAdvance??15;
   transition=advance(state);self.postMessage({type:'ready'});return;
  }
  if(data.type!=='frame'||!state) return;
  if(data.now<state.t0) {self.postMessage({type:'dormant',wait:state.t0-data.now});return;}
  const age=Math.max(0,(data.now-state.t0)/1000),target=Math.floor(age/T);
  let checkpoint=null;
  if(target-state.n>maxAdvance+1) {
   // A sleeping tab fetches today's state instead of replaying its absence.
   const loaded=await loadWorld({now:()=>data.now,synchronize:()=>{}});
   state=loaded.state;world=loaded.world;maxAdvance=loaded.maxAdvance;
   transition=advance(state);checkpoint=state;
  }
  const start=performance.now();
  // The publisher bounds missing generations independently of the world's age.
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
