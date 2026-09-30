import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
import {runInNewContext} from 'node:vm';
import {gzipSync} from 'node:zlib';
import {initial,advance,T} from './law.js';
import {loadWorld,readCurrentState,readCheckpoint,MAX_FAST_ADVANCE} from './world.js';
const world=JSON.parse(readFileSync(new URL('./universe.json',import.meta.url)));
const states=new Map();let s=initial(world.seed,world.t0);
for(let n=0;n<=96;n++){states.set(n,structuredClone(s));s=advance(s).next;}
const manifest={...world,stride:16,from:0,through:96,directory:'states/0123456789abcdef/'};
const when=n=>world.t0+(n+.4)*T*1000;
const json=(x,status=200)=>new Response(JSON.stringify(x),{status});

test('one small state, at most 15 generations, exact continuous history',async()=>{
 for(let target=0;target<=96;target++) {
  const urls=[];
  const loaded=await readCurrentState(world,when(target),manifest,async url=>{
   urls.push(url.pathname);return json(states.get(Number(url.pathname.match(/(\d+)\.json$/)[1])));
  });
  assert.equal(urls.length,1);assert.equal(loaded.maxAdvance,MAX_FAST_ADVANCE);
  assert.ok(target-loaded.state.n<=15);
  let state=loaded.state;while(state.n<target)state=advance(state).next;
  assert.deepEqual(state,states.get(target));
 }
});
test('missing current state never triggers a replay from birth',async()=>{
 let requests=0;
 await assert.rejects(readCurrentState(world,when(81),manifest,async()=>{requests++;return json({},404);}));
 assert.equal(requests,1);
});
test('expired publication stops instead of pretending an old state is current',async()=>{
 let requests=0;
 await assert.rejects(readCurrentState(world,when(128),manifest,async()=>{requests++;}));
 assert.equal(requests,0);
});
test('a state from another world is rejected',async()=>{
 await assert.rejects(readCurrentState(world,when(81),manifest,async()=>json({...states.get(80),seed:'different'})));
});
test('root-uploaded legacy files are supported without changing their contents',async()=>{
 const n=world.stride,index=Math.floor((n/world.stride-1)/world.chunkSize),urls=[];
 const chunk=JSON.parse(readFileSync(new URL('./chunk-'+index+'.json',import.meta.url)));
 const state=await readCheckpoint(world,n,async url=>{urls.push(url.pathname);
  return url.pathname.includes('/checkpoints/')?json({},404):json(chunk);});
 assert.equal(urls.length,2);assert.deepEqual(state,chunk[n]);
});
test('loadWorld requests the index and identity, then only the selected state',async()=>{
 const urls=[];
 const loaded=await loadWorld({now:()=>when(81),synchronize:()=>{}},async url=>{
  urls.push(url.pathname);
  if(url.pathname.endsWith('universe.json'))return json(world);
  if(url.pathname.endsWith('current.json'))return json(manifest);
  return json(states.get(80));
 });
 assert.equal(loaded.state.n,80);assert.equal(urls.length,3);
 assert.ok(urls.every(url=>!url.includes('chunk-')));
});
test('legacy fallback cannot accumulate unbounded replay after its horizon',async()=>{
 await assert.rejects(readCurrentState(world,when(world.through+world.stride),null,async()=>{
  assert.fail('No history should be fetched');
 }));
});
test('pre-birth observation retains original generation zero',async()=>{
 const result=await readCurrentState(world,world.t0-1000,manifest,async()=>json(states.get(0)));
 assert.deepEqual(result.state,states.get(0));
});

test('compressed packs load the same current state with a single small request',async()=>{
 const packed={...manifest,encoding:'gzip-json',packSize:32,prefix:'solaris-state-0123456789abcdef-'};
 const bytes=gzipSync(JSON.stringify(Object.fromEntries(states)));
 for(const target of [0,15,16,31,47,80,95]) {
  const requests=[];
  const result=await readCurrentState(world,when(target),packed,async url=>{
   requests.push(url.pathname);return new Response(bytes);
  });
  assert.equal(requests.length,1);assert.ok(requests[0].endsWith('-0.bin'));
  assert.deepEqual(result.state,states.get(Math.floor(target/16)*16));
 }
});
test('damaged compressed data fails without inventing a replacement world',async()=>{
 const packed={...manifest,encoding:'gzip-json',packSize:32,prefix:'solaris-state-0123456789abcdef-'};
 await assert.rejects(readCurrentState(world,when(80),packed,async()=>new Response('invalid gzip')));
});

test('worker resumes a sleeping tab by fetching a bounded current state',async()=>{
 const nextStates=new Map();let state=states.get(96);
 while(state.n<208)state=advance(state).next;
 nextStates.set(208,state);
 const worker=new Worker(`
  const {parentPort,workerData}=require('node:worker_threads');
  global.self={postMessage:(data)=>parentPort.postMessage(data)};
  global.fetch=async url=>{
   const path=url.pathname;
   const body=path.endsWith('universe.json')?workerData.world:
    path.endsWith('current.json')?workerData.manifest:workerData.current;
   return new Response(JSON.stringify(body));
  };
  import(workerData.url).then(()=>parentPort.on('message',data=>self.onmessage({data})));
 `,{eval:true,workerData:{url:new URL('./worker.js',import.meta.url).href,world,
  manifest:{...manifest,through:208},current:state}});
 const next=()=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
 try {
  let reply=next();worker.postMessage({type:'init',world,state:states.get(16),maxAdvance:15});
  assert.equal((await reply).type,'ready');
  reply=next();worker.postMessage({type:'frame',now:when(213),size:32});
  let frame=await reply;
  while(frame.type==='catching-up') {
   reply=next();worker.postMessage({type:'frame',now:when(213),size:32});frame=await reply;
  }
  assert.equal(frame.type,'frame');assert.equal(frame.n,213);
  while(state.n<213)state=advance(state).next;
  assert.deepEqual(frame.checkpoint,state);
 }finally{await worker.terminate();}
});

test('first visual frame does not wait for the audio download',async()=>{
 const classes=new Set(),listeners={};
 const button={disabled:false,blur(){},addEventListener:(name,fn)=>listeners[name]=fn};
 const entry={querySelector:()=>button,hidden:false,inert:false,addEventListener(){},
  classList:{contains:x=>classes.has(x),add:x=>classes.add(x),remove:x=>classes.delete(x)}};
 const ctx=new Proxy({},{get:()=>()=>{},set:()=>true});
 const canvas={getContext:()=>ctx};
 const document={hidden:false,querySelector:selector=>selector==='canvas'?canvas:selector==='#entry'?entry:{},
  addEventListener(){}};
 class FakeSound {
  unlock(){return new Promise(()=>{});} // A stalled network or audio decoder.
  update(){} sync(){} stop(){}
 }
 class FakeWorker {
  postMessage(data){
   if(data.type==='init')queueMicrotask(()=>this.onmessage({data:{type:'ready'}}));
   else queueMicrotask(()=>this.onmessage({data:{type:'frame',lines:new Float32Array(0),
    patch:null,audio:{},lambda:[],n:16,u:0,duration:1}}));
  }
 }
 const source=readFileSync(new URL('./main.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(new URL('./main.js',import.meta.url).href));
 runInNewContext(source,{WorldClock:class {now(){return when(16);}},loadWorld:async()=>({world,state:states.get(16),maxAdvance:15}),
  Sound:FakeSound,Worker:FakeWorker,document,window:{},location:{href:'https://example.test/Solaris/',search:''},
  localStorage:{removeItem(){}},innerWidth:390,innerHeight:844,devicePixelRatio:2,
  addEventListener(){},setTimeout:()=>1,clearTimeout(){},URL,URLSearchParams,console,queueMicrotask});
 await listeners.click();
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(classes.has('gone'),'The current image must be shown while audio is still pending');
});
