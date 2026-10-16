/* exported WorkoutCore */
const WorkoutCore = (() => {
  const VERSION = 3, CHECK_MS = 150000, SETTLE_MS = 60000, GAP_MS = 15000;
  /* How resistance cues read: 'levels' names console levels, 'feel' asks for a
     feel. Before history version 4 these were model codes; the one for a bike
     without numbered levels was 'touchscreen', and every other code meant levels. */
  const bikeCues = bike => bike === 'feel' || bike === 'touchscreen' ? 'feel' : 'levels';
  function baseConfig(input = {}) {
    const duration=(name,fallback,min,max)=>{const value=input[name]??fallback;if(!Number.isInteger(value)||value<min||value>max)throw new Error(name+' is outside its allowed range.');return value;};
    return {targets:BikeTargets.normalize(input.targets),warmupMinutes:duration('warmupMinutes',5,1,30),mainMinutes:duration('mainMinutes',25,1,180),recoverySeconds:duration('recoverySeconds',60,15,600),sprintCooldownMinutes:duration('sprintCooldownMinutes',5,1,30),settleMinutes:duration('settleMinutes',2,1,15),mode:input.mode === 'sprint' ? 'sprint' : 'zone2',bike:bikeCues(input.bike),bikeId:String(input.bikeId || '').slice(0,80),context:input.context === 'post-lifting' ? 'post-lifting' : 'fresh',cooldown:duration('cooldown',3,1,30),n:duration('n',5,1,20),eff:duration('eff',30,10,120),voice:input.voice !== false,beeps:input.beeps !== false};
  }
  function config(input = {}) {
    const c = baseConfig(input);
    if (input.plan == null) return c;
    /* A planned session decides the workout shape: efforts make it a sprint
       session, and n counts its efforts. Its numbers assume its cue style. */
    const plan = BikePlans.normalize(input.plan), efforts = BikePlans.effortCount(plan);
    return {...c, mode:BikePlans.mode(plan), n:efforts || c.n, plan};
  }
  /* The built-in workouts as plan steps. Titles with {i} and {n} are numbered per repeat. */
  function templateSteps(c) {
    const t = c.targets, levels = c.bike === 'levels';
    if (c.mode === 'zone2') return [
      {kind:'warmup',title:'Warm-up',seconds:c.warmupMinutes*60,hr:`Under ~${t.comparisonHR}`,rpm:'80–90',resistance:levels ? 'Easy · 5–7' : 'Easy · low',cue:'Start easy and build gradually. Keep breathing comfortable.'},
      {kind:'main',title:'Zone 2',seconds:c.mainMinutes*60,hr:`${t.targetMin}–${t.targetMax}`,rpm:'80–90',resistance:levels ? 'Start around 8' : 'Start around 6–8',cue:`Zone ${t.zoneMin}–${t.zoneMax} bpm. Ceiling ${t.zoneMax}. Keep cadence steady; adjust resistance only.`},
      {kind:'cooldown',title:'Cool-down',untilHrBelow:t.zoneMin,minSeconds:c.cooldown*60,hr:`Below ${t.zoneMin}`,rpm:'Easy',resistance:levels ? 'Easy · 3–5' : 'Easy · low',cue:`Spin until HR is below ${t.zoneMin}, then stop any watch recording.`}
    ];
    return [
      {kind:'warmup',title:'Warm-up',seconds:c.warmupMinutes*60,hr:`Under ${t.targetMax}`,rpm:'80–90',resistance:levels ? 'Easy · 5–7' : 'Easy · low',cue:'Build gradually. Sit upright with a loose grip.'},
      {kind:'primer',title:'Primer',seconds:10,hr:'No target',rpm:'95–105',resistance:levels ? 'Medium-hard · 12–15' : 'Medium-hard · by feel',cue:'About 80 percent for ten seconds.'},
      {kind:'settle',title:'Settle',seconds:c.settleMinutes*60,hr:`Under ${t.targetMax}`,rpm:'80–90',resistance:levels ? 'Easy · 5–7' : 'Easy · low',cue:'Spin easily before the first effort.'},
      {repeat:c.n,step:{kind:'effort',title:'Effort {i} of {n}',seconds:c.eff,hr:'Judge by feel',rpm:'100–115',resistance:levels ? 'High · 18–23' : 'High · by feel',cue:'Maximal effort. HR is delayed during short sprints.'},
        between:{kind:'recovery',title:'Recover after effort {i}',untilHrAtMost:t.zoneMax,minSeconds:c.recoverySeconds,hr:`${t.zoneMax} or below`,rpm:'65–80',resistance:levels ? 'Low · 3–5' : 'Low · easy',cue:`Spin easily. Confirm HR is ${t.zoneMax} or below before the next effort.`}},
      {kind:'cooldown',title:'Cool-down',seconds:c.sprintCooldownMinutes*60,hr:'Let it fall',rpm:'Easy',resistance:levels ? 'Easy · 3–5' : 'Easy · low',cue:`${c.sprintCooldownMinutes} minutes easy. Stop any watch recording when you finish.`}
    ];
  }
  const steps = c => c.plan ? c.plan.steps : templateSteps(c);
  const build = input => BikePlans.expand(steps(config(input)));
  /* Active-time span of each effort ridden, from the finished phases. */
  function effortSpans(s, phases = build(s.config)) {
    const spans = []; let at = 0;
    for (const f of s.finishedPhases) { const p = phases[f.id]; if (p?.kind === 'effort') spans.push({effort:p.effort, from:at, to:at + f.ms, outcome:f.outcome, adjust:p.adjust || null}); at += f.ms; }
    return spans;
  }
  /* Resistance for effort k under the plan. The first effort of a rule uses
     the plan's number; each later one starts from the resistance logged for
     the effort before and moves by that effort's cadence flag. */
  function effortTarget(s, k, phases = build(s.config)) {
    const p = phases.find(x => x.kind === 'effort' && x.effort === k);
    if (!p || p.base == null) return null;
    const previous = phases.find(x => x.kind === 'effort' && x.effort === k - 1);
    if (!p.adjust || !previous?.adjust) return p.base;
    const logged = s.efforts?.[k - 2] || {}, last = logged.resistance ?? effortTarget(s, k - 1, phases);
    const change = logged.cadenceFlag === 'high' ? p.adjust.add || 0 : logged.cadenceFlag === 'low' ? -(p.adjust.subtract || 0) : 0;
    return Math.max(0, last + change);
  }
  const FLAGS = ['high', 'ok', 'low'];
  function logEffort(s, k, entry) {
    if (!Number.isInteger(k) || k < 1 || k > 20) return;
    while (s.efforts.length < k) s.efforts.push({resistance:null, cadenceFlag:null});
    const current = s.efforts[k - 1];
    if ('resistance' in entry) current.resistance = Number.isFinite(entry.resistance) && entry.resistance >= 0 && entry.resistance <= 100 ? entry.resistance : null;
    if ('cadenceFlag' in entry) current.cadenceFlag = FLAGS.includes(entry.cadenceFlag) ? entry.cadenceFlag : null;
  }
  const timeOfDay = at => { const h = new Date(at).getHours(); return h < 5 ? 'night' : h < 11 ? 'morning' : h < 14 ? 'midday' : h < 18 ? 'afternoon' : h < 22 ? 'evening' : 'night'; };
  const phase = s => build(s.config)[s.index];
  function create(input, now, id) {
    return {version:VERSION,id,config:config(input),startedAt:now,lastAt:now,status:'running',index:0,phaseMs:0,activeMs:0,mainMs:0,finishedPhases:[],pending:false,hadInterruption:false,pauseReason:'',nextCheckMs:CHECK_MS,settleEndMs:0,steering:'',endedAt:null,hr:HeartRateCore.createStats(config(input).targets),power:PowerCore.createStats(),efforts:[],confirmed:[]};
  }
  function accrue(s,ms) {s.phaseMs+=ms;s.activeMs+=ms;if(phase(s).kind==='main')s.mainMs+=ms;}
  function next(s,outcome='complete') {
    const p=phase(s);s.finishedPhases.push({id:p.id,kind:p.kind,title:p.title,ms:s.phaseMs,outcome});s.index++;s.phaseMs=0;s.pending=false;s.settleEndMs=0;s.steering='';
    if(!phase(s)){s.status='finished';return {type:'finish'};}
    return {type:'phase'};
  }
  function advance(s,now,options={}) {
    if(s.status!=='running')return [];
    const delta=now-s.lastAt;s.lastAt=now;const events=[];
    if(delta<0 || delta>21600000){s.status='paused';s.hadInterruption=true;s.pauseReason='The clock changed or this session has been away for over six hours. Review before continuing; the unconfirmed gap was not counted.';return [{type:'interrupt'}];}
    let p=phase(s);
    if((delta>GAP_MS && s.config.mode==='sprint') || (p.duration!==null && s.phaseMs+delta>=p.duration && (delta>GAP_MS || options.visible===false))) {
      if(s.config.mode==='zone2'){accrue(s,Math.max(0,p.duration-s.phaseMs));s.pending=true;}
      s.status='paused';s.hadInterruption=true;s.pauseReason=s.config.mode==='sprint' ? 'Timing was interrupted. The unconfirmed gap was not counted. Resume when ready to follow this phase.' : 'A phase ended while cues may have been unavailable. Its timer reached the boundary; the next phase has not started. Review and continue when ready.';
      return [{type:'interrupt'}];
    }
    let left=delta;
    while(s.status==='running') {
      p=phase(s);
      if(p.duration===null){accrue(s,left);break;}
      const slice=Math.min(left,Math.max(0,p.duration-s.phaseMs));accrue(s,slice);left-=slice;
      if(s.phaseMs<p.duration)break;
      events.push(next(s));if(s.status==='finished'){s.endedAt=now;break;}
      if(left<=0)break;
    }
    if(s.status==='running' && phase(s).kind==='main') {
      if(s.settleEndMs && s.activeMs>=s.settleEndMs){s.settleEndMs=0;s.steering='One minute has passed. Check HR again.';s.nextCheckMs=s.mainMs+CHECK_MS;events.push({type:'settled'});}
      else if(!s.settleEndMs && s.mainMs>=s.nextCheckMs){s.nextCheckMs=s.mainMs+CHECK_MS;events.push({type:'check'});}
    }
    return events;
  }
  function pause(s,now,reason='Timer paused. If a watch is also recording, pause or stop it too.') {const events=advance(s,now);if(s.status==='running'){s.status='paused';s.pauseReason=reason;}return events;}
  function resume(s,now) {if(s.status!=='paused')return [];s.status='running';s.lastAt=now;s.pauseReason='';return s.pending ? [next(s)] : [];}
  function gate(s,now,confirmed) {const events=advance(s,now),p=phase(s);if(s.status!=='running'||!p?.gate||!confirmed||s.phaseMs<p.min)return events;s.lastAt=now;events.push(next(s));if(s.status==='finished')s.endedAt=now;return events;}
  function skip(s,now) {const index=s.index,events=advance(s,now);if(s.status==='running' && s.index===index){events.push(next(s,'skipped'));if(s.status==='finished')s.endedAt=now;}return events;}
  function end(s,now) {const events=advance(s,now);if(s.status!=='finished'){const p=phase(s);s.finishedPhases.push({id:p.id,kind:p.kind,title:p.title,ms:s.phaseMs,outcome:'ended'});s.status='finished';s.endedAt=now;}return events;}
  function steer(s,now,action) {const events=advance(s,now);if(s.status!=='running'||phase(s).kind!=='main'||(s.settleEndMs&&action!=='high'))return events;s.nextCheckMs=s.mainMs+CHECK_MS;
    if(action==='hold')s.steering='Hold resistance. Keep 80–90 rpm steady.';
    else {s.settleEndMs=s.activeMs+SETTLE_MS;s.steering=action==='high' ? 'Reduce resistance one level. Hold cadence steady.' : 'Add one resistance level. Hold cadence steady.';events.push({type:'adjust',action});}return events;}
  function restore(raw,now) {
    if(!raw||![1,2,VERSION].includes(raw.version)||typeof raw.id!=='string'||!raw.config||!['running','paused'].includes(raw.status)||!Array.isArray(raw.finishedPhases))return null;
    const s=JSON.parse(JSON.stringify(raw));
    // Saved v1 Zone 2 rides included a leading transition. Remove it from active timing.
    if(s.version===1 && s.config.mode==='zone2' && s.config.transition!==false){
      const transitionMs=s.index>0?s.finishedPhases[0]?.ms:s.phaseMs;
      if(!Number.isFinite(transitionMs)||transitionMs<0)return null;
      s.activeMs=Math.max(0,s.activeMs-transitionMs);
      if(s.index>0){s.index--;s.finishedPhases.shift();s.finishedPhases=s.finishedPhases.map((p,id)=>({...p,id}));}
      else{s.phaseMs=0;s.pending=false;}
    }
    s.version=VERSION;s.config=config(s.config);if(s.hr?.targets&&JSON.stringify(BikeTargets.normalize(s.hr.targets))!==JSON.stringify(s.config.targets))return null;s.hr=HeartRateCore.restoreStats(s.hr,s.config.targets);s.power=PowerCore.restoreStats(s.power);
    const logged=Array.isArray(s.efforts)?s.efforts.slice(0,20):[];s.efforts=[];logged.forEach((entry,i)=>logEffort(s,i+1,entry&&typeof entry==='object'?entry:{}));
    s.confirmed=Array.isArray(s.confirmed)?s.confirmed.filter(item=>typeof item==='string').slice(0,10).map(item=>item.slice(0,110)):[];
    for(const key of ['startedAt','lastAt','index','phaseMs','activeMs','mainMs','nextCheckMs','settleEndMs'])if(!Number.isFinite(s[key])||s[key]<0)return null;
    if(!Number.isInteger(s.index)||!phase(s)||s.finishedPhases.length!==s.index)return null;
    if(s.status==='running'){advance(s,now,{visible:false});if(s.status==='running'){s.status='paused';s.pauseReason='Session restored. Elapsed time was recovered using the saved clock. Check your current phase and any watch recording before resuming.';}s.hadInterruption=true;}
    return s;
  }
  function record(s) {
    const phases=build(s.config), complete=s.finishedPhases.length===phases.length && s.finishedPhases.every(p=>p.outcome==='complete');
    // Main-block readings measured over at least 80% of the block fill the readings typed by hand before.
    const analysis=HeartRateCore.analyze(s.hr,s.finishedPhases),metrics=analysis.main?.coverage>=80?{mainAverageHR:String(analysis.main.averageHR)}:{};
    const power=PowerCore.analyze(s.power,s.finishedPhases,s.hr,s.config.targets),main=power?.main;
    if(main?.coverage>=80){metrics.averageWatts=String(main.averageWatts);if(main.cadence!==null)metrics.cadence=String(main.cadence);if(main.fixedHRWatts!==null)metrics.fixedHRWatts=String(main.fixedHRWatts);}
    // Each effort ridden: the resistance and cadence flag logged during the ride, and the bike sensor's readings for its span.
    const efforts=effortSpans(s,phases).map(span=>{const logged=s.efforts?.[span.effort-1]||{},m=PowerCore.effortReadings(s.power,span.from,span.to,span.adjust);
      return {effort:span.effort,outcome:span.outcome,resistance:logged.resistance??null,cadenceFlag:logged.cadenceFlag??m?.flag??null,watts5s:m?.watts5s??null,peakWatts:m?.peakWatts??null,peakCadence:m?.peakCadence??null,wattsSource:m?.watts5s!=null?'sensor':null};});
    return {id:s.id,startedAt:s.startedAt,endedAt:s.endedAt,config:s.config,activeMs:s.activeMs,mainMs:s.mainMs,outcome:complete?'complete':'partial',hadInterruption:s.hadInterruption,effortsCompleted:s.finishedPhases.filter(p=>p.kind==='effort'&&p.outcome==='complete').length,phases:s.finishedPhases,hr:{...HeartRateCore.summary(s.hr,s.activeMs),...analysis},...(power?{power}:{}),metrics,
      ...(efforts.length?{efforts}:{}),conditions:{timeOfDay:timeOfDay(s.startedAt),hoursSinceLifting:null,fed:null,note:'',confirmed:s.confirmed||[]}};
  }
  return {bikeCues,config,templateSteps,build,effortSpans,effortTarget,logEffort,timeOfDay,phase,create,advance,pause,resume,gate,skip,end,steer,restore,record};
})();
