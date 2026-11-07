/* Absolute elapsed time avoids drift when a browser delays a timer callback. */
/* exported TabataTimer */
const TabataTimer = (() => {
  const defaults={work:60,rest:3,rounds:8,prepare:5,sound:true,keepAwake:true};
  const presetDefaults={workPresets:[60,150,180],restPresets:[3,60,120]};
  // A pyramid is a list of swap calls: partners alternate, so one partner's turn is the other's rest.
  const pyramidDefault=[30,30,45,45,60,60,45,45,30,30],PYRAMID_MIN=2,PYRAMID_MAX=40;
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
    const mode=raw.mode??'intervals';
    if(!['intervals','pyramid'].includes(mode))throw new Error('Invalid timer mode.');
    result.mode=mode;
    // Interval sessions carry no ladder, so their history rows stay unchanged.
    if(mode==='pyramid'){result.ladder=ladder(raw.ladder??pyramidDefault);result.ladderRest=integer(raw.ladderRest??0,'Rest between calls',0,3600);}
    return result;
  }
  function ladder(values){
    if(!Array.isArray(values)||values.length<PYRAMID_MIN||values.length>PYRAMID_MAX)throw new Error(`Enter ${PYRAMID_MIN} to ${PYRAMID_MAX} swap calls.`);
    return values.map(value=>integer(value,'Each swap call',1,3600));
  }
  // Accepts "30, 30, 45"; spaces around or instead of commas are tolerated.
  function parseLadder(text){
    const parts=String(text).split(/[\s,]+/).filter(Boolean);
    if(parts.some(part=>!/^\d+$/.test(part)))throw new Error('Swap calls are whole seconds separated by commas.');
    return ladder(parts.map(Number));
  }
  function sum(values){return values.reduce((total,value)=>total+value,0);}
  function duration(c){return (c.prepare+(c.mode==='pyramid'?sum(c.ladder)+(c.ladder.length-1)*c.ladderRest:c.rounds*c.work+(c.rounds-1)*c.rest))*1000;}
  // Number of intervals a finished or ended session reports: rounds, or swap calls in a pyramid.
  function intervals(c){return c.mode==='pyramid'?c.ladder.length:c.rounds;}
  function settings(raw={}){
    const result=config(raw);
    // The setup remembers its last ladder while the timer is in interval mode.
    result.ladder=result.ladder??ladder(raw.ladder??pyramidDefault);
    result.ladderRest=result.ladderRest??integer(raw.ladderRest??0,'Rest between calls',0,3600);
    for(const [name,min] of [['workPresets',1],['restPresets',0]]){
      const values=raw[name]??presetDefaults[name];
      if(!Array.isArray(values)||values.length!==3)throw new Error('Provide three '+(name==='workPresets'?'work':'rest')+' presets.');
      result[name]=values.map(value=>integer(value,'Preset seconds',min,3600));
    }
    // Markdown shown by the run screen's Instructions button; the running plan never copies it.
    const instructions=raw.instructions??'';
    if(typeof instructions!=='string'||instructions.length>WorkoutMarkdown.MAX_LENGTH)throw new Error('Instructions must be text of at most '+WorkoutMarkdown.MAX_LENGTH.toLocaleString('en')+' characters.');
    result.instructions=instructions;
    return result;
  }
  function elapsed(session,now){return Math.min(duration(session.config),Math.max(0,session.elapsedMs+(session.status==='running'?Math.max(0,now-session.anchorAt):0)));}
  function snapshot(session,now){
    const c=session.config,ms=elapsed(session,now),total=duration(c);
    if(ms>=total)return {kind:'complete',round:intervals(c),remainingMs:0,elapsedMs:total,totalMs:total,completedRounds:intervals(c),phaseKey:'complete'};
    if(ms<c.prepare*1000)return {kind:'prepare',round:1,remainingMs:c.prepare*1000-ms,elapsedMs:ms,totalMs:total,completedRounds:0,phaseKey:'prepare'};
    if(c.mode==='pyramid'){
      // Every swap call is a work interval for one partner: A takes odd calls, B even calls.
      // An optional rest follows each call except the last; both partners rest.
      let left=ms-c.prepare*1000,index=0;
      const partner=i=>i%2?'B':'A',base={elapsedMs:ms,totalMs:total};
      for(;;){
        const call=c.ladder[index]*1000,nextMs=index+1<c.ladder.length?c.ladder[index+1]*1000:0;
        if(left<call)return {...base,kind:'work',partner:partner(index),nextPartner:partner(index+1),round:index+1,intervalMs:call,nextMs,
          remainingMs:call-left,completedRounds:index,phaseKey:'work-'+(index+1)};
        left-=call;
        if(left<c.ladderRest*1000)return {...base,kind:'rest',nextPartner:partner(index+1),round:index+1,intervalMs:c.ladderRest*1000,nextMs,
          remainingMs:c.ladderRest*1000-left,completedRounds:index+1,phaseKey:'rest-'+(index+1)};
        left-=c.ladderRest*1000;index++;
      }
    }
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
  return {defaults,pyramidDefault,settings,config,parseLadder,intervals,duration,elapsed,snapshot,start,pause,resume,checkpoint,validateSession};
})();
