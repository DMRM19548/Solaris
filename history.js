// Fixed-resolution physical memory, independent of the rendering resolution.
export const G=24;
const wrap=x=>x-Math.floor(x),delta=x=>x-Math.floor(x+.5),clamp=x=>Math.max(0,Math.min(1,x));
export const emptyMemory=()=>Array(G*G).fill(0);
export function sampleMemory(memory,x,y) {
 if(!memory)return 0;
 const px=wrap(x)*G,py=wrap(y)*G,ix=Math.floor(px),iy=Math.floor(py),a=px-ix,b=py-iy;
 const at=(dx,dy)=>memory[((iy+dy)%G)*G+(ix+dx)%G];
 return (1-b)*((1-a)*at(0,0)+a*at(1,0))+b*((1-a)*at(0,1)+a*at(1,1));
}
export function memoryGradient(memory,x,y) {
 const d=1/G,gx=(sampleMemory(memory,x+d,y)-sampleMemory(memory,x-d,y))*G/2,
 gy=(sampleMemory(memory,x,y+d)-sampleMemory(memory,x,y-d))*G/2;
 const norm=1+Math.hypot(gx,gy);return [gx/norm,gy/norm];
}
export function remember(memory,previous,current) {
 return memory.map((m,i)=>clamp(.97*m+.065*Math.min(previous[i],current[i])));
}
export function observe(entities,h,memory,field) {
 const values=new Float64Array(G*G),footprint=emptyMemory();
 for(let y=0;y<G;y++)for(let x=0;x<G;x++)values[y*G+x]=field(x/G,y/G,entities,memory);
 for(let y=0;y<G;y++)for(let x=0;x<G;x++) {
  const i=y*G+x,p=values[i];
  const gx=(values[y*G+(x+1)%G]-values[y*G+(x+G-1)%G])*G/2;
  const gy=(values[((y+1)%G)*G+x]-values[((y+G-1)%G)*G+x])*G/2;
  const zeroContour=Math.exp(-((p/(.22*h))**2))*clamp(Math.hypot(gx,gy)*.15/h);
  footprint[i]=Math.max(clamp(Math.abs(p)/h),zeroContour);
 }
 const regions=[];
 for(const sign of [-1,1]) {
  const visited=new Uint8Array(G*G);
  for(let start=0;start<values.length;start++) {
   if(visited[start]||sign*values[start]<h)continue;
   const queue=[start],coords=new Map([[start,[start%G,Math.floor(start/G)]]]);visited[start]=1;
   let winding=false,cx=0,cy=0,peak=start,total=0;
   for(let q=0;q<queue.length;q++) {
    const i=queue[q],x=i%G,y=Math.floor(i/G),[ux,uy]=coords.get(i);cx+=ux;cy+=uy;total+=Math.abs(values[i]);
    if(Math.abs(values[i])>Math.abs(values[peak]))peak=i;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
     const j=((y+dy+G)%G)*G+(x+dx+G)%G;
     if(sign*values[j]<h)continue;
     if(coords.has(j)) {const old=coords.get(j);if(old[0]!==ux+dx||old[1]!==uy+dy)winding=true;}
     else {visited[j]=1;coords.set(j,[ux+dx,uy+dy]);queue.push(j);}
    }
   }
   // Only contractible local regions can host a visible anomaly.
   if(!winding&&queue.length>=3&&queue.length<=G*G*.16) {
    regions.push({sign,x:wrap(cx/queue.length/G),y:wrap(cy/queue.length/G),
     anchorX:(peak%G)/G,anchorY:Math.floor(peak/G)/G,cells:queue.sort((a,b)=>a-b),
     area:queue.length/(G*G),mean:total/queue.length,stability:0});
   }
  }
 }
 return {footprint,regions};
}
export function matchRegion(region,candidates) {
 const old=new Set(region.cells);let best=null,score=0;
 for(const r of candidates) {
  if(r.sign!==region.sign)continue;
  const overlap=r.cells.reduce((s,i)=>s+Number(old.has(i)),0),iou=overlap/(r.cells.length+old.size-overlap);
  const d=Math.hypot(delta(r.x-region.x),delta(r.y-region.y));
  if(iou>score&&d<.12){score=iou;best=r;}
 }
 return score>=.35?{region:best,score}:null;
}
export function stabilize(regions,previous) {
 return regions.map(r=>{
  const match=matchRegion(r,previous);
  return {...r,stability:match&&match.score>=.55?match.region.stability+1:0};
 });
}
