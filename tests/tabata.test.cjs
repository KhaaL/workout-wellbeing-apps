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
assert.equal(S.prepare(raw).version,2,'Prepared data is version 2');
const steps='# Circuit\n1. Burpees\n2. Squats';
const withSteps=S.prepare({...raw,version:2,settings:{...config,instructions:steps}});
assert.equal(withSteps.settings.instructions,steps);assert.equal(withSteps.active.config.instructions,undefined,'The running plan never copies instructions');
assert.equal(C.settings({instructions:'x'.repeat(10000)}).instructions.length,10000);
for(const instructions of ['x'.repeat(10001),42,['a']])assert.throws(()=>C.settings({instructions}),/Instructions must be text/);
assert.throws(()=>S.prepare({...raw,version:3}),/newer Tabata version/);
for(const version of [0,'2',null])assert.throws(()=>S.prepare({...raw,version}),/Not a valid Tabata backup/);
console.log('PASS Tabata: phase boundaries, delayed callbacks, zero rest, pause/resume, checkpoints, instructions and backup validation');
