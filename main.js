import {WorldClock,loadWorld} from './world.js';
import {Sound} from './audio.js';
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
const entry=document.querySelector('#entry'),button=entry.querySelector('button'),error=document.querySelector('#error');
const clock=new WorldClock(),sound=new Sound(()=>clock.now());
// Begin the small state request while the entry word is still visible.
let preparedWorld=loadWorld(clock).catch(()=>null);
// Discard obsolete private snapshots; the site's shared history is authoritative.
try {
 const prefix='solaris-b:v1:'+new URL('.',location.href).pathname+':';
 for(const key of ['identity','state','backup','law-origin'])localStorage.removeItem(prefix+key);
} catch(e) {console.warn('Old local state could not be cleared.',e);}
let worker,state,entered=false,busy=false,ready=false,latestLines,latestPatch,latestAudio,renderTimer;
let grid=innerWidth<600?160:224,slow=0;
const dev=new URLSearchParams(location.search).has('dev');
const fail=e=>{
 clearTimeout(renderTimer);worker?.terminate();worker=null;state=null;ready=false;busy=false;entered=false;
 sound.stop();preparedWorld=Promise.resolve(null);
 console.error(e);error.textContent=e.message||String(e);entry.classList.remove('gone');entry.hidden=false;entry.inert=false;
 button.disabled=false;button.textContent='SOLARIS';
};
function resize() {
 const dpr=Math.min(devicePixelRatio||1,2);
 canvas.width=Math.round(innerWidth*dpr);canvas.height=Math.round(innerHeight*dpr);
 ctx.setTransform(dpr,0,0,dpr,0,0);if(latestLines)paint(latestLines,latestPatch);
}
function paint(lines,patch=null) {
 ctx.clearRect(0,0,innerWidth,innerHeight);ctx.beginPath();
 for(let i=0;i<lines.length;i+=4) {ctx.moveTo(lines[i]*innerWidth,lines[i+1]*innerHeight);ctx.lineTo(lines[i+2]*innerWidth,lines[i+3]*innerHeight);}
 ctx.strokeStyle='#777777';ctx.lineWidth=.72;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();
 if(patch) {
  ctx.beginPath();
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const path of patch.paths) {
   path.forEach(([x,y],i)=>{if(i===0)ctx.moveTo((x+dx)*innerWidth,(y+dy)*innerHeight);else ctx.lineTo((x+dx)*innerWidth,(y+dy)*innerHeight);});ctx.closePath();
  }
  if(patch.kind==='black'){ctx.fillStyle='#000';ctx.fill('evenodd');}
  else{ctx.strokeStyle=`hsl(${patch.hue} 100% 50%)`;ctx.stroke();}
 }
}
function requestFrame() {
 clearTimeout(renderTimer);
 if(!ready||busy||document.hidden||!entered)return;
 busy=true;worker.postMessage({type:'frame',now:clock.now(),size:grid});
}
function checkpoint(s) {
 if(!s)return;state=s;
}
function enterObservation() {
 if(!entry.classList.contains('gone')) {entry.classList.add('gone');entry.inert=true;button.blur();}
}
async function start() {
 button.disabled=true;error.textContent='';
 try {
  // The click only opens observation and audio; it never changes the world's birth.
  // Audio download/decode must never hold the first visual frame hostage.
  sound.unlock().then(()=>{
   if(!document.hidden&&entered)sound.sync(latestAudio,true);
  }).catch(e=>console.warn('Solaris audio:',e));
  entered=true;
  if(!state) {
   const {world,state:sharedState,maxAdvance}=await preparedWorld||await loadWorld(clock);
   preparedWorld=Promise.resolve(null);
   state=sharedState;
   worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
   worker.onerror=fail;
   worker.onmessage=({data})=>{
    if(data.type==='ready') {ready=true;requestFrame();return;}
    busy=false;
    if(data.type==='error'){fail(Error(data.message));return;}
    checkpoint(data.checkpoint);
    if(document.hidden)return;
    if(data.type==='dormant') {
     ctx.clearRect(0,0,innerWidth,innerHeight);sound.stop();enterObservation();
     if(dev)window.solarisDebug={state:structuredClone(state),born:false,n:null};
     renderTimer=setTimeout(requestFrame,Math.max(16,Math.min(1000,data.wait)));return;
    }
    if(data.type==='catching-up'){requestFrame();return;}
    latestLines=data.lines;latestPatch=data.patch;latestAudio=data.audio;
    paint(latestLines,latestPatch);sound.update(data.lambda);sound.sync(latestAudio);
    enterObservation();
    if(dev) window.solarisDebug={state:structuredClone(state),n:data.n,u:data.u,grid,fieldMilliseconds:data.duration,
     audioState:sound.context?.state,audioOffset:((clock.now()-state.t0)/1000+state.acoustic.offset)%49};
    // Adapt only projection cost. The simulation and history remain unchanged.
    if(data.duration>90&&grid>128&&++slow>=5){grid-=32;slow=0;}
    renderTimer=setTimeout(requestFrame,Math.max(0,50-data.duration));
   };
   worker.postMessage({type:'init',state,world,maxAdvance});
  }
  requestFrame();
 } catch(e){fail(e);}
}
button.addEventListener('click',start);
entry.addEventListener('transitionend',()=>{if(entry.classList.contains('gone'))entry.hidden=true;});
// If a mobile OS revokes audio permission, the next touch resumes it invisibly.
document.addEventListener('pointerdown',()=>{
 if(entered&&sound.context?.state!=='running')sound.unlock().then(()=>sound.sync(latestAudio,true)).catch(console.error);
});
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){clearTimeout(renderTimer);sound.stop();}
 else if(entered){sound.context?.resume().then(()=>requestFrame()).catch(()=>requestFrame());requestFrame();}
});
addEventListener('pageshow',()=>{if(entered)requestFrame();});
addEventListener('pagehide',()=>sound.stop());
addEventListener('resize',resize);resize();
