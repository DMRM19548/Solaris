import {sampleMemory,matchRegion} from './history.js';
const wrap=x=>x-Math.floor(x),delta=x=>x-Math.floor(x+.5);
export function resonance(l,r,memory) {
 // Resonance depends on both law coordinates and the actual accumulated shape.
 const shape=wrap(r.area*7+r.mean*.113+sampleMemory(memory,r.x,r.y)*.19+r.x*.07+r.y*.11);
 return {a:Math.abs(l[0]-l[3]),b:Math.abs(wrap(l[1]+l[4]+shape)-.5),c:Math.abs(l[2]-l[5])};
}
export function chromaticCondition(l,r,memory) {
 const z=resonance(l,r,memory);return z.a<.011&&z.b<.032&&z.c<.16;
}
export function selectAnomalies(state,previous,rnd) {
 const {lambda:l,regions,memory,n}=state;
 let anomaly=null,portal=null;
 if(previous.anomaly) {
  const old=previous.anomaly,match=matchRegion(old.region,regions);
  if(match&&n<old.start+old.duration && (old.kind!=='chroma'||chromaticCondition(l,match.region,memory)))
   anomaly={...old,region:match.region};
 }
 if(previous.portal&&n<previous.portal.start+previous.portal.duration)portal=previous.portal;
 const candidates=regions.filter(r=>r.stability>=2&&sampleMemory(memory,r.x,r.y)>.09);
 for(const r of candidates) {
  const z=resonance(l,r,memory);
  if(!portal&&z.a<.005&&z.b<.016&&z.c<.055) {
   const distant=candidates.filter(b=>b!==r&&Math.hypot(delta(b.x-r.x),delta(b.y-r.y))>.34);
   const partner=distant.sort((a,b)=>Math.abs(a.mean-r.mean)-Math.abs(b.mean-r.mean))[0];
   if(partner&&Math.abs(partner.mean-r.mean)<.14)portal={start:n,duration:3+Math.floor(5*l[4]),
    ax:r.x,ay:r.y,bx:partner.x,by:partner.y,theta:2*Math.PI*wrap(l[1]+l[5]),radius:.07+.04*l[2]};
  }
  if(anomaly)continue;
  if(chromaticCondition(l,r,memory))anomaly={kind:'chroma',start:n,duration:4,
   hue:360*wrap(rnd('chromatic-hue')+l[0]+l[2]*Math.SQRT2+l[4]*Math.sqrt(3)),region:r};
  else if(z.a<.032&&z.b<.065)anomaly={kind:'black',start:n,duration:2+4*wrap(l[2]+r.mean+l[5]),region:r};
 }
 return {anomaly,portal};
}
export function portalForce(i,j,portal,n,strength) {
 if(!portal)return [0,0];
 const phase=(n-portal.start)/portal.duration;if(phase<=0||phase>=1)return [0,0];
 const envelope=Math.sin(Math.PI*phase)**2,c=Math.cos(portal.theta),s=Math.sin(portal.theta),r=portal.radius;
 let fx=0,fy=0;
 for(const direction of [1,-1]) {
  const ax=direction===1?portal.ax:portal.bx,ay=direction===1?portal.ay:portal.by,
   bx=direction===1?portal.bx:portal.ax,by=direction===1?portal.by:portal.ay;
  const ix=delta(i.x-ax),iy=delta(i.y-ay),jx=delta(j.x-bx),jy=delta(j.y-by);
  const vicinity=Math.exp(-(ix*ix+iy*iy+jx*jx+jy*jy)/(2*r*r));
  const dx=c*jx+direction*s*jy-ix,dy=-direction*s*jx+c*jy-iy,d=Math.hypot(dx,dy);
  if(d<1e-12)continue;
  const rho=(i.r+j.r)/2,f=-i.s*j.s*strength*envelope*vicinity*Math.exp(-d*d/(2*rho*rho))/d;
  fx+=f*dx;fy+=f*dy;
 }
 return [fx,fy];
}
