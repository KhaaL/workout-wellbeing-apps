/* App composition stays separate from the existing workout apps. */
(() => {
  'use strict';
  const C=TabataTimer,$=id=>document.getElementById(id);
  const format=ms=>{const s=Math.ceil(ms/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
  const names={prepare:'Get ready',work:'Work',rest:'Rest',complete:'Complete'};
  let storage=null,shell=null,updates=null,view='setup',lastPhase='',lastCue='',lastCheckpoint=0,lastSavedPhase='',toastTimer=0;
  let wake=null,wakePending=false,audio=null,bellBuffer=null,bellDecode=null,cloudBusy=false,remoteStatus='',panel=null,lastResult=null;
  const bellSources=new Set();
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6000);}
  function localStatus(){
    if(!storage)return;
    $('storageWarning').hidden=!(storage.local.failed||storage.local.warning);
    $('storageWarning').textContent=storage.local.warning||(storage.local.failed?'Changes are in memory only. Download a backup before closing.':'');
  }
  function downloadJSON(payload,name){
    const blob=new Blob([typeof payload==='string'?payload:JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  storage=TabataStorage.create({toast,confirm:WorkoutUI.confirm,onLocalStatus:localStatus,
    onRemoteStatus:status=>{remoteStatus=status;renderStorage();},
    onBusy:busy=>{cloudBusy=busy;panel?.setBusy(busy);renderStatus();},onRefresh:()=>renderStorage(),
    onBrowse:()=>{navigate('settings');openStorage('snapshots');},
    onRestore:()=>{fillSetup();fillSettings();navigate(storage.state.active?'run':view==='run'?'setup':view);renderStorage();localStatus();}});
  function active(){return storage.state.active;}
  function fillSetup(){
    for(const key of ['work','rest','rounds'])$(key).value=storage.state.settings[key];
    $('instructions').value=storage.state.settings.instructions;WorkoutMarkdown.setPreview($('instructionsPreview'),$('instructions'),$('instructions-preview'),false);
    renderPresets();renderPlan();renderInstructions();
  }
  function hasInstructions(){return !!storage.state.settings.instructions.trim();}
  function renderInstructions(){$('instructionsState').textContent=hasInstructions()?'Added':'Optional';$('openInstructions').hidden=!hasInstructions();}
  function saveInstructions(){
    storage.state.settings=C.settings({...storage.state.settings,instructions:$('instructions').value});storage.save();renderInstructions();
  }
  function renderPresets(){
    for(const key of ['work','rest']){
      const container=$(key+'Presets');container.replaceChildren();
      for(const seconds of storage.state.settings[key+'Presets']){
        const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=seconds+'s';button.dataset.seconds=String(seconds);
        button.setAttribute('aria-pressed',String($(key).valueAsNumber===seconds));
        button.addEventListener('click',()=>{$(key).value=String(seconds);saveSetup();});container.append(button);
      }
    }
  }
  function readSetup(){return C.config({...storage.state.settings,...Object.fromEntries(['work','rest','rounds'].map(key=>[key,$(key).valueAsNumber]))});}
  function renderPlan(){
    for(const key of ['work','rest'])for(const button of $(key+'Presets').querySelectorAll('button'))button.setAttribute('aria-pressed',String($(key).valueAsNumber===Number(button.dataset.seconds)));
    try{const c=readSetup();$('totalTime').textContent=format(C.duration(c));$('planHint').textContent=`${c.prepare?c.prepare+'s to get ready · ':''}${c.rounds} × ${c.work}s work${c.rest?' / '+c.rest+'s rest':' · no rest'}. No rest after the final round.`;$('start').disabled=!!active();}
    catch(error){$('totalTime').textContent='—';$('planHint').textContent=error.message;$('start').disabled=true;}
  }
  function saveSetup(){
    renderPlan();if(!$('setupForm').checkValidity())return;
    storage.state.settings=C.settings({...storage.state.settings,...readSetup()});storage.save();
  }
  function fillSettings(){
    for(const key of ['prepare','sound','keepAwake']){if(key==='prepare')$(key).value=storage.state.settings[key];else $(key).checked=storage.state.settings[key];}
    for(const key of ['work','rest'])storage.state.settings[key+'Presets'].forEach((value,index)=>$(key+'Preset'+(index+1)).value=value);
  }
  function navigate(target){
    if(target==='setup'&&active())target='run';view=target;
    if(target!=='run'&&$('instructionsDialog').open)$('instructionsDialog').close();
    if(!active())document.title='Tabata · Interval timer';
    for(const id of ['setup','run','complete','settings'])$(id).hidden=id!==target;
    const onWorkout=target==='run';document.documentElement.classList.toggle('setup-screen',target==='setup');
    document.documentElement.classList.toggle('session-active',!!active());shell?.update(target==='run'||target==='complete'?'setup':target,!!active(),onWorkout);
    if(target==='settings')renderStorage();if(target==='run')renderTimer();
    updates?.refresh();window.scrollTo(0,0);
  }
  async function readyAudio(){
    const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw new Error('Unsupported');audio ||= new Audio();
    // Resume inside the user's tap, before awaiting sample decoding.
    const resumed=audio.resume();
    if(!bellDecode){
      const bytes=Uint8Array.from(atob(TabataBellAudio),character=>character.charCodeAt(0));
      bellDecode=audio.decodeAudioData(bytes.buffer).then(buffer=>{bellBuffer=buffer;}).catch(error=>{bellDecode=null;throw error;});
    }
    await Promise.all([resumed,bellDecode]);
    if(audio.state!=='running')throw new Error('Audio suspended');
  }
  function primeAudio(){
    if(!active()?.config.sound)return;
    const sessionId=active().id;
    readyAudio().then(()=>{
      if(active()?.id!==sessionId)return;
      $('audioStatus').textContent='';renderTimer();
    }).catch(()=>$('audioStatus').textContent='Sound unavailable. Follow the on-screen timer.');
  }
  function stopBells(){for(const source of bellSources)try{source.stop();}catch(error){}bellSources.clear();}
  function beep(frequency=660,length=.12,delay=0,volume=.18,attack=.012){
    if(!active()?.config.sound||document.hidden)return true;
    if(!audio||audio.state!=='running')return false;
    try{const oscillator=audio.createOscillator(),gain=audio.createGain(),at=audio.currentTime+delay;
      oscillator.frequency.value=frequency;gain.gain.setValueAtTime(.001,at);gain.gain.linearRampToValueAtTime(volume,at+attack);gain.gain.exponentialRampToValueAtTime(.001,at+length);
      oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(at);oscillator.stop(at+length);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};return true;
    }catch(error){$('audioStatus').textContent='Sound unavailable. Follow the on-screen timer.';return false;}
  }
  function boxingBell(strikes,preview=false,onEnded){
    if(!preview&&(!active()?.config.sound||document.hidden))return true;
    if(!audio||audio.state!=='running'||!bellBuffer)return false;
    try{
      const at=audio.currentTime;
      for(let strike=0;strike<strikes;strike++){
        const source=audio.createBufferSource(),gain=audio.createGain();source.buffer=bellBuffer;gain.gain.value=.6;
        source.connect(gain);gain.connect(audio.destination);bellSources.add(source);
        source.onended=()=>{bellSources.delete(source);source.disconnect();gain.disconnect();if(strike===strikes-1)onEnded?.();};
        source.start(at+strike*.18);
      }
      return true;
    }catch(error){$('audioStatus').textContent='Sound unavailable. Follow the on-screen timer.';return false;}
  }
  function soundCue(kind){
    return kind==='prepare'?beep(660,.12):boxingBell(kind==='work'?1:kind==='rest'?2:3);
  }
  async function releaseWake(){
    const previous=wake;wake=null;if(previous)try{await previous.release();}catch(error){}
    if(!active()){$('wakeStatus').textContent='Screen stay-awake is off.';$('retryWake').hidden=true;}
  }
  async function requestWake(){
    if(!active()||!active().config.keepAwake||document.hidden){await releaseWake();$('wakeStatus').textContent=active()?.config.keepAwake?'Stay-awake waits until this app is visible.':'Screen stay-awake is off.';$('retryWake').hidden=true;return;}
    if(wake&&!wake.released||wakePending)return;
    if(!navigator.wakeLock){$('wakeStatus').textContent='Stay-awake unavailable. Check your device’s auto-lock setting.';$('retryWake').hidden=true;return;}
    wakePending=true;
    try{
      const requested=await navigator.wakeLock.request('screen');
      if(!active()||!active().config.keepAwake||document.hidden){await requested.release();return;}
      wake=requested;$('wakeStatus').textContent='Screen stay-awake is on.';$('retryWake').hidden=true;
      requested.addEventListener('release',()=>{if(wake!==requested)return;wake=null;$('wakeStatus').textContent='Stay-awake was released. Check auto-lock or retry.';$('retryWake').hidden=!active()||document.hidden;});
    }catch(error){$('wakeStatus').textContent='Stay-awake unavailable. Check auto-lock or retry.';$('retryWake').hidden=!active();}
    finally{wakePending=false;}
  }
  function checkpoint(remote=false){
    if(active())storage.state.active=C.checkpoint(active(),Date.now());
    lastCheckpoint=Date.now();return storage.save(remote);
  }
  function start(config){
    if(active()||!updates?.canStart())return;
    stopBells();
    storage.state.active=C.start(config,Date.now(),globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
    storage.state.settings=C.settings({...storage.state.settings,...config});lastPhase='';lastCue='';lastSavedPhase='';$('recovered').hidden=true;$('audioStatus').textContent='';
    checkpoint();primeAudio();requestWake();navigate('run');$('pause').focus();
  }
  function finish(outcome){
    const session=active();if(!session)return;
    const elapsedMs=C.elapsed(session,Date.now());
    stopBells();soundCue(outcome);
    lastResult={id:session.id,config:{...session.config},startedAt:session.startedAt,elapsedMs,outcome};
    storage.state.history=[lastResult,...storage.state.history];storage.state.active=null;
    const saved=storage.save();releaseWake();
    $('completeTitle').textContent=outcome==='complete'?'Nicely done.':'Session ended';
    $('completeSummary').textContent=`${C.snapshot({...session,elapsedMs,anchorAt:null,status:'paused'},Date.now()).completedRounds} of ${session.config.rounds} rounds · ${format(elapsedMs)} total`;
    $('completeSaveStatus').textContent=saved?'Session saved on this device.':'Session is in memory only. Download a backup before closing.';
    fillSetup();navigate('complete');$('again').focus();
  }
  function renderTimer(){
    const session=active();if(!session)return;
    const now=Date.now(),s=C.snapshot(session,now),paused=session.status==='paused';
    if(s.kind==='complete'){finish('complete');return;}
    const phaseText=paused?'Paused · '+names[s.kind]:names[s.kind];
    if($('phaseName').textContent!==phaseText)$('phaseName').textContent=phaseText;
    $('timerPanel').dataset.phase=s.kind;$('timerPanel').dataset.paused=String(paused);
    $('clock').textContent=format(s.remainingMs);$('roundLabel').textContent=`Round ${s.round} of ${session.config.rounds}`;
    $('progress').value=s.elapsedMs/s.totalMs;$('remainingTotal').textContent=format(s.totalMs-s.elapsedMs)+' total left';
    $('nextPhase').textContent=s.kind==='prepare'?'Next: Work':s.kind==='work'?s.round===session.config.rounds?'Next: Finish':session.config.rest?'Next: Rest':'Next: Work':'Next: Work';
    $('pause').textContent=paused?'Resume':'Pause';
    const seconds=Math.ceil(s.remainingMs/1000),cue=s.phaseKey+'-'+seconds;
    if(!paused){
      if(lastPhase!==s.phaseKey){if(soundCue(s.kind))lastPhase=s.phaseKey;}
      else if(seconds<=3&&lastCue!==cue)beep(660,.1);
      lastCue=cue;
      if(lastSavedPhase!==s.phaseKey||now-lastCheckpoint>=5000){lastSavedPhase=s.phaseKey;checkpoint();}
    }
    document.title=`${paused?'Paused':names[s.kind]} ${format(s.remainingMs)} · Tabata`;
  }
  function pauseOrResume(){
    if(!active())return;
    $('recovered').hidden=true;
    if(active().status==='running'){storage.state.active=C.pause(active(),Date.now());stopBells();}
    else{storage.state.active=C.resume(active(),Date.now());primeAudio();lastPhase='';lastCue='';}
    checkpoint();requestWake();renderTimer();
  }
  // Settings: the shared status card and Backups & cloud storage panel.
  function exportBackup(){checkpoint();downloadJSON(storage.backup(),'tabata-backup-'+new Date().toISOString().slice(0,10)+'.json');if(!WorkoutStorage.recordFileBackup('tabata.v1'))toast('Backup downloaded; its date could not be saved.');renderStorage();}
  function openStorage(target){
    $('storage-options').open=true;
    const node=panel.open(target)||$('storage-options').querySelector('summary');node.scrollIntoView({block:'nearest'});node.focus();
  }
  function renderStatus(){
    if(!storage)return;
    WorkoutStorage.renderStorageSummary($('storage-summary'),WorkoutStorage.summaryInput({local:storage.local,remote:storage.remote,status:remoteStatus,busy:cloudBusy||panel?.saving,
      revision:storage.state.updatedAt,fileAt:WorkoutStorage.fileBackupAt('tabata.v1'),active:active()}),
    {download:exportBackup,details:()=>openStorage(),configure:()=>openStorage('configure'),backup:()=>storage.remote.remoteBackup(),retry:()=>storage.remote.remoteBackup(),
      review:()=>openStorage('review'),resume:async()=>{await storage.remote.remotePublishLocal();renderStorage();},error:error=>toast(error.message)});
  }
  function renderStorage(){if(!storage||!panel)return;panel.refresh();renderStatus();}
  const persistence=WorkoutStorage.createPersistence({askedKey:'tabata.v1.persist-asked',onChange:()=>panel?.refresh()});
  panel=WorkoutStorage.createStoragePanel({appName:'Tabata',namespace:'tabata.v1',remote:storage.remote,persistence,confirm:WorkoutUI.confirm,toast,download:downloadJSON,onChange:renderStatus,
    backup:{contents:'presets, settings and session history',size:()=>new Blob([JSON.stringify(storage.state)]).size,download:exportBackup,restore:raw=>storage.restore(raw),
      fileAt:()=>WorkoutStorage.fileBackupAt('tabata.v1'),hasData:()=>storage.state.history.length>0},
    recovery:{restore:raw=>storage.restore(raw),describe:raw=>Array.isArray(raw.history)?'It holds '+raw.history.length+' sessions.':''}});
  panel.mount($('storagePanel'));persistence.refresh();
  shell=WorkoutUI.createShell({name:'Tabata',items:[{id:'setup',label:'Timer',icon:'workout'},{id:'settings',label:'Settings',icon:'settings'}],onNavigate:navigate});
  const themeSelect=$('themeChoice');
  for(const theme of WorkoutUI.themes){const option=document.createElement('option');option.value=theme.id;option.textContent=theme.label;themeSelect.append(option);}
  let theme='system';try{theme=localStorage.getItem('tabata.ui.theme')||theme;}catch(error){}
  themeSelect.value=WorkoutUI.applyTheme(theme);
  themeSelect.addEventListener('change',()=>{WorkoutUI.applyTheme(themeSelect.value);try{localStorage.setItem('tabata.ui.theme',themeSelect.value);}catch(error){toast('Theme changed for this visit. Device storage is unavailable.');}});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>WorkoutUI.applyTheme(themeSelect.value));
  WorkoutUI.attachSteppers($('setupForm'));WorkoutUI.attachSteppers($('settings'));
  fillSetup();fillSettings();localStatus();
  for(const key of ['work','rest','rounds']){$(key).addEventListener('input',renderPlan);$(key).addEventListener('change',saveSetup);}
  $('presetForm').addEventListener('submit',event=>{
    event.preventDefault();if(!$('presetForm').reportValidity())return;
    try{
      const presets=Object.fromEntries(['work','rest'].map(key=>[key+'Presets',[1,2,3].map(index=>$(key+'Preset'+index).valueAsNumber)]));
      storage.state.settings=C.settings({...storage.state.settings,...presets});const saved=storage.save();renderPresets();
      $('presetStatus').textContent=saved?'Presets saved.':'Presets are in memory only. Download a backup before closing.';
    }catch(error){$('presetStatus').textContent=error.message;}
  });
  $('resetPresets').addEventListener('click',()=>{
    storage.state.settings={...storage.state.settings,workPresets:C.settings().workPresets,restPresets:C.settings().restPresets};
    const saved=storage.save();fillSettings();renderPresets();$('presetStatus').textContent=saved?'Standard presets restored.':'Presets are in memory only. Download a backup before closing.';
  });
  $('setupForm').addEventListener('submit',event=>{event.preventDefault();if($('setupForm').reportValidity())try{start(readSetup());}catch(error){toast(error.message);}});
  for(const key of ['prepare','sound','keepAwake'])$(key).addEventListener('change',()=>{
    if(!$('prepare').reportValidity())return;
    storage.state.settings=C.settings({...storage.state.settings,prepare:$('prepare').valueAsNumber,sound:$('sound').checked,keepAwake:$('keepAwake').checked});storage.save();renderPlan();
  });
  $('testBell').addEventListener('click',async()=>{
    $('testBell').disabled=true;$('bellTestStatus').textContent='Loading bell…';
    const done=()=>{$('testBell').disabled=false;$('bellTestStatus').textContent='Bell preview finished.';};
    try{
      await readyAudio();stopBells();
      if(!boxingBell(1,true,done))throw new Error('Playback unavailable');
      $('bellTestStatus').textContent='Playing the recorded boxing bell.';
    }catch(error){$('testBell').disabled=false;$('bellTestStatus').textContent='Sound unavailable. Check your browser audio settings.';}
  });
  $('instructions').maxLength=WorkoutMarkdown.MAX_LENGTH;
  $('instructions').addEventListener('input',saveInstructions);
  $('instructionsPreview').addEventListener('click',()=>WorkoutMarkdown.togglePreview($('instructionsPreview'),$('instructions'),$('instructions-preview')));
  // The pop-out leaves the timer running; closing returns focus to the button.
  $('openInstructions').addEventListener('click',()=>{$('instructionsBody').innerHTML=WorkoutMarkdown.render(storage.state.settings.instructions);$('instructionsDialog').showModal();});
  $('closeInstructions').addEventListener('click',()=>$('instructionsDialog').close());
  $('instructionsDialog').addEventListener('close',()=>{if(view==='run')$('openInstructions').focus();});
  $('pause').addEventListener('click',pauseOrResume);$('retryWake').addEventListener('click',requestWake);
  $('end').addEventListener('click',async()=>{
    const session=active();if(!session)return;
    storage.state.active=C.pause(session,Date.now());stopBells();checkpoint();renderTimer();
    if(await WorkoutUI.confirm('End this timer?','Your progress will be saved as an ended session.','End timer',true))finish('ended');
  });
  $('again').addEventListener('click',()=>{if(lastResult)start(lastResult.config);});$('editSetup').addEventListener('click',()=>{document.title='Tabata · Interval timer';navigate('setup');});
  if(document.documentElement.hasAttribute('data-source-preview')){
    // Source previews load external modules; only the built app has an offline shell.
    updates={canStart:()=>true,refresh:()=>{}};
    $('updatesPanel').textContent='Source preview. Install and offline updates are available in the built app.';
    $('updatesHint').textContent='Use the built app for home-screen installation and offline use.';
  }else{
    updates=WorkoutUpdates.create({workerUrl:'service-worker.js',isActive:()=>!!active(),flush:()=>checkpoint(),onChange:state=>{if(updates)WorkoutUpdates.render($('updatesPanel'),updates,state);}});
    WorkoutUpdates.render($('updatesPanel'),updates);
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden){checkpoint();releaseWake();}else{renderTimer();requestWake();storage.remote.remoteStartupSync();}});
  window.addEventListener('pagehide',()=>{checkpoint();releaseWake();});
  window.addEventListener('pageshow',()=>{renderTimer();requestWake();});
  window.addEventListener('online',()=>storage.remote.remoteStartupSync());
  // Another app on this site saved or forgot the shared connection.
  window.addEventListener('storage',event=>{if(event.key===WorkoutStorage.SHARED_CONNECTION_KEY){panel.reload();renderStatus();}});
  setInterval(()=>{if(active())renderTimer();},100);
  if(active()){$('recovered').hidden=false;storage.save(false);navigate('run');requestWake();}else navigate('setup');
  storage.remote.remoteStartupSync();
})();
