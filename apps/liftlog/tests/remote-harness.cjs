const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = [...fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]).join('\n');
// Run the shipped closure, with only presentation replaced. State, validation,
// migrations, signer, stream bounds, coordinator and persistence remain real.
function device(storage = new Map()) {
  const timers = new Map(); let tid = 0;
  const node = new Proxy(function(){}, {get:(_,k) => k === 'querySelectorAll' ? () => [] : k === 'then' ? undefined : node, apply:() => node, set:() => true});
  const ctx = { console, URL, TextEncoder, TextDecoder, AbortController, Headers, Response, ReadableStream, Blob,
    crypto:webcrypto, navigator:{onLine:true}, location:{protocol:'https:',hostname:'liftlog.test'},
    document:node, localStorage:{getItem:k=>storage.get(k) ?? null, setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    setTimeout:(fn,delay)=>{timers.set(++tid,{fn,delay}); return tid;},clearTimeout:id=>timers.delete(id),setInterval:()=>0,
    fetch:async()=>{throw Error('Unexpected network call');}, requestAnimationFrame:()=>0 };
  ctx.window=ctx; ctx.addEventListener=()=>{};
  vm.createContext(ctx);
  const seam = `
    render=()=>{}; applyTheme=()=>{}; drawTimer=()=>{}; cancelRestBeep=()=>{}; restoreTimer=()=>{};
    toast=(text)=>messages.push(text); announce=()=>{}; updateSaveBanner=()=>{};
    confirmDlg=async()=>true; dialog=async()=>true;
    window.api={workoutHandoff,localStore,remoteEngine,beginWorkout,newWorkout, pauseTimer, timer, LiftlogComparisons,workoutVolume,workoutDuration,sameProgressionContract,canonicalExerciseId,setWeight,addedSetWeight,save,flushSave,clearWorkoutData,prepareBackup,backupPayload,backupDataKey,remoteStartupSync,autoRemoteBackup,remoteBackup,remoteRestore,remotePublishLocal,remoteResumeSync,pauseRemoteSync,remoteSyncPaused,remoteStorageHTML,
      putRemoteBackup,installRemoteSnapshot,commitSnapshot,applyFullBackup,readRemoteBackup,s3Request,validateRemoteConfig,
      testAndSaveRemoteConfig,saveRemoteConfig,clearRemoteConfig,readRemoteWork,scheduleRemoteBackup,remoteTestConnection,
      get state(){return state},set state(v){state=v},get ui(){return ui},get saveFailed(){return localStore.failed},
      set existing(v){localStore.existing=v}, get generation(){return remoteEngine.generation},
      get rescue(){return localStorage.getItem(LS_REMOTE_RESTORE_KEY)},
      async idle(){await remoteEngine.queue}, set confirm(fn){confirmDlg=fn}, set dialog(fn){dialog=fn},
      get controllers(){return remoteEngine.controllers}, readJSONFile, actions, set download(fn){downloadBlob=fn}};
  `;
  ctx.messages=[];
  vm.runInContext(source.replace('/* @test-seam */',seam).replace(/\ninit\(\);\n/, '\n'),ctx);
  return {ctx,api:ctx.api,storage,timers,messages:ctx.messages};
}
module.exports={device};
