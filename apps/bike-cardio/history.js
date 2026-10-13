/* App-specific history interpretation, independent of storage and the DOM. */
/* exported BikeHistory */
const BikeHistory = (() => {
  const metrics={fixedHRWatts:{label:'Watts at recorded comparison HR',unit:'W'},averageWatts:{label:'Main-block average watts',unit:'W'},mainAverageHR:{label:'Main-block average heart rate',unit:'bpm'},mainMinutes:{label:'Main-block duration',unit:'min'},coverage:{label:'H10 measurement coverage',unit:'%'}};
  const machineKey=ride=>JSON.stringify([ride.config.bike,ride.config.bikeId||'']);
  function seriesKey(ride){
    const c=WorkoutCore.config(ride.config);
    return JSON.stringify([machineKey(ride),c.context,c.mode,c.targets,c.warmupMinutes,c.mainMinutes,c.cooldown,c.sprintCooldownMinutes,c.recoverySeconds,c.settleMinutes,...(c.mode==='sprint'?[c.n,c.eff]:[])]);
  }
  function filter(rides,query={}){
    const from=query.from?new Date(query.from+'T00:00:00').getTime():-Infinity;
    const until=query.to?new Date(query.to+'T00:00:00'):null;if(until)until.setDate(until.getDate()+1);
    return rides.filter(r=>(!query.machine||machineKey(r)===query.machine)&&(!query.context||r.config.context===query.context)&&(!query.mode||r.config.mode===query.mode)&&(!query.outcome||r.outcome===query.outcome)&&(!query.uninterrupted||!r.hadInterruption)&&r.startedAt>=from&&r.startedAt<(until?until.getTime():Infinity)).sort((a,b)=>b.startedAt-a.startedAt||a.id.localeCompare(b.id));
  }
  function value(ride,metric){
    const raw=metric==='coverage'?ride.hr?.coverage:metric==='mainMinutes'?(ride.config.mode==='zone2'?ride.mainMs/60000:null):ride.metrics?.[metric];
    if(raw===null||raw===undefined||raw==='')return null;
    const number=Number(raw);return Number.isFinite(number)?number:null;
  }
  function series(rides,metric){
    if(!metrics[metric])throw new Error('Unknown progress measure');
    const groups=new Map();
    for(const r of [...rides].sort((a,b)=>a.startedAt-b.startedAt||a.id.localeCompare(b.id))){
      const key=seriesKey(r);if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push({ride:r,at:r.startedAt,value:value(r,metric)});
    }
    return [...groups.values()];
  }
  function compare(first,second){
    const [before,after]=[first,second].sort((a,b)=>a.startedAt-b.startedAt||a.id.localeCompare(b.id));
    const comparable=seriesKey(before)===seriesKey(after),warnings=[];
    if(!comparable)warnings.push('Different machines, contexts, targets or plans: values are shown side by side, but progress differences are withheld.');
    if(before.hadInterruption||after.hadInterruption||before.outcome!=='complete'||after.outcome!=='complete')warnings.push('An interrupted or incomplete ride is included. Review timing before interpreting differences.');
    const number=raw=>raw==null||raw===''||!Number.isFinite(Number(raw))?null:Number(raw);
    const rows=[
      ['Main-block watts','W',r=>number(r.metrics?.averageWatts)],['Main-block HR','bpm',r=>number(r.metrics?.mainAverageHR)],
      ['Watts at recorded comparison HR','W',r=>number(r.metrics?.fixedHRWatts)],['H10 average HR','bpm',r=>number(r.hr?.averageHR)],
      ['H10 coverage','%',r=>number(r.hr?.coverage)],['Active duration','min',r=>r.activeMs/60000],['Main-block duration','min',r=>r.mainMs/60000],
      ['Perceived effort','1–10',r=>number(r.metrics?.perceivedEffort)]
    ].map(([label,unit,read])=>{const a=read(before),b=read(after);return {label,unit,before:a,after:b,delta:comparable&&a!==null&&b!==null?b-a:null};});
    warnings.push('Review heart rate and measurement coverage alongside watts. A higher output alone does not establish improved fitness.');
    const context=ride=>{const c=WorkoutCore.config(ride.config);return (c.context==='post-lifting'?'After lifting':'Fresh legs')+' · Zone 2 '+c.targets.zoneMin+'–'+c.targets.zoneMax+' bpm · comparison HR '+c.targets.comparisonHR+' bpm';};
    return {before,after,rows,warnings,details:['Earlier: '+context(before),'Later: '+context(after)]};
  }
  return {metrics,machineKey,seriesKey,filter,value,series,compare};
})();
