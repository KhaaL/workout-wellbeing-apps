const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context=vm.createContext({TextEncoder});
for(const file of ['packages/storage-engine/local.js','packages/app-ui/markdown.js','apps/tabata/timer-core.js','apps/tabata/storage-adapter.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context);
const C=vm.runInContext('TabataTimer',context),S=vm.runInContext('TabataStorage',context);
assert.equal(C.config().work,60);assert.equal(C.config().rest,3);
assert.deepEqual(Array.from(C.settings().workPresets),[60,150,180]);assert.deepEqual(Array.from(C.settings().restPresets),[3,60,120]);
const config=C.config({work:20,rest:10,rounds:8,prepare:5});
assert.equal(C.duration(config),235000,'No rest after the last work interval');
const session=C.start(config,1000,'session');
for(const [time,kind,round,remaining,completed] of [
  [1000,'prepare',1,5000,0],[5999,'prepare',1,1,0],[6000,'work',1,20000,0],
  [26000,'rest',1,10000,1],[36000,'work',2,20000,1],[226000,'work',8,10000,7],
  [236000,'complete',8,0,8],[999999,'complete',8,0,8]
]){const s=C.snapshot(session,time);assert.deepEqual([s.kind,s.round,s.remainingMs,s.completedRounds],[kind,round,remaining,completed]);}
const paused=C.pause(session,11000);assert.equal(C.elapsed(paused,99999),10000);
const resumed=C.resume(paused,50000);assert.equal(C.elapsed(resumed,55000),15000);
assert.equal(C.elapsed(C.checkpoint(resumed,55000),60000),20000,'Checkpoint preserves elapsed time');
assert.equal(C.elapsed(session,0),0,'Backward clock changes do not produce negative time');
const continuous=C.start(C.config({work:2,rest:0,rounds:2,prepare:0}),1000,'continuous');
assert.equal(C.snapshot(continuous,3000).round,2);assert.equal(C.snapshot(continuous,5000).kind,'complete');
for(const raw of [{work:0},{rest:-1},{rounds:1.5},{rounds:100},{prepare:61},{work:Infinity},{sound:'yes'}])assert.throws(()=>C.config(raw));
const raw={app:'tabata',version:1,updatedAt:0,settings:config,active:session,history:[]};
assert.equal(S.prepare(raw).active.id,'session');
assert.deepEqual(Array.from(S.prepare(raw).settings.workPresets),[60,150,180],'Older backups receive preset defaults');
assert.equal(S.prepare(raw).settings.work,20,'Older timer setups retain their durations');
const custom=S.prepare({...raw,settings:{...config,workPresets:[75,150,200],restPresets:[0,45,90]}});
assert.deepEqual(Array.from(custom.settings.workPresets),[75,150,200]);
assert.deepEqual(Array.from(custom.settings.restPresets),[0,45,90]);
assert.equal(custom.active.config.workPresets,undefined,'Presets are settings, separate from the running plan');
for(const presets of [{workPresets:[0,60,90]},{restPresets:[-1,60,90]},{workPresets:[60,150]},{restPresets:[3,60,3601]},{workPresets:[60,150,180.5]},{restPresets:'3,60,120'}])assert.throws(()=>S.prepare({...raw,settings:{...config,...presets}}));
for(const invalid of [{...raw,app:'liftlog'},{...raw,active:{...session,elapsedMs:-1}},{...raw,active:{...session,anchorAt:null}},{...raw,history:[{id:'bad',config,startedAt:1000,elapsedMs:500,outcome:'complete'}]}])assert.throws(()=>S.prepare(invalid));
const finished={id:'finished',config,startedAt:1000,elapsedMs:235000,outcome:'complete'};
assert.throws(()=>S.prepare({...raw,history:[finished,finished]}),'Duplicate history IDs rejected');
assert.throws(()=>S.prepare({...raw,active:{...session,id:'finished'},history:[finished]}),'Active timer cannot duplicate history');
// Instructions are optional settings text; version 1 data upgrades and newer data is refused.
assert.equal(C.settings().instructions,'');assert.equal(S.prepare(raw).settings.instructions,'','Version 1 backups get empty instructions');
assert.equal(S.prepare(raw).version,3,'Prepared data is version 3');
const steps='# Circuit\n1. Burpees\n2. Squats';
const withSteps=S.prepare({...raw,version:2,settings:{...config,instructions:steps}});
assert.equal(withSteps.settings.instructions,steps);assert.equal(withSteps.active.config.instructions,undefined,'The running plan never copies instructions');
assert.equal(C.settings({instructions:'x'.repeat(10000)}).instructions.length,10000);
for(const instructions of ['x'.repeat(10001),42,['a']])assert.throws(()=>C.settings({instructions}),/Instructions must be text/);
assert.throws(()=>S.prepare({...raw,version:4}),/newer Tabata version/);
// Partner pyramid: swap calls alternate partners A and B, with no separate rest.
assert.equal(C.config().mode,'intervals');assert.equal(C.config().ladder,undefined,'Interval sessions carry no ladder');
assert.deepEqual(Array.from(C.settings().ladder),[30,30,45,45,60,60,45,45,30,30],'Settings remember the standard pyramid');
const pyramid=C.config({mode:'pyramid',prepare:5});
assert.deepEqual(Array.from(pyramid.ladder),[30,30,45,45,60,60,45,45,30,30]);
assert.equal(C.duration(pyramid),425000,'Total is get-ready plus every swap call');assert.equal(C.intervals(pyramid),10);
const swaps=C.start(pyramid,1000,'pyramid');
for(const [time,kind,partner,swap,remaining,next,completed,key] of [
  [1000,'prepare',undefined,1,5000,undefined,0,'prepare'],[6000,'work','A',1,30000,30000,0,'work-1'],[35999,'work','A',1,1,30000,0,'work-1'],
  [36000,'work','B',2,30000,45000,1,'work-2'],[66000,'work','A',3,45000,45000,2,'work-3'],[156000,'work','A',5,60000,60000,4,'work-5'],
  [396000,'work','B',10,30000,0,9,'work-10'],[426000,'complete',undefined,10,0,undefined,10,'complete']
]){const s=C.snapshot(swaps,time);assert.deepEqual([s.kind,s.partner,s.round,s.remainingMs,s.nextMs,s.completedRounds,s.phaseKey],[kind,partner,swap,remaining,next,completed,key],'pyramid at '+time);}
assert.deepEqual(Array.from(C.parseLadder('30 · 30 · 45,45  60')),[30,30,45,45,60]);
for(const text of ['30','30 abc','30 0','30 3601','30 1.5',Array(41).fill(30).join(' ')])assert.throws(()=>C.parseLadder(text),undefined,text);
for(const invalid of [{mode:'ladder'},{mode:'pyramid',ladder:[30]},{mode:'pyramid',ladder:'30 30'},{mode:'pyramid',ladder:[30,-1]}])assert.throws(()=>C.config(invalid));
const pyramidRow={id:'pyramid',config:pyramid,startedAt:1000,elapsedMs:425000,outcome:'complete'};
const v3=S.prepare({...raw,version:3,active:null,settings:{...config,mode:'pyramid',ladder:[20,20,40,40]},history:[pyramidRow]});
assert.equal(v3.settings.mode,'pyramid');assert.deepEqual(Array.from(v3.settings.ladder),[20,20,40,40]);assert.equal(v3.history[0].config.ladder.length,10);
assert.throws(()=>S.prepare({...raw,history:[{...pyramidRow,elapsedMs:235000}]}),/Invalid completed session/,'A completed pyramid must cover every swap call');
assert.equal(S.prepare({...raw,active:C.start(pyramid,1000,'p')}).active.config.mode,'pyramid','A running pyramid survives a reload');
for(const version of [0,'2',null])assert.throws(()=>S.prepare({...raw,version}),/Not a valid Tabata backup/);
console.log('PASS Tabata: phase boundaries, delayed callbacks, zero rest, pause/resume, checkpoints, instructions, partner pyramids and backup validation');
