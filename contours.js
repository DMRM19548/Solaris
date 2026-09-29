// Rendering resolution never changes the physical law or persistent memory.
import {delta,prepareField} from './law.js';
export function contours(entities,h,size=192,memory=null) {return project(entities,h,size,memory).lines;}
export function project(entities,h,size=192,memory=null,anomaly=null) {
 const stride=size+1,values=new Float64Array(stride*stride),evaluate=prepareField(entities,memory);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++)values[y*stride+x]=evaluate(x/size,y/size);
 for(let y=0;y<size;y++)values[y*stride+size]=values[y*stride];
 for(let x=0;x<=size;x++)values[size*stride+x]=values[x];
 const lines=[],local=[];
 for(const level of [-h,0,h])for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
  const index=y*stride+x,v=[values[index]-level,values[index+1]-level,values[index+stride+1]-level,values[index+stride]-level];
  const points=[],keys=[],corners=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]];
  const edgeKeys=['h:'+y+':'+x,'v:'+y+':'+((x+1)%size),'h:'+((y+1)%size)+':'+x,'v:'+y+':'+x];
  for(let edge=0;edge<4;edge++) {
   const j=(edge+1)%4;if((v[edge]>=0)===(v[j]>=0))continue;
   const t=v[edge]/(v[edge]-v[j]);keys.push(edgeKeys[edge]);
   points.push([(corners[edge][0]+t*(corners[j][0]-corners[edge][0]))/size,
    (corners[edge][1]+t*(corners[j][1]-corners[edge][1]))/size]);
  }
  const add=(a,b)=>{
   lines.push(...points[a],...points[b]);
   if(anomaly&&level===anomaly.region.sign*h)local.push({a:points[a],b:points[b],ka:keys[a],kb:keys[b]});
  };
  if(points.length===2)add(0,1);
  else if(points.length===4) {
   if(v[0]*v[2]-v[1]*v[3]>=0){add(0,1);add(2,3);}else{add(0,3);add(1,2);}
  }
 }
 return {lines:new Float32Array(lines),patch:anomaly?localPatch(local,anomaly):null};
}
function area(p) {let a=0;for(let i=0,j=p.length-1;i<p.length;j=i++)a+=p[j][0]*p[i][1]-p[i][0]*p[j][1];return Math.abs(a/2);}
function contains(p,x,y) {
 let inside=false;for(let i=0,j=p.length-1;i<p.length;j=i++) {
  const a=p[i],b=p[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }return inside;
}
function localPatch(segments,anomaly) {
 const adjacency=new Map(),visited=new Set(),loops=[];
 segments.forEach((s,i)=>{for(const k of [s.ka,s.kb]){if(!adjacency.has(k))adjacency.set(k,[]);adjacency.get(k).push(i);}});
 for(let start=0;start<segments.length;start++) {
  if(visited.has(start))continue;
  const first=segments[start],origin=first.ka;let key=origin,index=start,point=first.a,path=[point],closed=false;
  for(let steps=0;steps<=segments.length;steps++) {
   if(visited.has(index))break;visited.add(index);
   const s=segments[index],forward=s.ka===key,raw=forward?s.b:s.a;key=forward?s.kb:s.ka;
   point=[point[0]+delta(raw[0]-point[0]),point[1]+delta(raw[1]-point[1])];path.push(point);
   if(key===origin){closed=Math.hypot(point[0]-path[0][0],point[1]-path[0][1])<1e-5;break;}
   const next=(adjacency.get(key)||[]).find(i=>!visited.has(i));if(next===undefined)break;index=next;
  }
  const a=area(path);if(closed&&path.length>3&&a>.000002&&a<.18)loops.push({path,area:a});
 }
 const ax=anomaly.region.anchorX,ay=anomaly.region.anchorY;let selected=null;
 for(const loop of loops)for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++) {
  if(contains(loop.path,ax+dx,ay+dy)&&(!selected||loop.area<selected.area))
   selected={...loop,path:loop.path.map(([x,y])=>[x-dx,y-dy])};
 }
 if(!selected)return null;
 const paths=[selected.path];
 for(const loop of loops) {
  if(loop.area>=selected.area-1e-10)continue;
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++) {
   const point=loop.path[0];if(contains(selected.path,point[0]+dx,point[1]+dy))
    paths.push(loop.path.map(([x,y])=>[x+dx,y+dy]));
  }
 }
 return {kind:anomaly.kind,hue:anomaly.hue,paths};
}
