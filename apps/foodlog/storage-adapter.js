/* Foodlog uses the shared storage engine with its own schema and namespaces. */
/* exported FoodlogStorage */
const FoodlogStorage = (() => {
  // Version 2 allows entries without a time and days with their own meal order
  // (imported day files). Version 1 apps would refuse such entries, so the
  // version says so up front; version 1 data loads unchanged.
  const namespace='foodlog.v1',key='foodlog.state.v1',VERSION=2;
  const limits={foods:FoodCore.LIMITS.foods,entries:FoodCore.LIMITS.entries};
  function prepare(raw){
    WorkoutStorage.enforceLimits(raw,limits);
    if(raw?.app==='foodlog'&&Number.isSafeInteger(raw.version)&&raw.version>VERSION)throw new Error('This backup is from a newer Foodlog version. Update the app, then try again.');
    if(!raw||raw.app!=='foodlog'||![1,VERSION].includes(raw.version)||!Number.isSafeInteger(raw.updatedAt)||raw.updatedAt<0)throw new Error('Not a valid Foodlog backup.');
    return {app:'foodlog',version:VERSION,updatedAt:raw.updatedAt,...FoodCore.state(raw)};
  }
  function create(options){
    let state,remote;
    const seed=()=>({app:'foodlog',version:VERSION,updatedAt:0,settings:FoodCore.settings(),foods:[],versions:{},entries:[],days:{}});
    const local=WorkoutStorage.createLocal({key,rescueKey:namespace+'.unreadable',seed,prepare,getState:()=>state,setState:value=>{state=value;},
      touch:()=>{state.updatedAt=Math.max(Date.now(),state.updatedAt+1);},onChange:()=>remote?.scheduleRemoteBackup(),onStatus:options.onLocalStatus});
    state=local.load();
    const backup=()=>({...WorkoutStorage.copy(state),kind:'backup',exportedAt:new Date().toISOString()});
    remote=WorkoutStorage.createRemote({namespace,objectKey:'foodlog-backup.json',recoveryKey:namespace+'.before-remote-restore',local,limits,
      get state(){return state;},prepare,validate:prepare,backup,
      revision:raw=>raw.updatedAt||0,dataKey:raw=>{const candidate=prepare(raw);delete candidate.updatedAt;return WorkoutStorage.stableStringify(candidate);},
      setRevision:(candidate,value)=>{candidate.updatedAt=value;},summarizeBackup:raw=>({records:raw.entries.length,recordLabel:'logged items',hasActive:false}),
      hasData:()=>!!(local.existing||state.foods.length||state.entries.length||state.updatedAt),isActive:()=>false,
      toast:options.toast,confirm:options.confirm,onStatus:options.onRemoteStatus,onBusy:options.onBusy,onRefresh:options.onRefresh,onRestore:options.onRestore});
    async function configure(candidate){
      if(!remote.remoteCryptoAvailable())throw new Error('Cloud storage needs HTTPS and Web Crypto.');
      remote.invalidateRemote();remote.validateRemoteConfig(candidate);
      await remote.coordinateRemote(async ctx=>{await remote.readRemoteBackup(candidate,ctx);remote.assertRemote(ctx);remote.saveRemoteConfig(candidate,ctx);},candidate,true);
      options.toast('Read check passed. Backups verify write permission.');remote.remoteStartupSync();
    }
    async function restore(raw){
      const expected=JSON.stringify(state),candidate=prepare(raw);
      if(!await options.confirm('Restore Foodlog backup?','Replace this device’s foods, log and settings? A recovery copy will be kept and cloud sync paused.','Restore backup',true))return false;
      if(expected!==JSON.stringify(state))throw new Error('Data changed during review. Restore cancelled.');
      remote.pauseRemoteSync('Local backup restored');
      candidate.updatedAt=Math.max(Date.now(),state.updatedAt+1,candidate.updatedAt+1);
      return remote.commitSnapshot(candidate);
    }
    return {get state(){return state;},local,remote,backup,configure,restore,save:(remote=true)=>local.save({immediate:true,remote})};
  }
  return {create,prepare};
})();
