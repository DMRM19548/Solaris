import {emptyMemory,memoryGradient,remember,observe,stabilize} from './history.js';
import {selectAnomalies,portalForce,chromaticCondition} from './anomalies.js';
import {firstAcoustic,advanceAcoustic} from './acoustic-law.js';
// Solaris B: discrete physics. No browser, rendering, audio or runtime randomness.
export const T = 49;
export const TAU = 2 * Math.PI;
export const VERSION = 2;
export const GENOME = [
 [0,.5502,.5599,.3920,.6211,.3994],
 [.5338,.3424,1,.0388,.0489,.1311],
 [.3391,.1083,.3964,.0198,.1044,.3480],
 [.6480,.1093,.5855,.0228,0,.1468],
 [1,0,0,.0112,.0944,.3231],
 [.9437,.0326,.0860,.0135,.0892,.2364],
 [.5801,.2819,.6675,.0295,.1809,0],
 [.1699,.0278,.5355,0,.0060,1],
 [.6894,.2640,.9714,.0308,.0205,.3141],
 [.2511,.4026,.9784,.0267,.1853,.6870],
 [.1198,1,.7357,.0112,1,.2678],
 [.0179,.6825,.5359,1,.7391,.2835]
];
const M = [[0,1,4],[1,2,5],[0,2,3],[1,3,4],[2,4,5],[0,3,5]];
const K = [Math.SQRT2-1,Math.sqrt(3)-1,(Math.sqrt(5)-1)/2,Math.PI-3,Math.E-2,Math.sqrt(7)-2];
export const wrap = x => x - Math.floor(x);
export const delta = x => x - Math.floor(x + .5);
export const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
export const smooth = u => u*u*(3-2*u);
const angleDelta = x => delta(x / TAU) * TAU;
export function random(seed,n,operation,id=0) {
 // FNV-1a tuple hash followed by a fixed 32-bit avalanche.
 const key = JSON.stringify([seed,n,operation,id]);
 let h = 2166136261;
 for (let i=0;i<key.length;i++) h = Math.imul(h ^ key.charCodeAt(i),16777619);
 h ^= h >>> 16; h = Math.imul(h,0x7feb352d);
 h ^= h >>> 15; h = Math.imul(h,0x846ca68b); h ^= h >>> 16;
 return (h >>> 0) / 4294967296;
}
function entity(g,id,x,y) {
 const [E,C,B,F,Z,R]=g;
 return {id,x,y,a:.35+.85*E,r:.045+.10*B,s:C>=.5?1:-1,phi:TAU*Z,psi:.15+.85*F,theta:TAU*R,age:0};
}
export function initial(seed,t0) {
 const state={version:VERSION,seed,t0,n:0,nextID:12,lawStart:0,
  lambda:GENOME[0].map((_,j)=>GENOME.reduce((s,g)=>s+g[j],0)/12),
  entities:GENOME.map((g,i)=>entity(g,i,random(seed,0,'initial-x',i),random(seed,0,'initial-y',i)))};
 return initializeHistory(state);
}
function initializeHistory(state) {
 const memory=emptyMemory(),snapshot=observe(state.entities,.16+.24*state.lambda[0],memory,prepareField(state.entities,memory));
 return {...state,memory,footprint:snapshot.footprint,regions:snapshot.regions,
  anomaly:null,portal:null,acoustic:firstAcoustic(state.lambda)};
}
export function upgradeLegacy(state) {
 return initializeHistory({...state,version:VERSION,lawStart:state.n});
}
export function nextLambda(l,n) {
 return M.map((indices,i)=>{
  const q=wrap(indices.reduce((s,j)=>s+l[j],0)/3+.31*GENOME[n%12][i]+.17*K[i]);
  return 3.87*q*(1-q);
 });
}
const circular = (x,y,a,b) => {
 const cx=a*Math.cos(x)+b*Math.cos(y), cy=a*Math.sin(x)+b*Math.sin(y);
 return Math.hypot(cx,cy)<1e-14?x:Math.atan2(cy,cx);
};
export function advance(state) {
 const l=state.lambda, original=state.entities, n=state.n;
 const baseRnd=(op,id=0)=>random(state.seed,n,op,id);
 let slot=0;const rnd=(op,id=0)=>baseRnd('event-'+slot+':'+op,id);
 const moved=original.map(i=>{
  let fx=0,fy=0;
  for (const j of original) {
   if(i.id===j.id) continue;
   const dx=delta(j.x-i.x),dy=delta(j.y-i.y),d=Math.hypot(dx,dy),rho=(i.r+j.r)/2;
   if(d===0) continue;
   const f=-i.s*j.s*(.003+.012*l[2])*Math.exp(-d*d/(2*rho*rho))/d;
   fx+=f*dx;fy+=f*dy;
   const bridge=portalForce(i,j,state.portal,n,.003+.012*l[2]);fx+=bridge[0];fy+=bridge[1];
  }
  const alpha=i.theta+TAU*(.17*l[1]+.11*l[4])+.35*Math.sin(i.phi+TAU*l[5]);
  const speed=.002+.008*l[0];
  const [mx,my]=memoryGradient(state.memory,i.x,i.y);
  return {...i,x:wrap(i.x+4*(fx+speed*Math.cos(alpha))-.003*mx),y:wrap(i.y+4*(fy+speed*Math.sin(alpha))-.003*my),
   theta:i.theta+.04*(l[1]-.5)+.02*Math.sin(i.phi+TAU*l[3]),
   a:clamp(i.a*(.985+.03*l[3]),.15,1.5),r:clamp(i.r*(.99+.02*l[4]),.025,.18),age:i.age+1};
 });
 let entities=moved.map(q=>({...q})),nextID=state.nextID,event=null;
 const origins={},events=[],startingById=new Map(original.map(q=>[q.id,q]));
 const eventProbabilities=[.35+.50*l[5],.10+.30*l[2],.03+.15*l[4]];
 for(slot=0;slot<3;slot++) {
  if(rnd('event-occurrence')>=eventProbabilities[slot])continue;
  const names=['split','merge','inversion','birth','death','scale'];
  const weights=[.15+.35*l[0],.15+.35*l[1],.10+.25*l[2],.10+.25*l[3],.10+.25*l[4],.10+.25*l[5]];
  // Conditional weighted selection is equivalent to rejection among invalid events.
  if(entities.length===24) weights[0]=weights[3]=0;
  if(entities.length===6) weights[1]=weights[4]=0;
  let pick=rnd('event-type')*weights.reduce((a,b)=>a+b,0),k=0;
  while(k<5 && pick>=weights[k]) {pick-=weights[k];k++;}
  event=names[k];events.push(event);
  const index=Math.floor(rnd('entity-selection')*entities.length),p=entities[index];
  if(event==='split') {
   const dx=-Math.sin(p.theta)*.35*p.r,dy=Math.cos(p.theta)*.35*p.r;
   const children=[1,-1].map((sign,j)=>({...p,id:nextID++,x:wrap(p.x+sign*dx),y:wrap(p.y+sign*dy),
    a:p.a*(j===0?.55:.45),r:.72*p.r,phi:p.phi+sign*.35,age:0}));
   for(const child of children) origins[child.id]={...(startingById.get(p.id)||origins[p.id]||p),a:0,s:child.s,psi:child.psi,phi:child.phi};
   entities.splice(index,1,...children);
  } else if(event==='merge') {
   let best=Infinity,ai=0,bi=1;
   for(let i=0;i<entities.length;i++) for(let j=i+1;j<entities.length;j++) {
    const d=delta(entities[i].x-entities[j].x)**2+delta(entities[i].y-entities[j].y)**2;
    if(d<best) {best=d;ai=i;bi=j;}
   }
   const a=entities[ai],b=entities[bi],sum=a.a+b.a,weight=b.a/sum;
   const merged={id:nextID++,x:wrap(a.x+weight*delta(b.x-a.x)),y:wrap(a.y+weight*delta(b.y-a.y)),
    a:Math.min(1.5,sum),r:Math.min(.18,Math.hypot(a.r,b.r)),
    s:Math.sign(a.s*a.a+b.s*b.a)||(rnd('merge-polarity',a.id)<.5?-1:1),
    phi:circular(a.phi,b.phi,a.a,b.a),theta:circular(a.theta,b.theta,a.a,b.a),
    psi:(a.a*a.psi+b.a*b.psi)/sum,age:0};
   origins[merged.id]={...merged,a:0};
   entities=entities.filter((_,i)=>i!==ai&&i!==bi);entities.push(merged);
  } else if(event==='inversion') p.s=-p.s;
  else if(event==='birth') {
   const child=entity(GENOME[n%12],nextID++,rnd('birth-x',state.nextID),rnd('birth-y',state.nextID));
   entities.push(child);origins[child.id]={...child,a:0};
  } else if(event==='death') entities.splice(index,1);
  else {p.r=clamp(p.r*(.65+.70*l[5]),.025,.18);p.a=clamp(p.a*(.75+.50*l[2]),.15,1.5);}
 }
 const lambda=nextLambda(l,n);
 const snapshot=observe(entities,.16+.24*lambda[0],state.memory,prepareField(entities,state.memory));
 const memory=remember(state.memory,state.footprint,snapshot.footprint);
 const next={version:VERSION,seed:state.seed,t0:state.t0,n:n+1,nextID,lambda,entities,
  lawStart:state.lawStart,memory,footprint:snapshot.footprint,
  regions:stabilize(snapshot.regions,state.regions),
  acoustic:advanceAcoustic(state.acoustic,l,baseRnd)};
 Object.assign(next,selectAnomalies(next,state,baseRnd));
 return {next,moved,origins,event:events.at(-1)||null,events};
}
export function interpolate(state,transition,u) {
 const t=smooth(clamp(u,0,1)),lerp=(a,b)=>a+(b-a)*t;
 const ends=new Map(transition.next.entities.map(q=>[q.id,q]));
 const old=new Map(state.entities.map(q=>[q.id,q]));
 const pairs=state.entities.map((q,i)=>[q,ends.get(q.id)||{...transition.moved[i],a:0}]);
 for(const q of transition.next.entities) if(!old.has(q.id)) pairs.push([transition.origins[q.id],q]);
 const entities=pairs.map(([a,b])=>({id:b.id,x:wrap(a.x+t*delta(b.x-a.x)),y:wrap(a.y+t*delta(b.y-a.y)),
  a:lerp(a.s*a.a,b.s*b.a),s:1,r:lerp(a.r,b.r),psi:lerp(a.psi,b.psi),
  theta:a.theta+t*angleDelta(b.theta-a.theta),phi:a.phi+t*angleDelta(b.phi-a.phi)})).filter(q=>q.a!==0);
 const lambda=state.lambda.map((v,i)=>lerp(v,transition.next.lambda[i]));
 const memory=state.memory.map((v,i)=>lerp(v,transition.next.memory[i]));
 let anomaly=state.anomaly;
 if(anomaly) {
  const end=transition.next.anomaly;
  const r=anomaly.region,b=end&&end.start===anomaly.start?end.region:r;
  const region={...r,anchorX:wrap(r.anchorX+t*delta(b.anchorX-r.anchorX)),anchorY:wrap(r.anchorY+t*delta(b.anchorY-r.anchorY)),
   x:wrap(r.x+t*delta(b.x-r.x)),y:wrap(r.y+t*delta(b.y-r.y))};
  anomaly={...anomaly,region};
  if(state.n+u>=anomaly.start+anomaly.duration || (anomaly.kind==='chroma'&&!chromaticCondition(lambda,region,memory)))anomaly=null;
 }
 return {entities,lambda,memory,anomaly,
  acousticLambda:state.acoustic.lambda.map((v,i)=>lerp(v,transition.next.acoustic.lambda[i]))};
}
export function prepareField(entities,memory=null) {
 const prepared=entities.map(q=>({...q,c:Math.cos(q.theta),sn:Math.sin(q.theta),
  ir:1/q.r,iy:1/(q.r*(.45+.90*q.psi)),k:2+Math.floor(4*q.psi),cp:Math.cos(q.phi),sp:Math.sin(q.phi)}));
 return (x,y)=>{
  if(memory) {const [mx,my]=memoryGradient(memory,x,y);x=wrap(x+.008*mx);y=wrap(y+.008*my);}
  let value=0;
  for(const q of prepared) {
   const dx=delta(x-q.x),dy=delta(y-q.y),xx=q.c*dx+q.sn*dy,yy=-q.sn*dx+q.c*dy;
   // Exact multiple-angle identities avoid atan2/cos for every grid sample.
   const den=xx*xx+yy*yy;let ck=1,sk=0;
   if(den>0) {
    const c2=(xx*xx-yy*yy)/den,s2=2*xx*yy/den;
    if(q.k===2){ck=c2;sk=s2;}
    else if(q.k===4){ck=2*c2*c2-1;sk=2*c2*s2;}
    else if(q.k===6){ck=c2*(4*c2*c2-3);sk=s2*(3-4*s2*s2);}
    else {
     const inv=1/Math.sqrt(den),c1=xx*inv,s1=yy*inv;
     if(q.k===3){ck=c2*c1-s2*s1;sk=s2*c1+c2*s1;}
     else{const c4=2*c2*c2-1,s4=2*c2*s2;ck=c4*c1-s4*s1;sk=s4*c1+c4*s1;}
    }
   }
   value+=q.s*q.a*Math.exp(-.5*((xx*q.ir)**2+(yy*q.iy)**2))*(1+.25*q.psi*(ck*q.cp-sk*q.sp));
  }
  return value;
 };
}
export function field(x,y,entities,memory=null) {return prepareField(entities,memory)(x,y);}
export function validState(s) {
 return s && s.version===VERSION && Number.isSafeInteger(s.lawStart) && s.lawStart<=s.n
  && s.memory?.length===576&&s.memory.every(x=>Number.isFinite(x)&&x>=0&&x<=1)
  && s.footprint?.length===576&&s.footprint.every(x=>Number.isFinite(x)&&x>=0&&x<=1)
  && Array.isArray(s.regions)&&s.acoustic?.lambda?.length===6&&Number.isFinite(s.acoustic.offset)
  && typeof s.seed==='string' && Number.isFinite(s.t0)
  && Number.isSafeInteger(s.n)&&s.n>=0&&Number.isSafeInteger(s.nextID)
  && s.lambda?.length===6&&s.lambda.every(x=>Number.isFinite(x)&&x>=0&&x<=1)
  && Array.isArray(s.entities)&&s.entities.length>=6&&s.entities.length<=24
  && new Set(s.entities.map(q=>q.id)).size===s.entities.length
  && s.entities.every(q=>['id','x','y','a','r','s','phi','psi','theta','age'].every(k=>Number.isFinite(q[k]))
   &&q.id<s.nextID&&q.x>=0&&q.x<1&&q.y>=0&&q.y<1&&q.r>0&&q.a>0&&(q.s===1||q.s===-1));
}
