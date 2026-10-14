/* exported WorkoutCore */
const WorkoutCore = (() => {
  const VERSION = 3, CHECK_MS = 150000, SETTLE_MS = 60000, GAP_MS = 15000;
  function config(input = {}) {
    const duration=(name,fallback,min,max)=>{const value=input[name]??fallback;if(!Number.isInteger(value)||value<min||value>max)throw new Error(name+' is outside its allowed range.');return value;};
    return {targets:BikeTargets.normalize(input.targets),warmupMinutes:duration('warmupMinutes',5,1,30),mainMinutes:duration('mainMinutes',25,1,180),recoverySeconds:duration('recoverySeconds',60,15,600),sprintCooldownMinutes:duration('sprintCooldownMinutes',5,1,30),settleMinutes:duration('settleMinutes',2,1,15),mode:input.mode === 'sprint' ? 'sprint' : 'zone2',bike:input.bike === 'touchscreen' ? 'touchscreen' : 'matrix',bikeId:String(input.bikeId || '').slice(0,80),context:input.context === 'post-lifting' ? 'post-lifting' : 'fresh',cooldown:duration('cooldown',3,1,30),n:duration('n',5,1,20),eff:duration('eff',30,10,120),voice:input.voice !== false,beeps:input.beeps !== false};
  }
  function build(input) {
    const c = config(input),t=c.targets, matrix = c.bike === 'matrix', p = [];
    const add = (kind,title,duration,hr,rpm,res,cue,extras = {}) => p.push({id:p.length,kind,title,duration,hr,rpm,res,cue,...extras});
    if(c.mode === 'zone2') {
      add('warmup','Warm-up',c.warmupMinutes*60000,`Under ~${t.comparisonHR}`,'80–90',matrix ? 'Easy · 5–7' : 'Easy · low','Start easy and build gradually. Keep breathing comfortable.');
      add('main','Zone 2',c.mainMinutes*60000,`${t.targetMin}–${t.targetMax}`,'80–90',matrix ? 'Start around 8' : 'Start around 6–8',`Zone ${t.zoneMin}–${t.zoneMax} bpm. Ceiling ${t.zoneMax}. Keep cadence steady; adjust resistance only.`);
      add('cooldown','Cool-down',null,`Below ${t.zoneMin}`,'Easy',matrix ? 'Easy · 3–5' : 'Easy · low',`Spin until HR is below ${t.zoneMin}, then stop the Polar recording.`,{target:c.cooldown*60000,min:c.cooldown*60000,gate:'cool'});
    } else {
      add('warmup','Warm-up',c.warmupMinutes*60000,`Under ${t.targetMax}`,'80–90',matrix ? 'Easy · 5–7' : 'Easy · low','Build gradually. Sit upright with a loose grip.');
      add('ready','Primer in',5000,'No target','Pick it up','Add resistance','A short primer is coming.');
      add('primer','Primer',10000,'No target','95–105',matrix ? 'Medium-hard · 12–15' : 'Medium-hard · by feel','About 80 percent for ten seconds.');
      add('settle','Settle',c.settleMinutes*60000,`Under ${t.targetMax}`,'80–90',matrix ? 'Easy · 5–7' : 'Easy · low','Spin easily before the first effort.');
      for(let i=1;i<=c.n;i++) {
        add('ready',`Effort ${i} in`,5000,'No target','Pick it up',matrix ? 'High · 18–23' : 'High · by feel','Resistance up. Stay seated.');
        add('effort',`Effort ${i} of ${c.n}`,c.eff*1000,'Judge by feel','100–115',matrix ? 'High · 18–23' : 'High · by feel','Maximal effort. HR is delayed during short sprints.');
        if(i<c.n) add('recovery',`Recover after effort ${i}`,null,`${t.zoneMax} or below`,'65–80',matrix ? 'Low · 3–5' : 'Low · easy',`Spin easily. Confirm HR is ${t.zoneMax} or below before the next effort.`,{target:c.recoverySeconds*1000,min:c.recoverySeconds*1000,gate:'recovery'});
      }
      add('cooldown','Cool-down',c.sprintCooldownMinutes*60000,'Let it fall','Easy',matrix ? 'Easy · 3–5' : 'Easy · low',`${c.sprintCooldownMinutes} minutes easy. Stop the Polar recording when you finish.`);
    }
    return p;
  }
  const phase = s => build(s.config)[s.index];
  function create(input, now, id) {
    return {version:VERSION,id,config:config(input),startedAt:now,lastAt:now,status:'running',index:0,phaseMs:0,activeMs:0,mainMs:0,finishedPhases:[],pending:false,hadInterruption:false,pauseReason:'',nextCheckMs:CHECK_MS,settleEndMs:0,steering:'',endedAt:null,hr:HeartRateCore.createStats(config(input).targets)};
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
  function pause(s,now,reason='Timer paused. Keep Polar’s recording in mind if you stop riding.') {const events=advance(s,now);if(s.status==='running'){s.status='paused';s.pauseReason=reason;}return events;}
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
    s.version=VERSION;s.config=config(s.config);if(s.hr?.targets&&JSON.stringify(BikeTargets.normalize(s.hr.targets))!==JSON.stringify(s.config.targets))return null;s.hr=HeartRateCore.restoreStats(s.hr,s.config.targets);
    for(const key of ['startedAt','lastAt','index','phaseMs','activeMs','mainMs','nextCheckMs','settleEndMs'])if(!Number.isFinite(s[key])||s[key]<0)return null;
    if(!Number.isInteger(s.index)||!phase(s)||s.finishedPhases.length!==s.index)return null;
    if(s.status==='running'){advance(s,now,{visible:false});if(s.status==='running'){s.status='paused';s.pauseReason='Session restored. Elapsed time was recovered using the saved clock. Check your current phase and Polar recording before resuming.';}s.hadInterruption=true;}
    return s;
  }
  function record(s) {
    const phases=build(s.config), complete=s.finishedPhases.length===phases.length && s.finishedPhases.every(p=>p.outcome==='complete');
    // A main-block HR measured over at least 80% of the block fills the reading typed by hand before.
    const analysis=HeartRateCore.analyze(s.hr,s.finishedPhases),metrics=analysis.main?.coverage>=80?{mainAverageHR:String(analysis.main.averageHR)}:{};
    return {id:s.id,startedAt:s.startedAt,endedAt:s.endedAt,config:s.config,activeMs:s.activeMs,mainMs:s.mainMs,outcome:complete?'complete':'partial',hadInterruption:s.hadInterruption,effortsCompleted:s.finishedPhases.filter(p=>p.kind==='effort'&&p.outcome==='complete').length,phases:s.finishedPhases,hr:{...HeartRateCore.summary(s.hr,s.activeMs),...analysis},metrics};
  }
  return {config,build,phase,create,advance,pause,resume,gate,skip,end,steer,restore,record};
})();
