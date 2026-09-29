import {T} from './law.js';
import {acousticGains} from './acoustic-law.js';
export class Sound {
 constructor(now=()=>Date.now()){this.now=now;this.context=null;this.voices=new Map();this.anchor=null;this.ready=null;this.generation=null;}
 async unlock() {
  if(!this.context) {
   this.context=new (window.AudioContext||window.webkitAudioContext)();
   const c=this.context;
   this.master=c.createGain();this.master.gain.value=0;
   this.filter=c.createBiquadFilter();this.filter.type='lowpass';this.filter.Q.value=.5;
   this.pan=c.createStereoPanner();this.delay=c.createDelay(1);
   this.feedback=c.createGain();this.wet=c.createGain();
   this.filter.connect(this.pan);this.pan.connect(this.master);
   this.pan.connect(this.delay);this.delay.connect(this.feedback);this.feedback.connect(this.delay);
   this.delay.connect(this.wet);this.wet.connect(this.master);this.master.connect(c.destination);
  }
  await this.context.resume();
  if(!this.ready) this.ready=fetch(new URL('./SolarisB.mp3',import.meta.url)).then(r=>{
   if(!r.ok) throw Error('The source sound could not be loaded.');return r.arrayBuffer();
  }).then(b=>this.context.decodeAudioData(b)).then(buffer=>{
   // Keep the supplied file intact. Apply a 6ms edge taper to the decoded copy only.
   const count=Math.min(buffer.length,Math.round(T*buffer.sampleRate)),fade=Math.round(.006*buffer.sampleRate);
   this.buffer=this.context.createBuffer(buffer.numberOfChannels,count,buffer.sampleRate);
   for(let ch=0;ch<buffer.numberOfChannels;ch++) {
    const out=this.buffer.getChannelData(ch);out.set(buffer.getChannelData(ch).subarray(0,count));
    for(let i=0;i<fade;i++){out[i]*=i/fade;out[count-1-i]*=i/fade;}
   }
  }).catch(e=>{this.ready=null;throw e;});
  await this.ready;
 }
 sync(manifest,force=false) {
  const c=this.context;if(!manifest||!c||!this.buffer||c.state!=='running')return;
  const wall=this.now(),now=c.currentTime;
  const drift=this.anchor?Math.abs((wall-this.anchor.wall)/1000-(now-this.anchor.audio)):Infinity;
  const n=manifest.n,age=Math.max(0,(wall-manifest.t0)/1000),u=Math.max(0,Math.min(1,age/T-n));
  if(!force&&this.generation===n&&this.voices.size&&drift<.18)return;
  if(force||drift>=.18)this.stop();
  this.generation=n;this.anchor={wall,audio:now};
  const audioTime=worldSeconds=>now+(worldSeconds-age);
  const weights=(k,worldSeconds)=>{
   const phase=worldSeconds/T-n;
   if(k===n-1)return acousticGains(Math.max(0,Math.min(1,phase)),manifest.current.blend).previous;
   if(k===n)return phase<=1?acousticGains(Math.max(0,phase),manifest.current.blend).current:
    acousticGains(Math.min(1,phase-1),manifest.next.blend).previous;
   return acousticGains(Math.max(0,Math.min(1,phase-1)),manifest.next.blend).current;
  };
  for(const [k,offset] of [[n-1,manifest.current.previousOffset],[n,manifest.current.offset],[n+1,manifest.next.offset]]) {
   const startWorld=Math.max(age,k*T),endWorld=(k===n+1?k+1:k+2)*T;
   if(endWorld<=age)continue;
   const startTime=Math.max(now,audioTime(startWorld));
   let voice=this.voices.get(k);
   if(!voice) {
    const source=c.createBufferSource(),gain=c.createGain();source.buffer=this.buffer;
    source.loop=true;source.loopStart=0;source.loopEnd=T;gain.gain.value=0;
    source.connect(gain);gain.connect(this.filter);
    source.start(startTime,((startWorld+offset)%T+T)%T);
    source.stop(audioTime((k+2)*T));voice={source,gain};this.voices.set(k,voice);
    source.onended=()=>{source.disconnect();gain.disconnect();if(this.voices.get(k)===voice)this.voices.delete(k);};
   }
   // Replace only gain automation, never restart a continuing manifestation.
   voice.gain.gain.cancelScheduledValues(0);
   const count=257,curve=new Float32Array(count);
   for(let i=0;i<count;i++)curve[i]=weights(k,startWorld+(endWorld-startWorld)*i/(count-1));
   voice.gain.gain.setValueAtTime(curve[0],startTime);
   voice.gain.gain.setValueCurveAtTime(curve,startTime,Math.max(.001,endWorld-startWorld));
  }
  // There are at most two playing voices. The third is scheduled for the next boundary.
  for(const [k,v] of this.voices)if(k<n-1||k>n+1){v.source.stop();this.voices.delete(k);}
  this.master.gain.setTargetAtTime(.14,now,.08);
 }
 update(l) {
  const c=this.context;if(!c)return;
  for(const [param,value] of [[this.filter.frequency,3500+4500*l[1]],[this.pan.pan,-.25+.5*l[5]],
   [this.delay.delayTime,.08+.32*l[2]],[this.feedback.gain,.05+.18*l[3]],[this.wet.gain,.05+.12*l[4]]])
   param.setTargetAtTime(value,c.currentTime,.12);
 }
 stop() {
  for(const voice of this.voices.values()) {
   try{voice.source.stop();}catch{}
   voice.source.disconnect();voice.gain.disconnect();
  }
  this.voices.clear();this.anchor=null;this.generation=null;
 }
}
