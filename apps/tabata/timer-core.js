/* Absolute elapsed time avoids drift when a browser delays a timer callback. */
/* exported TabataTimer */
const TabataTimer = (() => {
  const defaults={work:60,rest:3,rounds:8,prepare:5,sound:true,keepAwake:true};
  const presetDefaults={workPresets:[60,150,180],restPresets:[3,60,120]};
  function integer(value,label,min,max){
    if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
    return value;
  }
  function config(raw=defaults){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid timer setup.');
    const result={};
    for(const [name,label,min,max] of [['work','Work seconds',1,3600],['rest','Rest seconds',0,3600],['rounds','Rounds',1,99],['prepare','Get-ready seconds',0,60]])result[name]=integer(raw[name]??defaults[name],label,min,max);
    for(const name of ['sound','keepAwake']){
      if(raw[name]!=null&&typeof raw[name]!=='boolean')throw new Error('Invalid '+name+' setting.');
      result[name]=raw[name]??defaults[name];
    }
    return result;
  }
  function duration(c){return (c.prepare+c.rounds*c.work+(c.rounds-1)*c.rest)*1000;}
  function settings(raw={}){
    const result=config(raw);
    for(const [name,min] of [['workPresets',1],['restPresets',0]]){
      const values=raw[name]??presetDefaults[name];
      if(!Array.isArray(values)||values.length!==3)throw new Error('Provide three '+(name==='workPresets'?'work':'rest')+' presets.');
      result[name]=values.map(value=>integer(value,'Preset seconds',min,3600));
    }
    return result;
  }
  function elapsed(session,now){return Math.min(duration(session.config),Math.max(0,session.elapsedMs+(session.status==='running'?Math.max(0,now-session.anchorAt):0)));}
  function snapshot(session,now){
    const c=session.config,ms=elapsed(session,now),total=duration(c);
    if(ms>=total)return {kind:'complete',round:c.rounds,remainingMs:0,elapsedMs:total,totalMs:total,completedRounds:c.rounds,phaseKey:'complete'};
    if(ms<c.prepare*1000)return {kind:'prepare',round:1,remainingMs:c.prepare*1000-ms,elapsedMs:ms,totalMs:total,completedRounds:0,phaseKey:'prepare'};
    const training=ms-c.prepare*1000,cycle=(c.work+c.rest)*1000,round=Math.floor(training/cycle)+1,inCycle=training%cycle;
    const kind=inCycle<c.work*1000?'work':'rest';
    return {kind,round,remainingMs:(kind==='work'?c.work*1000:cycle)-inCycle,elapsedMs:ms,totalMs:total,
      completedRounds:round-1+(kind==='rest'?1:0),phaseKey:kind+'-'+round};
  }
  function start(raw,now,id){return {id,config:config(raw),startedAt:now,elapsedMs:0,anchorAt:now,status:'running'};}
  function pause(session,now){return {...session,elapsedMs:elapsed(session,now),anchorAt:null,status:'paused'};}
  function resume(session,now){return {...session,anchorAt:now,status:'running'};}
  function checkpoint(session,now){return {...session,elapsedMs:elapsed(session,now),anchorAt:session.status==='running'?now:null};}
  function validateSession(raw){
    if(!raw||typeof raw.id!=='string'||!raw.id||raw.id.length>100||!['running','paused'].includes(raw.status))throw new Error('Invalid saved timer.');
    const c=config(raw.config);
    integer(raw.startedAt,'Start time',1,8640000000000000);
    if(!Number.isFinite(raw.elapsedMs)||raw.elapsedMs<0||raw.elapsedMs>duration(c))throw new Error('Invalid elapsed time.');
    if(raw.status==='running')integer(raw.anchorAt,'Timer timestamp',1,8640000000000000);
    return {id:raw.id,config:c,startedAt:raw.startedAt,elapsedMs:raw.elapsedMs,anchorAt:raw.status==='running'?raw.anchorAt:null,status:raw.status};
  }
  return {defaults,settings,config,duration,elapsed,snapshot,start,pause,resume,checkpoint,validateSession};
})();
