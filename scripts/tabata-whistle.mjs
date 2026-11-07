// Renders Tabata's start whistle and writes apps/tabata/whistle-audio.js.
// Usage: node scripts/tabata-whistle.mjs [--wav out.wav]   (needs ffmpeg with libmp3lame on PATH)
// The model follows a pea whistle: blowing pressure sets pitch and loudness, the spinning
// pea chops the airflow (deep amplitude dips with a small pitch wobble), and turbulent
// breath noise resonates in the chamber. A seeded generator keeps the output reproducible.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SR=44100,DURATION=.85,ATTACK=.018,RELEASE=.11,PITCH=3150,N=Math.round(SR*DURATION);
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');

function random(seed){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const rand=random(20261107),white=()=>rand()*2-1;
// Slow random movement for breath pressure and pea speed: white noise through a one-pole low-pass.
function wander(cutoff){const a=Math.exp(-2*Math.PI*cutoff/SR);let y=0;const out=new Float64Array(N);for(let i=0;i<N;i++){y=a*y+(1-a)*white();out[i]=y;}const peak=maxAbs(out);return out.map(v=>v/peak);}
const maxAbs=x=>x.reduce((m,v)=>Math.max(m,Math.abs(v)),0),rms=x=>Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length);

const pressureDrift=wander(3),peaDrift=wander(6),pitchDrift=wander(9);
const pressure=new Float64Array(N),tone=new Float64Array(N),chop=new Float64Array(N),pitch=new Float64Array(N);
let toneOscillator=0,peaPhase=0;
for(let i=0;i<N;i++){
  const t=i/SR,end=DURATION-t;
  // A tongued start reaches full pressure in 18 ms; the blast sags slightly and tails off over 110 ms.
  let p=t<ATTACK?Math.sin(Math.PI/2*t/ATTACK)**2:1-.08*t/DURATION;
  if(end<RELEASE)p*=Math.sin(Math.PI/2*end/RELEASE)**1.5;
  p*=1+.04*pressureDrift[i];pressure[i]=p;
  // The pea spins faster with more pressure: about 38 Hz at full blast.
  peaPhase+=2*Math.PI*(14+24*p+2.5*peaDrift[i])/SR;
  const pea=.5+.5*Math.sin(peaPhase),established=Math.min(1,t/.06);
  chop[i]=1-.8*established*pea**2.2;
  // Pitch rises with pressure, wobbles about 2.5 % with the pea and drifts a little.
  pitch[i]=PITCH*(.86+.14*Math.min(p,1.05))*(1+.025*established*Math.sin(peaPhase-.9))*(1+.003*pitchDrift[i]);
  toneOscillator+=2*Math.PI*pitch[i]/SR;
  tone[i]=Math.sin(toneOscillator)+.16*Math.sin(2*toneOscillator+.4)+.045*Math.sin(3*toneOscillator+1.3);
}
// Breath noise resonating in the chamber: a band-pass (Q 9) that follows the pitch.
const chamber=new Float64Array(N);{let x1=0,x2=0,y1=0,y2=0;
  for(let i=0;i<N;i++){const w=2*Math.PI*pitch[i]/SR,alpha=Math.sin(w)/18,a0=1+alpha,x=white();
    const y=(alpha*x-alpha*x2-(-2*Math.cos(w))*y1-(1-alpha)*y2)/a0;x2=x1;x1=x;y2=y1;y1=y;chamber[i]=y;}}
// Broadband hiss of air at the mouthpiece, strongest during the attack.
const hiss=new Float64Array(N);{let low=0;for(let i=0;i<N;i++){const x=white();low+=.25*(x-low);hiss[i]=x-low;}}
const toneLevel=1/rms(tone),chamberLevel=10**(-9/20)/rms(chamber),hissLevel=10**(-24/20)/rms(hiss);
const dry=new Float64Array(N);
for(let i=0;i<N;i++){
  const t=i/SR,p=pressure[i],onset=1+5*Math.exp(-t/.012);
  dry[i]=p*chop[i]*(toneLevel*tone[i]+chamberLevel*chamber[i])+p*(.6+.4*chop[i])*onset*hissLevel*hiss[i];
}
// A short, quiet room tail (60 ms, -20 dB) so the blast does not sound like a test tone.
const tailLength=Math.round(SR*.06),tail=new Float64Array(tailLength).map((_,i)=>white()*Math.exp(-i/SR/.018));
const tailNorm=10**(-20/20)/Math.sqrt(tail.reduce((s,v)=>s+v*v,0)),out=new Float64Array(N+tailLength);
for(let i=0;i<N;i++){out[i]+=dry[i];const v=dry[i]*tailNorm;if(v)for(let k=1;k<tailLength;k++)out[i+k]+=v*tail[k];}
const peak=maxAbs(out),pcm=Buffer.alloc(44+out.length*2);
pcm.write('RIFF',0);pcm.writeUInt32LE(36+out.length*2,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);
pcm.writeUInt32LE(SR,24);pcm.writeUInt32LE(SR*2,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(out.length*2,40);
out.forEach((v,i)=>pcm.writeInt16LE(Math.round(v/peak*.89*32767),44+i*2));

const work=fs.mkdtempSync(path.join(os.tmpdir(),'tabata-whistle-')),wav=path.join(work,'whistle.wav'),mp3=path.join(work,'whistle.mp3');
fs.writeFileSync(wav,pcm);
const wavIndex=process.argv.indexOf('--wav');if(wavIndex>0)fs.copyFileSync(wav,process.argv[wavIndex+1]);
execFileSync('ffmpeg',['-loglevel','error','-y','-i',wav,'-map_metadata','-1','-fflags','+bitexact','-flags:a','+bitexact','-ac','1','-codec:a','libmp3lame','-b:a','128k',mp3]);
const base64=fs.readFileSync(mp3).toString('base64');
fs.writeFileSync(path.join(root,'apps/tabata/whistle-audio.js'),`/* Pea whistle rendered by scripts/tabata-whistle.mjs; no recording is used. See AUDIO-CREDITS.md.
   Encoded MP3, embedded so offline and local-file previews both work. */
/* exported TabataWhistleAudio */
const TabataWhistleAudio = '${base64}';
`);
fs.rmSync(work,{recursive:true});
console.log(`whistle-audio.js: ${(out.length/SR).toFixed(2)} s, ${base64.length} base64 characters`);
