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
test('a Zone 2 ride records a 5-second HR trace, main-block HR, drift and 60-second recovery',()=>{
  const H=vm.runInContext('HeartRateCore',context),T=vm.runInContext('BikeTrace',context),t0=1000000;
  const s=C.create({mode:'zone2',warmupMinutes:1,mainMinutes:10,cooldown:1},t0,'traced');
  // Warm-up 0-60 s at 100 bpm, main 60-360 s at 115 and 360-660 s at 121, cool-down at 96.
  const bpm=sec=>sec<60?100:sec<360?115:sec<660?121:96;
  for(let sec=0;sec<=730;sec++){const now=t0+sec*1000;C.advance(s,now,{visible:true});H.sample(s.hr,{bpm:bpm(sec),valid:true,at:now},now,s.activeMs);}
  C.gate(s,t0+730000,true);assert.equal(s.status,'finished');
  const r=C.record(s);
  assert.equal(r.hr.main.averageHR,118);assert.equal(r.hr.main.coverage,100);assert.equal(r.hr.main.driftPct,5.2);
  assert.equal(JSON.stringify(r.hr.recovery60),'[25]');assert.equal(r.metrics.mainAverageHR,'118','a well-measured main block fills the reading');
  const trace=T.decode(r.hr.trace.bpm,1,300);assert.equal(r.hr.trace.binSeconds,5);assert.equal(trace.length,146);
  assert.equal(JSON.stringify([trace[0],trace[20],trace[100],trace[140]]),'[100,115,121,96]');
  // A ride with half the main block unmeasured keeps the trace but leaves the reading to the rider.
  const gap=C.create({mode:'zone2',warmupMinutes:1,mainMinutes:10,cooldown:1},t0,'gap');
  for(let sec=0;sec<=730;sec++){const now=t0+sec*1000;C.advance(gap,now,{visible:true});if(sec<400||sec>=660)H.sample(gap.hr,{bpm:bpm(sec),valid:true,at:now},now,gap.activeMs);else H.breakSeries(gap.hr);}
  C.gate(gap,t0+730000,true);const partial=C.record(gap);
  assert(partial.hr.main.coverage<80);assert.equal(partial.metrics.mainAverageHR,undefined);assert.equal(partial.hr.main.driftPct,null);
  // Sprints get a recovery per effort; a ride without readings has no trace.
  const none=C.create({mode:'sprint'},t0,'none');C.end(none,t0+60000);assert.equal(C.record(none).hr.trace,undefined);
});
test('a saved ride keeps its HR trace when restored',()=>{
  const H=vm.runInContext('HeartRateCore',context),t0=1000000,s=C.create({},t0,'saved');
  for(let sec=0;sec<=30;sec++){const now=t0+sec*1000;C.advance(s,now,{visible:true});H.sample(s.hr,{bpm:110,valid:true,at:now},now,s.activeMs);}
  const restored=C.restore(JSON.parse(JSON.stringify(s)),t0+31000);
  assert.equal(restored.hr.trace.ms.length,6);assert.equal(restored.hr.trace.sum[0],110*5000);
  const broken=JSON.parse(JSON.stringify(s));broken.hr.trace={ms:[1],sum:[]};assert.equal(C.restore(broken,t0+31000).hr.trace.ms.length,0,'a malformed trace is dropped, the ride is kept');
});
test('a Zone 2 ride with a bike sensor fills main-block watts, cadence, watts at comparison HR and decoupling',()=>{
  const H=vm.runInContext('HeartRateCore',context),P=vm.runInContext('PowerCore',context),t0=1000000;
  const s=C.create({mode:'zone2',warmupMinutes:1,mainMinutes:10,cooldown:1},t0,'powered');
  const bpm=sec=>sec<60?100:sec<360?115:sec<660?121:96,watts=sec=>sec<60?100:sec<360?150:sec<660?145:80;
  for(let sec=0;sec<=730;sec++){const now=t0+sec*1000;C.advance(s,now,{visible:true});
    H.sample(s.hr,{bpm:bpm(sec),valid:true,at:now},now,s.activeMs);P.sample(s.power,{watts:watts(sec),cadence:90,valid:true,at:now},now,s.activeMs);}
  C.gate(s,t0+730000,true);const r=C.record(s);
  assert.equal(JSON.stringify(r.power.main),'{"averageWatts":147.5,"cadence":90,"coverage":100,"decouplingPct":8.1,"fixedHRWatts":150}');
  assert.equal(r.power.peak5sWatts,150);assert.equal(r.power.coverage,100);
  assert.equal(JSON.stringify([r.metrics.averageWatts,r.metrics.cadence,r.metrics.fixedHRWatts]),'["147.5","90","150"]');
  const restored=C.restore(JSON.parse(JSON.stringify(C.create({},t0,'old'))),t0);assert.equal(restored.power.watts.ms.length,0);
  const legacy=JSON.parse(JSON.stringify(C.create({},t0,'legacy')));delete legacy.power;assert.equal(C.restore(legacy,t0).power.samples,0,'a saved ride from before keeps working');
});
const planExample=JSON.parse(fs.readFileSync(path.join(__dirname,'..','examples','bike-plan-sprint.json'),'utf8'));
const P=vm.runInContext('BikePlans',context);
const json=value=>JSON.stringify(value);
test('a planned sprint expands like the sprint template with the same durations',()=>{
  const [plan]=P.parse(JSON.stringify(planExample),()=>'plan-a'),phases=P.expand(plan.steps);
  const template=C.build({mode:'sprint',warmupMinutes:8,n:4,eff:30,settleMinutes:2,recoverySeconds:60,sprintCooldownMinutes:5});
  assert.equal(json(phases.map(p=>[p.kind,p.duration,p.min??null])),json(template.map(p=>[p.kind,p.duration,p.min??null])));
  assert.equal(phases.filter(p=>p.kind==='recovery').length,3,'recovery runs between efforts only');
  assert.equal(json(phases.filter(p=>p.kind!=='ready').map(p=>p.title)),json(['Easy warm-up','Primer','Easy','Effort 1 of 4','Recovery 1','Effort 2 of 4','Recovery 2','Effort 3 of 4','Recovery 3','Effort 4 of 4','Cool-down']));
  const warmup=phases[0],recovery=phases.find(p=>p.kind==='recovery'),effort=phases.find(p=>p.kind==='effort');
  assert.equal(json([warmup.res,warmup.rpm,warmup.hr]),json(['6–8','80–90','Under 120']));
  assert.equal(json([recovery.gate,recovery.gateBpm,recovery.hr,recovery.min]),json(['recovery',122,'122 or below',60000]));
  assert.equal(json([effort.effort,effort.base,effort.res,phases[effort.id-1].res]),json([1,16,'16','16']),'the countdown shows the effort resistance');
  assert.equal(P.minimumMs(phases),1235000,'20 min 35 s before HR-gated recoveries run longer');
  const c=C.config({plan});assert.equal(c.mode,'sprint');assert.equal(c.n,4);assert.equal(c.plan.hash,plan.hash);
});
test('the adjust rule moves each effort from the last one by its cadence flag',()=>{
  const [plan]=P.parse(planExample,()=>'plan-b'),s=C.create({plan},1000,'adjust');
  assert.equal(C.effortTarget(s,1),16);assert.equal(C.effortTarget(s,2),16,'no flag keeps the resistance');
  C.logEffort(s,1,{resistance:16,cadenceFlag:'high'});assert.equal(C.effortTarget(s,2),18);
  C.logEffort(s,2,{resistance:19,cadenceFlag:'low'});assert.equal(C.effortTarget(s,3),17,'starts from the resistance logged, not the target');
  C.logEffort(s,3,{cadenceFlag:'ok'});assert.equal(C.effortTarget(s,4),17);
  C.logEffort(s,1,{resistance:500});assert.equal(s.efforts[0].resistance,null,'out-of-range resistance is unknown');
  const restored=C.restore({...JSON.parse(JSON.stringify(s)),status:'paused',efforts:[{resistance:'x',cadenceFlag:'sideways'},null]},1000);
  assert.equal(json(restored.efforts),json([{resistance:null,cadenceFlag:null},{resistance:null,cadenceFlag:null}]));
});
test('a plan hash follows its steps and ignores name, date, order and notes',()=>{
  const [plan]=P.parse(planExample,()=>'plan-c'),again=P.normalize(plan);
  assert.equal(again.hash,plan.hash);assert.equal(json(again),json(plan),'normalizing twice changes nothing');
  assert.equal(P.normalize({...plan,name:'Renamed',scheduledFor:'2026-11-01',order:7,notes:'x'}).hash,plan.hash);
  const longer=structuredClone(planExample);longer.id='x';longer.steps[0].seconds=600;assert.notEqual(P.normalize(longer).hash,plan.hash);
  const B=vm.runInContext('BikeHistory',context),key=p=>B.seriesKey({id:'r',config:C.config({plan:p})});
  assert.equal(key({...plan,name:'Other name'}),key(plan));assert.notEqual(key(P.normalize(longer)),key(plan));
});
test('invalid plans fail with the step that is wrong',()=>{
  const bad=(change,pattern)=>{const raw=structuredClone(planExample);raw.id='bad';change(raw);assert.throws(()=>P.normalize(raw),pattern);};
  bad(raw=>{raw.steps=[];},/steps must list/);
  bad(raw=>{raw.steps[0].kind='tempo';},/Step 1: kind must be/);
  bad(raw=>{raw.steps[0].untilHrBelow=110;},/Step 1 needs exactly one/);
  bad(raw=>{raw.steps[1]={kind:'primer',untilHrAtMost:120};},/a primer needs seconds/);
  bad(raw=>{raw.steps[2].adjust={cadenceAbove:110};},/adjust needs an effort/);
  bad(raw=>{raw.steps[3].repeat=21;},/repeat must be a whole number from 2 to 20/);
  bad(raw=>{raw.steps[0].resistance=[8,6];},/resistance must be/);
  bad(raw=>{raw.scheduledFor='17/10/2026';},/scheduledFor/);
  bad(raw=>{raw.record=['everything'];},/record may list only/);
  assert.throws(()=>P.parse('{"name": "x",'),/not valid JSON/);
  const fenced=P.parse('```json\n'+JSON.stringify({plans:[planExample,{...planExample,name:'Second'}]})+'\n```',(()=>{let n=0;return ()=>'id-'+(++n);})());
  assert.equal(json(fenced.map(p=>[p.id,p.name])),json([['id-1','Sprint baseline'],['id-2','Second']]),'code fences and a plans list are accepted');
});
test('a planned ride records each effort with logged resistance and sensor readings',()=>{
  const T=vm.runInContext('BikeTrace',context),[plan]=P.parse(planExample,()=>'plan-d'),s=C.create({plan},1000,'efforts');
  while(C.phase(s).kind!=='effort')C.skip(s,s.lastAt);
  for(let i=0;i<3;i++)C.advance(s,s.lastAt+10000);
  assert.equal(C.phase(s).kind,'recovery');
  const [span]=C.effortSpans(s);assert.equal(span.to-span.from,30000);
  T.add(s.power.watts,span.from,span.to,600);T.add(s.power.rpm,span.from,span.to,115);s.power.measuredMs=30000;
  C.logEffort(s,1,{resistance:16});C.end(s,s.lastAt);
  const r=C.record(s);
  assert.equal(json(r.efforts),json([{effort:1,outcome:'complete',resistance:16,cadenceFlag:'high',watts5s:600,peakWatts:600,peakCadence:115,wattsSource:'sensor'}]));
  assert.equal(r.config.plan.name,'Sprint baseline');assert.equal(json(Object.keys(r.conditions)),json(['timeOfDay','hoursSinceLifting','fed','note','confirmed']));
});
