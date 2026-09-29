const wrap=x=>x-Math.floor(x);
export function firstAcoustic(lambda) {
 return {offset:0,previousOffset:0,blend:.48,previousBlend:.48,lambda:[...lambda]};
}
export function advanceAcoustic(previous,lambda,rnd) {
 const shift=.16+.68*wrap(rnd('acoustic-phase')+.37*lambda[0]+.23*lambda[3]+.11*lambda[5]);
 return {offset:49*wrap(previous.offset/49+shift),previousOffset:previous.offset,
  blend:.34+.28*lambda[4],previousBlend:previous.blend,
  lambda:previous.lambda.map((v,i)=>.78*v+.22*lambda[i])};
}
export function acousticGains(u,blend) {
 const v=Math.max(0,Math.min(1,u/blend)),cross=v*v*(3-2*v);
 const residual=(1-cross)+.12*cross*(1-u)**2;
 return {current:1-residual,previous:residual};
}
