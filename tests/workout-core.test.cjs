'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bike-cardio', 'index.html'), 'utf8');
const script = id => html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`))[1];
const context = vm.createContext({});
vm.runInContext(script('heart-rate-core') + script('workout-core') + ';globalThis.C = WorkoutCore;', context);
const C = context.C;

for (const mode of ['zone2', 'sprint']) {
  test(`${mode}: every phase can be skipped, including HR gates and final cool-down`, () => {
    const s = C.create({mode}, 1000, mode);
    const plan = C.build(s.config);
    for (let index = 0; index < plan.length; index++) {
      assert.equal(s.index, index);
      assert.equal(s.status, 'running');
      const events = C.skip(s, s.lastAt + 100);
      assert.equal(s.finishedPhases[index].outcome, 'skipped');
      assert.equal(s.finishedPhases[index].ms, 100);
      assert.equal(events.at(-1).type, index === plan.length - 1 ? 'finish' : 'phase');
    }
    assert.equal(s.status, 'finished');
    assert.equal(s.activeMs, plan.length * 100);
    assert.equal(C.record(s).outcome, 'partial');
    assert.equal(C.record(s).effortsCompleted, 0);
  });
}

test('skip does not skip the following phase when the current timer just expired', () => {
  const s = C.create({}, 1000, 'boundary');
  s.phaseMs = 299900;
  s.activeMs = 299900;
  C.skip(s, 1100);
  assert.equal(s.index, 1);
  assert.equal(s.finishedPhases.length, 1);
  assert.equal(s.finishedPhases[0].outcome, 'complete');
  assert.equal(s.phaseMs, 0);
});

test('skipping final timed phase at its boundary finishes without throwing', () => {
  const s = C.create({mode: 'sprint'}, 1000, 'final');
  while (C.phase(s).kind !== 'cooldown') C.skip(s, s.lastAt);
  s.phaseMs = 299900;
  C.skip(s, s.lastAt + 100);
  assert.equal(s.status, 'finished');
});

test('skipping a recovery counts only the time ridden and preserves completed efforts', () => {
  const s = C.create({mode: 'sprint', eff: 30}, 1000, 'recovery');
  while (C.phase(s).kind !== 'effort') C.skip(s, s.lastAt);
  for (let i = 0; i < 3; i++) C.advance(s, s.lastAt + 10000);
  assert.equal(C.phase(s).gate, 'recovery');
  const activeBefore = s.activeMs;
  C.skip(s, s.lastAt + 250);
  assert.equal(C.phase(s).kind, 'ready');
  assert.equal(s.activeMs, activeBefore + 250);
  C.end(s, s.lastAt);
  assert.equal(C.record(s).effortsCompleted, 1);
});

test('normal HR-gated completion still requires its minimum time and HR confirmation', () => {
  const s = C.create({}, 1000, 'gate');
  C.skip(s, 1000);
  C.skip(s, 1000);
  C.gate(s, 1100, true);
  assert.equal(s.status, 'running');
  s.phaseMs = C.phase(s).min;
  C.gate(s, 1100, false);
  assert.equal(s.status, 'running');
  C.gate(s, 1100, true);
  assert.equal(s.status, 'finished');
  assert.equal(s.finishedPhases.at(-1).outcome, 'complete');
});

test('custom targets and durations drive phases, advice, measurement and recorded history',()=>{
  vm.runInContext('globalThis.H=HeartRateCore;globalThis.T=BikeTargets;globalThis.B=BikeHistory;',context);
  const targets={zoneMin:120,adjustBelow:123,targetMin:125,comparisonHR:130,targetMax:135,zoneMax:140};
  const s=C.create({targets,warmupMinutes:7,mainMinutes:40,cooldown:4,recoverySeconds:90,sprintCooldownMinutes:6},1000,'custom');
  const plan=C.build(s.config);assert.equal(plan[0].duration,420000);assert.equal(plan[1].duration,2400000);assert.equal(plan[2].min,240000);assert.equal(plan[1].hr,'125–135');
  const stats=context.H.createStats(targets);
  context.H.sample(stats,{valid:true,bpm:130,at:1000},1000,0);context.H.sample(stats,{valid:true,bpm:150,at:2000},2000,1000);
  assert.equal(stats.zoneMs,1000);assert.equal(context.H.advice({valid:true,bpm:130,at:2000},2000,targets).action,'hold');
  assert.equal(context.H.advice({valid:true,bpm:145,at:2000},2000,targets).action,'high');
  s.hr=stats;const restored=C.restore(JSON.parse(JSON.stringify(s)),1000);assert.equal(restored.hr.targets.zoneMin,120);
  const r=C.record(s);assert.equal(r.config.targets.comparisonHR,130);assert.equal(r.hr.targets.zoneMax,140);
  const next=C.config();assert.equal(next.targets.zoneMin,105);assert.equal(r.config.targets.zoneMin,120);
  const sprint=C.build({...s.config,mode:'sprint'});assert.equal(sprint.find(p=>p.gate==='recovery').min,90000);assert.equal(sprint.at(-1).duration,360000);
});
test('legacy plans retain original targets; invalid imported targets and durations are rejected',()=>{
  assert.equal(C.config({}).targets.comparisonHR,115);
  for(const input of [{targets:{zoneMax:100}},{targets:{comparisonHR:NaN}},{mainMinutes:0},{n:5.5},{recoverySeconds:900}])assert.throws(()=>C.config(input));
});
test('history filtering and trends keep contexts, machines, targets and missing readings distinct',()=>{
  vm.runInContext('globalThis.B=BikeHistory;',context);const B=context.B;
  const ride=(id,startedAt,config={},metrics={})=>({id,startedAt,config:C.config(config),metrics,mainMs:1500000,outcome:'complete'});
  const a=ride('a',new Date('2026-10-01T10:00:00').getTime(),{bikeId:'window'},{fixedHRWatts:'140'}),missing=ride('missing',a.startedAt+1000,{bikeId:'window'}),b=ride('b',a.startedAt+2000,{bikeId:'window'},{fixedHRWatts:'150'});
  const post=ride('post',b.startedAt,{bikeId:'window',context:'post-lifting'},{fixedHRWatts:'130'}),different=ride('target',b.startedAt,{bikeId:'window',targets:{comparisonHR:116}},{fixedHRWatts:'160'});
  const other=ride('other',b.startedAt,{bikeId:'door'},{fixedHRWatts:'170'});
  const rides=[b,post,a,missing,different,other];
  assert.equal(B.value(missing,'fixedHRWatts'),null);assert.equal(B.value(missing,'coverage'),null);
  const groups=B.series(rides,'fixedHRWatts');assert.equal(groups.length,4);assert.equal(groups.find(g=>g.length===3)[1].value,null);
  const filtered=B.filter(rides,{machine:B.machineKey(a),context:'fresh',from:'2026-10-01',to:'2026-10-01'});assert.equal(filtered.length,4);assert.equal(filtered.at(-1).id,'a');
  assert.equal(B.filter(rides,{from:'2026-10-02'}).length,0);
});
test('a series depends only on the durations its own plan uses',()=>{
  const B=vm.runInContext('BikeHistory',context),key=config=>B.seriesKey({id:'r',config:C.config(config)});
  assert.equal(key({recoverySeconds:30,settleMinutes:4,sprintCooldownMinutes:8,n:3,eff:20}),key({}),'sprint settings do not split Zone 2 history');
  assert.notEqual(key({mainMinutes:40}),key({}));
  assert.equal(key({mode:'sprint',mainMinutes:40,cooldown:9}),key({mode:'sprint'}),'Zone 2 settings do not split sprint history');
  assert.notEqual(key({mode:'sprint',recoverySeconds:30}),key({mode:'sprint'}));
});
test('active-session versions 1 and 2 remain resumable; new plans carry version 3',()=>{
  const current=C.create({},1000,'migration');assert.equal(current.version,3);
  for(const version of [1,2]){const old=JSON.parse(JSON.stringify(current));old.version=version;old.status='paused';old.config.transition=false;delete old.config.targets;delete old.hr.targets;const restored=C.restore(old,1000);assert.equal(restored.version,3);assert.equal(restored.config.targets.zoneMax,122);}
});
