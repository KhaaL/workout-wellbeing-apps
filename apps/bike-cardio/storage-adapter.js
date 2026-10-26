/* Bike schemas and migration stay here; saving and cloud sync use the engine. */
globalThis.BikeStorage = (() => {
  'use strict';
  const key='bike-cardio.state.v1', namespace='bike-cardio.v1';
  const fields={'bike-cardio.settings.v1':'settings','bike-cardio.history.v1':'history','bike-cardio.active.v1':'active','bike-cardio.presets.v1':'presets','bike-cardio.machines.v1':'machines','bike-cardio.plans.v1':'plans'};
  const comparable=value=>WorkoutStorage.stableStringify(value);
  function create(options){
    const C=options.core, copy=WorkoutStorage.copy;
    const fail=message=>{throw new Error(message);};
    const number=(value,label,min=0,max=Number.MAX_SAFE_INTEGER)=>{
      if(!Number.isFinite(value)||value<min||value>max)fail(label+' must be a finite number in range');
    };
    const timestamp=(value,label)=>{number(value,label);if(!Number.isFinite(new Date(value).getTime()))fail(label+' must be a valid date');};
    function prepare(raw){
      WorkoutStorage.enforceLimits(raw,{history:10000});
      if(!raw||raw.app!=='bike-cardio'||![1,2,3,4,5].includes(raw.version)||raw.kind&&raw.kind!=='backup')fail('Expected a Bike Cardio version 1 to 5 backup');
      if(!Array.isArray(raw.history)||!raw.settings||typeof raw.settings!=='object')fail('Missing session history or settings');
      number(raw.updatedAt,'Backup revision');
      const s=copy(raw),ids=new Set();s.version=BikeHistorySchema.version;s.settings=C.config(s.settings);
      for(const kind of ['presets','machines']){
        const rows=s[kind]??[];if(!Array.isArray(rows)||rows.length>50)fail('Invalid saved '+kind);
        const seen=new Set();s[kind]=rows.map(row=>{
          if(!row||typeof row.id!=='string'||!row.id.trim()||seen.has(row.id)||typeof row.name!=='string'||!row.name.trim()||row.name.length>80)fail('Invalid saved '+kind);
          seen.add(row.id);
          if(kind==='presets'){if(!row.config||typeof row.config!=='object')fail('Invalid preset configuration');return {id:row.id,name:row.name.trim(),config:C.config(row.config)};}
          if(typeof row.bike!=='string'||raw.version>=4&&!['levels','feel'].includes(row.bike)||typeof row.bikeId!=='string'||!row.bikeId.trim()||row.bikeId.length>80)fail('Invalid machine profile');
          return {id:row.id,name:row.name.trim(),bike:C.bikeCues(row.bike),bikeId:row.bikeId.trim()};
        });
      }
      // Planned sessions (version 5); older backups start with none.
      const plans=s.plans??[],planIds=new Set();if(!Array.isArray(plans)||plans.length>50)fail('Invalid planned sessions');
      s.plans=plans.map(plan=>{let normalized;try{normalized=BikePlans.normalize(plan);}catch(error){fail('Invalid planned session: '+error.message);}if(planIds.has(normalized.id))fail('Planned session IDs must be unique');planIds.add(normalized.id);return normalized;});
      const optional=(value,label,min,max)=>{if(value!=null)number(value,label,min,max);};
      for(const r of s.history){
        if(!r||typeof r.id!=='string'||!r.id.trim()||ids.has(r.id))fail('Session IDs must be present and unique');ids.add(r.id);
        timestamp(r.startedAt,'Session date');if(r.endedAt!=null)timestamp(r.endedAt,'Session end');
        number(r.activeMs,'Active time');number(r.mainMs,'Main-block time',0,r.activeMs);
        r.config=BikeHistorySchema.config(r.config,raw.version);
        if(!['complete','partial'].includes(r.outcome))fail('Invalid session outcome');
        if(!Number.isInteger(r.effortsCompleted)||r.effortsCompleted<0||r.effortsCompleted>r.config.n)fail('Invalid completed efforts');
        if(!r.metrics||typeof r.metrics!=='object'||Array.isArray(r.metrics))fail('Invalid session readings');
        for(const [name,min,max]of [['averageHR',1,300],['mainAverageHR',1,300],['zoneMinutes',0,Number.MAX_SAFE_INTEGER],['cadence',0,250],['averageWatts',0,2500],['fixedHRWatts',0,2500],['perceivedEffort',1,10]]){
          const v=r.metrics[name];if(v!=null&&v!==''){if(!['number','string'].includes(typeof v))fail('Invalid '+name);number(Number(v),name,min,max);}
        }
        if(r.metrics.perceivedEffort!=null&&r.metrics.perceivedEffort!==''&&!Number.isInteger(Number(r.metrics.perceivedEffort)))fail('Perceived effort must be a whole number.');
        for(const [name,max]of [['resistance',80],['notes',2000]])if(r.metrics[name]!=null&&(typeof r.metrics[name]!=='string'||r.metrics[name].length>max))fail('Invalid '+name);
        BikeHistorySchema.validateExternal(r.metrics);
        if(r.phases!=null){
          if(!Array.isArray(r.phases))fail('Invalid session phases');
          for(const p of r.phases){if(!p||typeof p.title!=='string'||typeof p.kind!=='string'||!['complete','skipped','ended'].includes(p.outcome))fail('Invalid phase');number(p.ms,'Phase time');}
        }
        if(r.hr!=null){
          if(r.hr.source!=null&&(typeof r.hr.source!=='string'||r.hr.source.length>500))fail('Invalid HR source');
          const measuredTargets=C.config({targets:r.hr.targets||r.config.targets}).targets;
          if(comparable(measuredTargets)!==comparable(r.config.targets))fail('Measured HR targets do not match the ride configuration');
          r.hr.targets=measuredTargets;
          if(r.hr.averageHR!=null)number(r.hr.averageHR,'Measured HR',1,300);
          for(const name of ['zoneMs','measuredMs','samples','coverage'])number(r.hr[name],'Measured '+name);
          if(r.hr.zoneMs>r.hr.measuredMs||r.hr.coverage>100)fail('Invalid HR coverage');
          if(r.hr.trace!=null&&(typeof r.hr.trace!=='object'||r.hr.trace.binSeconds!==5||!BikeTrace.decode(r.hr.trace.bpm,1,300)))fail('Invalid HR trace');
          if(r.hr.main!=null){if(typeof r.hr.main!=='object')fail('Invalid main-block HR');number(r.hr.main.averageHR,'Main-block HR',1,300);number(r.hr.main.coverage,'Main-block HR coverage',0,100);if(r.hr.main.driftPct!=null)number(r.hr.main.driftPct,'HR drift',-100,100);}
          if(r.hr.recovery60!=null){if(!Array.isArray(r.hr.recovery60)||r.hr.recovery60.length>21)fail('Invalid HR recovery');for(const n of r.hr.recovery60)if(n!==null)number(n,'HR recovery',-300,300);}
        }
        if(r.efforts!=null){
          if(!Array.isArray(r.efforts)||r.efforts.length>20)fail('Invalid efforts');
          for(const e of r.efforts){
            if(!e||typeof e!=='object'||!Number.isInteger(e.effort)||e.effort<1||e.effort>20||!['complete','skipped','ended'].includes(e.outcome))fail('Invalid effort');
            optional(e.resistance,'Effort resistance',0,100);optional(e.watts5s,'Effort watts',0,2500);optional(e.peakWatts,'Effort peak watts',0,2500);optional(e.peakCadence,'Effort cadence',0,250);
            if(e.cadenceFlag!=null&&!['high','ok','low'].includes(e.cadenceFlag))fail('Invalid effort cadence flag');
            if(e.wattsSource!=null&&!['sensor','manual'].includes(e.wattsSource))fail('Invalid effort watts source');
          }
        }
        if(r.conditions!=null){
          const c=r.conditions;if(typeof c!=='object'||Array.isArray(c))fail('Invalid ride conditions');
          if(c.timeOfDay!=null&&!['morning','midday','afternoon','evening','night'].includes(c.timeOfDay))fail('Invalid time of day');
          optional(c.hoursSinceLifting,'Hours since lifting',0,2000);
          if(c.fed!=null&&!['fed','fasted'].includes(c.fed))fail('Invalid fed state');
          if(c.note!=null&&(typeof c.note!=='string'||c.note.length>500))fail('Invalid conditions note');
          if(c.confirmed!=null&&(!Array.isArray(c.confirmed)||c.confirmed.length>10||c.confirmed.some(item=>typeof item!=='string'||item.length>110)))fail('Invalid confirmed conditions');
        }
        if(r.baseline!=null&&typeof r.baseline!=='boolean')fail('Invalid baseline flag');
        if(r.power!=null){
          const p=r.power;if(typeof p!=='object'||Array.isArray(p))fail('Invalid measured power');
          if(p.source!=null&&(typeof p.source!=='string'||p.source.length>500))fail('Invalid power source');
          number(p.measuredMs,'Measured power time');number(p.coverage,'Power coverage',0,100);
          for(const name of ['averageWatts','peak5sWatts'])if(p[name]!=null)number(p[name],'Measured '+name,0,2500);
          if(p.trace!=null&&(typeof p.trace!=='object'||p.trace.binSeconds!==5||!BikeTrace.decode(p.trace.watts??'',0,2500)||!BikeTrace.decode(p.trace.rpm??'',0,250)))fail('Invalid power trace');
          if(p.main!=null){if(typeof p.main!=='object')fail('Invalid main-block power');number(p.main.averageWatts,'Main-block power',0,2500);number(p.main.coverage,'Main-block power coverage',0,100);
            if(p.main.cadence!=null)number(p.main.cadence,'Main-block cadence',0,250);if(p.main.decouplingPct!=null)number(p.main.decouplingPct,'Aerobic decoupling',-100,100);if(p.main.fixedHRWatts!=null)number(p.main.fixedHRWatts,'Watts at comparison HR',0,2500);}
        }
      }
      // Finishing saves the log before clearing the active ride. A crash
      // between those writes must not make an otherwise valid log unreadable.
      if(s.active!=null){if(ids.has(s.active.id))s.active=null;else if(!C.restore(s.active,Date.now()))fail('Invalid active session');}
      delete s.kind;delete s.exportedAt;return s;
    }
    const seed=()=>({app:'bike-cardio',version:BikeHistorySchema.version,updatedAt:0,settings:C.config(),history:[],active:null,presets:[],machines:[],plans:[]});
    function legacy(){
      // Separate keys predate version 4: read them as version 3, so their model codes map to cue styles.
      const s={...seed(),version:3};let found=false;
      for(const [old,name]of Object.entries(fields)){
        const raw=localStorage.getItem(old);if(raw!=null){found=true;s[name]=JSON.parse(raw);}
      }
      // Legacy data has no trustworthy whole-log revision. Keep it undated so
      // cloud reconciliation requires an explicit choice when copies differ.
      return found?s:null;
    }
    let state, remote;
    const local=WorkoutStorage.createLocal({key,rescueKey:namespace+'.unreadable',seed,legacy,prepare,
      cacheKeys:['history','settings'],
      getState:()=>state,setState:value=>{state=value;},
      touch:()=>{state.updatedAt=Math.max(Date.now(),state.updatedAt+1);},
      onChange:()=>remote?.scheduleRemoteBackup(),onStatus:options.onLocalStatus});
    state=local.load();
    const backup=()=>({...copy(state),kind:'backup',exportedAt:new Date().toISOString()});
    const dataKey=raw=>{const s=prepare(raw);delete s.updatedAt;return comparable(s);};
    const isActive=()=>Boolean(state.active||options.isActive?.());
    remote=WorkoutStorage.createRemote({namespace,objectKey:'bike-cardio-backup.json',recoveryKey:namespace+'.before-remote-restore',
      local,limits:{history:10000},get state(){return state;},prepare,validate:prepare,backup,
      summarizeBackup:raw=>({records:raw.history.length,recordLabel:'rides',hasActive:!!raw.active}),
      hasData:()=>!!(local.existing||state.history.length||state.active),revision:raw=>raw?.updatedAt||0,dataKey,setRevision:(obj,value)=>{obj.updatedAt=value;},isActive,
      onStatus:options.onRemoteStatus,onBusy:options.onBusy,toast:options.toast,confirm:options.confirm,
      onRefresh:options.onRefresh,onRestore:()=>options.onRestore(state)});
    function get(old,fallback){const name=fields[old];if(!name)throw new Error('Unknown storage key');return state[name]??fallback;}
    function write(old,value,options={}){
      const name=fields[old];if(!name)throw new Error('Unknown storage key');
      if(options.atomic){if(JSON.stringify(state[name])===JSON.stringify(value))return !local.failed;const candidate={...state,[name]:value,updatedAt:Math.max(Date.now(),state.updatedAt+1)};if(!local.commit(candidate))return false;remote.scheduleRemoteBackup();return true;}
      if(name==='settings'&&JSON.stringify(state.settings)===JSON.stringify(value))return !local.failed;
      state[name]=value;return local.save({immediate:options.immediate!==false,changed:[name],remote:options.remote!==false});
    }
    async function restore(raw){
      if(isActive())throw new Error('Finish or end the saved session before restoring a backup.');
      const expected=JSON.stringify(state),candidate=prepare(raw);
      remote.pauseRemoteSync('Local restore in progress',{code:'import'});
      if(!await options.confirm('Restore backup?','This replaces the local session log. A recovery copy will be kept. Cloud sync stays paused until you choose which copy to keep.','Restore backup',true))return false;
      if(expected!==JSON.stringify(state))throw new Error('Local data changed during review. Restore cancelled.');
      if(isActive())throw new Error('A session started during review. Restore cancelled.');
      candidate.updatedAt=Math.max(Date.now(),state.updatedAt+1,candidate.updatedAt+1);
      if(!remote.commitSnapshot(candidate))throw new Error('Restore could not be saved. Previous data retained.');
      remote.scheduleRemoteBackup();return true;
    }
    function fileBackupAt(){try{return Number(localStorage.getItem(namespace+'.last-file-backup'))||null;}catch(error){return null;}}
    function backupInfo(){
      const file=fileBackupAt()||0;
      const cloud=Number(remote.loadRemoteConfig()?.lastBackupAt)||0,at=Math.max(file,cloud);
      const rides=state.history.filter(ride=>(ride.editedAt||ride.endedAt||ride.startedAt)>at).length;
      return {fileAt:file||null,at:at||null,where:at?(cloud>=file?'cloud storage':'a downloaded file'):null,rides,
        stale:at?rides>=3||Date.now()-at>=14*86400000:state.history.length>0};
    }
    function recordFileBackup(){
      // Device-only metadata must never change the workout revision or enter sync.
      try{localStorage.setItem(namespace+'.last-file-backup',String(Date.now()));return true;}
      catch(error){return false;}
    }
    const historyPayload=()=>({app:'bike-cardio',kind:'history',version:BikeHistorySchema.version,exportedAt:new Date().toISOString(),history:copy(state.history)});
    async function mergeHistory(raw){
      WorkoutStorage.enforceLimits(raw,{history:10000});
      if(!raw||raw.app!=='bike-cardio'||![1,2,3,4,5].includes(raw.version)||!['history','backup'].includes(raw.kind)||!Array.isArray(raw.history))fail('Expected Bike Cardio history or a full backup.');
      const expected=JSON.stringify(state),history=copy(state.history),existing=new Map(history.map(ride=>[ride.id,ride]));
      const summary={added:0,already:0,invalid:0,conflicts:0};
      for(const item of raw.history){
        let ride;try{ride=prepare({...seed(),version:raw.version,history:[item]}).history[0];}catch(error){summary.invalid++;continue;}
        const current=existing.get(ride.id);
        if(state.active?.id===ride.id){summary.conflicts++;continue;}
        if(current){
          let same=false;try{same=comparable(prepare({...seed(),history:[current]}).history[0])===comparable(ride);}catch(error){}
          summary[same?'already':'conflicts']++;continue;
        }
        history.push(ride);existing.set(ride.id,ride);summary.added++;
      }
      if(!summary.added)return summary;
      history.sort((a,b)=>b.startedAt-a.startedAt);
      const candidate=prepare({...copy(state),history,updatedAt:Math.max(Date.now(),state.updatedAt+1)});
      if(!await options.confirm('Merge ride history?',`${summary.added} new rides will be added. Existing rides, settings and any saved ride are kept. ${summary.conflicts} conflicts will keep the local copy. Cloud sync will be paused for review.`,'Merge history'))return null;
      if(expected!==JSON.stringify(state))fail('Local data changed during review. Import cancelled.');
      remote.pauseRemoteSync('History import needs cloud review',{code:'history-import'});
      if(!local.commit(candidate,{key:namespace+'.before-remote-restore',payload:backup()}))fail('History import could not be saved. Previous data retained.');
      remote.scheduleRemoteBackup();return summary;
    }
    async function clearHistory(){
      if(isActive())fail('Finish or end the saved session before clearing history.');
      if(!state.history.length)return false;
      const expected=JSON.stringify(state);
      if(!await options.confirm('Clear ride history?','All finished rides will be removed from this device. Settings and cloud credentials are kept. A recovery copy is saved and cloud sync stays paused for review.','Clear history',true))return false;
      if(expected!==JSON.stringify(state)||isActive())fail('Local data changed during review. Clear cancelled.');
      remote.pauseRemoteSync('History cleared locally — review before updating cloud',{code:'clear'});
      if(!remote.commitSnapshot({...copy(state),history:[],updatedAt:Math.max(Date.now(),state.updatedAt+1)}))fail('History could not be cleared. Previous data retained.');
      remote.scheduleRemoteBackup();return true;
    }
    function recoveryCopies(){
      const result=[];
      for(const [kind,label]of [['unreadable','Unreadable saved data'],['before-remote-restore','Before the last replacement']]){
        try{
          const storageKey=namespace+'.'+kind,raw=localStorage.getItem(storageKey);if(raw==null)continue;
          let restorable=false;try{prepare(JSON.parse(raw));restorable=true;}catch(error){}
          result.push({kind,label,key:storageKey,raw,restorable});
        }catch(error){}
      }
      if(local.blocked&&!result.some(item=>item.kind==='unreadable')){
        try{
          const entries=Object.fromEntries(Object.keys(fields).map(name=>[name,localStorage.getItem(name)]).filter(([,raw])=>raw!=null));
          if(Object.keys(entries).length)result.push({kind:'legacy',label:'Original data before migration',raw:JSON.stringify({app:'bike-cardio',kind:'legacy-recovery',entries}),restorable:false});
        }catch(error){}
      }
      return result;
    }
    async function discardRecovery(kind){
      const saved=recoveryCopies().find(item=>item.kind===kind);if(!saved?.key)fail('This recovery copy cannot be discarded here.');
      if(!await options.confirm('Discard recovery copy?','Only this saved recovery copy is removed. Download it first if you want to keep it.'))return false;
      if(localStorage.getItem(saved.key)!==saved.raw)fail('Recovery copy changed during review. Nothing discarded.');
      localStorage.removeItem(saved.key);return true;
    }
    const handoff=WorkoutStorage.createHandoff({namespace,app:'bike-cardio',activeKey:'active',getState:()=>state,remote,local,backup,prepare,
      pause:options.pauseForHandoff||(()=>{state.active=C.restore(state.active,Date.now());local.save({immediate:true,changed:['active'],remote:false});}),
      isPaused:workout=>workout.status==='paused',
      makeCandidate:incoming=>{if(state.history.some(ride=>ride.id===incoming.active.id))fail('This workout is already in the receiving history.');return prepare({...copy(state),active:C.restore(incoming.active,Date.now())});},
      setRevision:candidate=>{candidate.updatedAt=Math.max(Date.now(),state.updatedAt+1);},
      describe:workout=>`${workout.config.plan?.name||(workout.config.mode==='zone2'?'Zone 2':'Sprint')} workout: ${Math.round(workout.activeMs/60000)} active minutes, paused at ${C.phase(workout).title}.`,
      confirm:options.confirm,onChange:options.onHandoffChange,onReceived:options.onHandoffReceived,notify:options.toast});
    return {get,write,local,remote,handoff,prepare,backup,restore,backupInfo,fileBackupAt,recordFileBackup,
      historyPayload,mergeHistory,clearHistory,recoveryCopies,discardRecovery,get state(){return state;},
      recovery:()=>{try{
        const saved=localStorage.getItem(namespace+'.unreadable')||localStorage.getItem(namespace+'.before-remote-restore');if(saved)return saved;
        if(local.blocked){const entries=Object.fromEntries(Object.keys(fields).map(name=>[name,localStorage.getItem(name)]).filter(([,raw])=>raw!=null));if(Object.keys(entries).length)return JSON.stringify({app:'bike-cardio',kind:'legacy-recovery',entries});}
        return null;
      }catch(error){return null;}}};
  }
  return {create};
})();
