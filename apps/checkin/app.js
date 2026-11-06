/* Check-in composition: screens, taps that save at once, and the shared Settings flows. */
(() => {
  'use strict';
  const C=CheckinCore,$=id=>document.getElementById(id);
  const el=(tag,props={},...children)=>{const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(c=>c!=null&&c!==false));return node;};
  const newId=prefix=>prefix+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  const plural=(n,word)=>n+' '+word+(n===1?'':'s');
  let storage=null,shell=null,updates=null,view='today',toastTimer=0,cloudBusy=false,remoteStatus='',panel=null,historyLimit=30;
  const S=()=>storage.state;

  // A modal dialog covers the page, so the toast moves into the open one to stay visible.
  function toast(message,action){
    const box=$('toast'),host=[...document.querySelectorAll('dialog[open]')].at(-1)||document.body;if(box.parentElement!==host)host.append(box);
    $('toastText').textContent=message;const button=$('toastAction');button.hidden=!action;
    if(action){button.textContent=action.label;button.onclick=()=>{$('toast').hidden=true;action.run();};}
    $('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},action?8000:5000);
  }
  function localStatus(){
    if(!storage)return;
    $('storageWarning').hidden=!(storage.local.failed||storage.local.warning);
    $('storageWarning').textContent=storage.local.warning||(storage.local.failed?'Changes are in memory only. Download a backup before closing.':'');
  }
  function save(){const ok=storage.save();localStatus();return ok;}
  function downloadJSON(payload,name){
    const blob=new Blob([typeof payload==='string'?payload:JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  storage=CheckinStorage.create({toast,confirm:WorkoutUI.confirm,onLocalStatus:localStatus,
    onRemoteStatus:status=>{remoteStatus=status;renderStorage();},
    onBusy:busy=>{cloudBusy=busy;panel?.setBusy(busy);renderStatus();},onRefresh:()=>renderStorage(),
    onBrowse:()=>{navigate('settings');openStorage('snapshots');},
    onRestore:()=>{fillSettings();render();renderStorage();localStatus();}});

  /* Days and times. */
  const today=()=>C.dayFor(Date.now(),S().settings.dayStart);
  const clock=at=>C.localTime(new Date(at));
  const longDate=date=>new Date(date+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  function dayName(date){
    const t=today();if(date===t)return 'Today';if(date===C.shiftDate(t,-1))return 'Yesterday';
    return new Date(date+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'short'});
  }

  /* Every tap saves at once. Undo restores the check-ins as they were before
     the tap, unless something changed them since. */
  function change(apply,message){
    const before=WorkoutStorage.copy(S().entries);
    try{apply(Date.now());}catch(error){toast(error.message);renderToday();return;}
    const ok=save(),after=JSON.stringify(S().entries);renderToday();
    toast((ok?'':'In memory only: ')+message,{label:'Undo',run:()=>{
      if(JSON.stringify(S().entries)!==after){toast('Newer changes were kept, so this cannot be undone.');return;}
      S().entries=before;save();renderToday();toast('Undone.');
    }});
  }
  function setMood(it,value){
    const cur=C.current(S(),Date.now())?.values[it.id],next=cur===value?null:value;
    change(now=>C.setValue(S(),it.id,next,now,()=>newId('c-')),next==null?it.name+' cleared.':it.name+' '+C.label(it,next)+' saved.');
  }
  function stepSymptom(it){
    const next=C.nextSeverity(C.current(S(),Date.now())?.values[it.id]);
    change(now=>C.setValue(S(),it.id,next,now,()=>newId('c-')),next==null?it.name+' removed.':it.name+': '+C.label(it,next)+'.');
  }

  /* Today. */
  function renderToday(){
    const now=Date.now(),cur=C.current(S(),now),values=cur?.values||{},day=today();
    $('todayDate').textContent=longDate(day);
    $('windowState').textContent=cur?'Updating the '+clock(cur.at)+' check-in until '+clock(cur.at+S().settings.mergeMinutes*60000)+'.':'Your next tap starts a new check-in.';
    // Items with a value in the open check-in stay visible, so a value can always be cleared.
    const shown=kind=>S().items.filter(i=>i.kind===kind&&((i.pinned&&!i.archived)||i.id in values));
    const moodBox=$('moodBox');moodBox.replaceChildren();
    for(const it of shown('mood')){
      const row=el('div',{className:'moods'});
      C.MOOD.forEach((label,index)=>{
        const value=index+1,button=el('button',{type:'button',className:'mood'},el('strong',{textContent:String(value)}),el('span',{textContent:label}));
        button.setAttribute('aria-pressed',String(values[it.id]===value));button.setAttribute('aria-label',it.name+' '+value+', '+label);
        button.addEventListener('click',()=>setMood(it,value));row.append(button);
      });
      moodBox.append(el('fieldset',{},el('legend',{textContent:it.name}),row));
    }
    const chips=$('symptomChips');chips.replaceChildren();
    const symptoms=shown('symptom');$('symptomBox').hidden=!symptoms.length;
    for(const it of symptoms){
      const level=values[it.id],button=el('button',{type:'button',className:'symptom'},it.name);
      if(level){button.dataset.level=String(level);button.append(el('span',{className:'level',textContent:C.SEVERITY[level-1]}));}
      button.setAttribute('aria-pressed',String(!!level));
      const next=C.nextSeverity(level);
      button.setAttribute('aria-label',it.name+(level?', '+C.SEVERITY[level-1].toLowerCase():', not recorded')+'. Tap for '+(next?C.SEVERITY[next-1].toLowerCase():'off')+'.');
      button.addEventListener('click',()=>stepSymptom(it));chips.append(button);
    }
    if(document.activeElement!==$('note'))$('note').value=cur?.note||'';
    const entries=C.entriesFor(S(),day).slice().reverse();
    $('dayEmpty').hidden=!!entries.length;
    $('dayEntries').replaceChildren(...entries.map(entryRow));
  }
  function entryRow(e){
    const parts=C.describe(S(),e);
    return el('li',{},el('time',{dateTime:new Date(e.at).toISOString(),textContent:clock(e.at)}),el('span',{textContent:parts||'Note only'}),e.note?el('span',{className:'note',textContent:e.note}):null);
  }
  $('note').addEventListener('change',()=>{
    const text=$('note').value;
    change(now=>C.setNote(S(),text,now,()=>newId('c-')),text.trim()?'Note saved.':'Note removed.');
  });

  /* History. */
  function renderHistory(){
    const days=C.days(S());$('historyEmpty').hidden=!!days.length;
    $('dayList').replaceChildren(...days.slice(0,historyLimit).map(day=>{
      const entries=C.entriesFor(S(),day).slice().reverse();
      return el('li',{},el('h2',{textContent:dayName(day)+' · '+plural(entries.length,'check-in')}),el('ul',{className:'entries'},...entries.map(entryRow)));
    }));
    $('olderDays').hidden=days.length<=historyLimit;
  }
  $('olderDays').addEventListener('click',()=>{historyLimit+=30;renderHistory();});

  /* Settings: tracked items and timing. Each control holds one value and saves on change. */
  function itemsStatus(message){$('itemsStatus').textContent=message;}
  function editItems(apply,message){
    const before=JSON.stringify(S().items);
    try{apply();}catch(error){S().items=JSON.parse(before);itemsStatus(error.message);fillItems();return false;}
    itemsStatus(save()?message:'Saved in memory only. Download a backup before closing.');fillItems();render();return true;
  }
  function itemRow(it){
    const name=el('input',{type:'text',value:it.name,maxLength:60,required:true,autocomplete:'off'});name.setAttribute('aria-label','Name of '+it.name);
    name.addEventListener('change',()=>editItems(()=>C.renameItem(S(),it.id,name.value),'Renamed to '+name.value.trim()+'. History uses the new name.'));
    const pinned=el('input',{type:'checkbox',checked:it.pinned});
    pinned.addEventListener('change',()=>editItems(()=>{it.pinned=pinned.checked;},it.name+(pinned.checked?' shows on Today.':' is hidden from Today.')));
    const archive=el('button',{type:'button',className:'btn archive',textContent:'Archive'});archive.setAttribute('aria-label','Archive '+it.name);
    archive.addEventListener('click',()=>editItems(()=>C.archiveItem(S(),it.id,true),it.name+' archived. Its history is kept.'));
    return el('li',{className:'item-row'},name,el('label',{className:'check'},pinned,'On Today'),archive);
  }
  function archivedRow(it){
    const restore=el('button',{type:'button',className:'btn',textContent:'Restore'});restore.setAttribute('aria-label','Restore '+it.name);
    restore.addEventListener('click',()=>editItems(()=>C.archiveItem(S(),it.id,false),it.name+' restored.'));
    return el('li',{className:'item-row'},el('span',{textContent:it.name+(it.kind==='mood'?' (mood)':'')}),restore);
  }
  function fillItems(){
    $('itemRows').replaceChildren(...S().items.filter(i=>!i.archived&&['mood','symptom'].includes(i.kind)).map(itemRow));
    const archived=S().items.filter(i=>i.archived&&['mood','symptom'].includes(i.kind));
    $('archivedBox').hidden=!archived.length;$('archivedRows').replaceChildren(...archived.map(archivedRow));
  }
  $('addItemForm').addEventListener('submit',event=>{
    event.preventDefault();if(!$('addItemForm').reportValidity())return;
    const name=$('newItemName').value;
    if(editItems(()=>C.addItem(S(),{kind:'symptom',name},newId('s-')),name.trim()+' added to Today.'))$('newItemName').value='';
  });
  function fillSettings(){
    fillItems();$('dayStart').value=S().settings.dayStart;$('mergeMinutes').value=String(S().settings.mergeMinutes);
  }
  function saveSetting(input,key,value){
    if(!input.reportValidity())return;
    try{S().settings=C.settings({...S().settings,[key]:value});if(!save())toast('Saved in memory only. Download a backup before closing.');render();}
    catch(error){toast(error.message);fillSettings();}
  }
  $('dayStart').addEventListener('change',()=>saveSetting($('dayStart'),'dayStart',$('dayStart').value));
  $('mergeMinutes').addEventListener('change',()=>saveSetting($('mergeMinutes'),'mergeMinutes',$('mergeMinutes').valueAsNumber));
  $('deleteAll').addEventListener('click',async()=>{
    try{if(await storage.clearEntries()){render();renderStorage();toast('Check-ins deleted on this device. A recovery copy is saved and cloud backups are paused.');}}
    catch(error){toast(error.message);}
  });

  /* Settings: the shared status card and Backups & cloud storage panel. */
  function exportBackup(){storage.local.flush();downloadJSON(storage.backup(),'checkin-backup-'+new Date().toISOString().slice(0,10)+'.json');if(!WorkoutStorage.recordFileBackup('checkin.v1'))toast('Backup downloaded; its date could not be saved.');renderStorage();}
  function openStorage(target){
    $('storage-options').open=true;
    const node=panel.open(target)||$('storage-options').querySelector('summary');node.scrollIntoView({block:'nearest'});node.focus();
  }
  function renderStatus(){
    if(!storage)return;
    WorkoutStorage.renderStorageSummary($('storage-summary'),WorkoutStorage.summaryInput({local:storage.local,remote:storage.remote,status:remoteStatus,busy:cloudBusy||panel?.saving,
      revision:S().updatedAt,fileAt:WorkoutStorage.fileBackupAt('checkin.v1')}),
    {download:exportBackup,details:()=>openStorage(),configure:()=>openStorage('configure'),backup:()=>storage.remote.remoteBackup(),retry:()=>storage.remote.remoteBackup(),
      review:()=>openStorage('review'),resume:async()=>{await storage.remote.remotePublishLocal();renderStorage();},error:error=>toast(error.message)});
  }
  function renderStorage(){if(!storage||!panel)return;panel.refresh();renderStatus();}
  const persistence=WorkoutStorage.createPersistence({askedKey:'checkin.v1.persist-asked',onChange:()=>panel?.refresh()});
  panel=WorkoutStorage.createStoragePanel({appName:'Check-in',namespace:'checkin.v1',remote:storage.remote,persistence,confirm:WorkoutUI.confirm,toast,download:downloadJSON,onChange:renderStatus,
    backup:{contents:'check-ins, tracked items and settings',size:()=>new Blob([JSON.stringify(S())]).size,download:exportBackup,restore:raw=>storage.restore(raw),
      fileAt:()=>WorkoutStorage.fileBackupAt('checkin.v1'),hasData:()=>S().entries.length>0},
    recovery:{restore:raw=>storage.restore(raw),describe:raw=>Array.isArray(raw.entries)?'It holds '+plural(raw.entries.length,'check-in')+'.':''}});
  panel.mount($('storagePanel'));persistence.refresh();

  /* Navigation. */
  function render(){if(view==='today')renderToday();else if(view==='history')renderHistory();}
  function navigate(target){
    view=target;for(const id of ['today','history','settings'])$(id).hidden=id!==target;
    shell.update(target,false,false);
    if(target==='settings')renderStorage();render();updates?.refresh();window.scrollTo(0,0);
  }
  shell=WorkoutUI.createShell({name:'Check-in',items:[{id:'today',label:'Today',icon:'today'},{id:'history',label:'History',icon:'history'},{id:'settings',label:'Settings',icon:'settings'}],onNavigate:navigate});
  const themeSelect=$('themeChoice');
  for(const theme of WorkoutUI.themes)themeSelect.append(el('option',{value:theme.id,textContent:theme.label}));
  let theme='system';try{theme=localStorage.getItem('checkin.ui.theme')||theme;}catch{}
  themeSelect.value=WorkoutUI.applyTheme(theme);
  themeSelect.addEventListener('change',()=>{WorkoutUI.applyTheme(themeSelect.value);try{localStorage.setItem('checkin.ui.theme',themeSelect.value);}catch{toast('Theme changed for this visit. Device storage is unavailable.');}});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>WorkoutUI.applyTheme(themeSelect.value));
  WorkoutUI.attachSteppers($('settings'));

  updates=WorkoutUpdates.create({workerUrl:'service-worker.js',isActive:()=>false,flush:()=>storage.save(false),onChange:state=>{if(updates)WorkoutUpdates.render($('updatesPanel'),updates,state);}});
  WorkoutUpdates.render($('updatesPanel'),updates);
  // The open check-in closes by time, so Today refreshes while it is in view.
  setInterval(()=>{if(view==='today'&&!document.hidden)renderToday();},30000);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){storage.local.flush();return;}render();storage.remote.remoteStartupSync();});
  window.addEventListener('pagehide',()=>storage.local.flush());
  window.addEventListener('online',()=>storage.remote.remoteStartupSync());
  // Another app on this site saved or forgot the shared connection.
  window.addEventListener('storage',event=>{if(event.key===WorkoutStorage.SHARED_CONNECTION_KEY){panel.reload();renderStatus();}});
  fillSettings();localStatus();navigate('today');
  storage.remote.remoteStartupSync();
})();
