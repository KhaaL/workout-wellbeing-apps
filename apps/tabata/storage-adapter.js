/* Tabata uses the same storage engine with its own schema and namespaces. */
/* exported TabataStorage */
const TabataStorage = (() => {
  const namespace='tabata.v1',key='tabata.state.v1';
  // Version 2 adds settings.instructions. Version 1 apps rebuild settings from the
  // fields they know and would drop the text, so they refuse version 2 data.
  const VERSION=2;
  function prepare(raw){
    WorkoutStorage.enforceLimits(raw,{history:10000});
    if(raw?.app==='tabata'&&Number.isSafeInteger(raw.version)&&raw.version>VERSION)throw new Error('This backup is from a newer Tabata version. Update the app, then try again.');
    if(!raw||raw.app!=='tabata'||![1,VERSION].includes(raw.version)||!Array.isArray(raw.history)||!Number.isSafeInteger(raw.updatedAt)||raw.updatedAt<0)throw new Error('Not a valid Tabata backup.');
    const ids=new Set();
    const history=raw.history.map(row=>{
      if(!row||typeof row.id!=='string'||!row.id||row.id.length>100||ids.has(row.id)||!['complete','ended'].includes(row.outcome))throw new Error('Invalid Tabata history.');
      ids.add(row.id);
      const config=TabataTimer.config(row.config);
      if(!Number.isSafeInteger(row.startedAt)||row.startedAt<1||row.startedAt>8640000000000000||!Number.isFinite(row.elapsedMs)||row.elapsedMs<0||row.elapsedMs>TabataTimer.duration(config))throw new Error('Invalid session timing.');
      if(row.outcome==='complete'&&row.elapsedMs!==TabataTimer.duration(config))throw new Error('Invalid completed session.');
      return {id:row.id,config,startedAt:row.startedAt,elapsedMs:row.elapsedMs,outcome:row.outcome};
    });
    const active=raw.active==null?null:TabataTimer.validateSession(raw.active);
    if(active&&ids.has(active.id))throw new Error('Saved timer is already in history.');
    return {app:'tabata',version:VERSION,updatedAt:raw.updatedAt,settings:TabataTimer.settings(raw.settings),history,active};
  }
  function create(options){
    let state,remote;
    const seed=()=>({app:'tabata',version:VERSION,updatedAt:0,settings:TabataTimer.settings(),history:[],active:null});
    const local=WorkoutStorage.createLocal({key,rescueKey:namespace+'.unreadable',seed,prepare,getState:()=>state,setState:value=>{state=value;},
      touch:()=>{state.updatedAt=Math.max(Date.now(),state.updatedAt+1);},onChange:()=>remote?.scheduleRemoteBackup(),onStatus:options.onLocalStatus});
    state=local.load();
    // Reopening always requires an explicit Resume, at the last saved checkpoint.
    if(state.active)state.active={...state.active,anchorAt:null,status:'paused'};
    const backup=()=>({...WorkoutStorage.copy(state),kind:'backup',exportedAt:new Date().toISOString()});
    remote=WorkoutStorage.createRemote({namespace,objectKey:'tabata-backup.json',recoveryKey:namespace+'.before-remote-restore',local,limits:{history:10000},
      get state(){return state;},prepare,validate:prepare,backup,
      revision:raw=>raw.updatedAt||0,dataKey:raw=>{const candidate=prepare(raw);delete candidate.updatedAt;return WorkoutStorage.stableStringify(candidate);},
      setRevision:(candidate,value)=>{candidate.updatedAt=value;},summarizeBackup:raw=>({records:raw.history.length,recordLabel:'sessions',hasActive:!!raw.active}),
      isPristine:s=>!s.updatedAt&&!s.history.length&&!s.active,isActive:()=>!!state.active,onBrowse:options.onBrowse,
      toast:options.toast,confirm:options.confirm,onStatus:options.onRemoteStatus,onBusy:options.onBusy,onRefresh:options.onRefresh,
      onRestore:()=>{if(state.active)state.active={...state.active,anchorAt:null,status:'paused'};options.onRestore();}});
    async function restore(raw){
      if(state.active)throw new Error('Finish or end the saved timer before restoring.');
      const expected=JSON.stringify(state),candidate=prepare(raw);
      if(!await options.confirm('Restore Tabata backup?','Replace this device’s settings and history? A recovery copy will be kept and cloud sync paused.','Restore backup',true))return false;
      if(state.active||expected!==JSON.stringify(state))throw new Error('Data changed during review. Restore cancelled.');
      remote.pauseRemoteSync('Local backup restored',{code:'import'});
      candidate.updatedAt=Math.max(Date.now(),state.updatedAt+1,candidate.updatedAt+1);
      return remote.commitSnapshot(candidate);
    }
    return {get state(){return state;},local,remote,backup,restore,save:(remote=true)=>local.save({immediate:true,remote})};
  }
  return {create,prepare};
})();
