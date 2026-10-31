/* Backups & cloud storage: one section shared by every app's Settings, in
   Liftlog's order. Recovery copies, the backup file, device storage, cloud
   backup with earlier backups, the shared connection, then troubleshooting.
   The panel owns one root element. An app that re-renders Settings calls
   mount() with its new placeholder and the same nodes move there, so typed
   connection fields and opened sections survive the render. */

/* Device storage durability: read without asking, requested on demand. A
   refusal is sticky, because persisted() keeps answering false afterwards. */
WorkoutStorage.createPersistence = function({askedKey, onChange}) {
  const STATES=['checking','unavailable','declined','best-effort','persistent'];
  let state='checking',estimate=null,brave=false;
  const manager=()=>{const s=navigator.storage;return s&&typeof s.persist==='function'&&typeof s.persisted==='function'?s:null;};
  const set=next=>{if(!STATES.includes(next)||next===state||(state==='declined'&&next==='best-effort'))return;state=next;onChange?.();};
  const asked=()=>{try{return localStorage.getItem(askedKey)==='1';}catch(e){return false;}};
  // "denied" means the browser will never grant it. Safari throws on the name,
  // so a refused persist() reaches the same state by the other route.
  function permission(){
    let query=null;
    try{query=navigator.permissions?.query?.({name:'persistent-storage'});}catch(e){query=null;}
    if(!query||typeof query.then!=='function'){set('best-effort');return;}
    query.then(result=>set(result?.state==='denied'?'declined':'best-effort')).catch(()=>set('best-effort'));
  }
  function refresh(){
    const sm=manager();if(!sm){set('unavailable');return;}
    sm.persisted().then(yes=>yes?set('persistent'):permission()).catch(()=>set('unavailable'));
    if(typeof sm.estimate==='function')sm.estimate().then(next=>{if(!next)return;const changed=!estimate||estimate.usage!==next.usage;estimate=next;if(changed)onChange?.();}).catch(()=>{});
    if(typeof navigator.brave?.isBrave==='function')navigator.brave.isBrave().then(yes=>{if(yes&&!brave){brave=true;onChange?.();}}).catch(()=>{});
  }
  // fromUser: the Settings button, where undoing an earlier refusal is the point.
  async function request(fromUser){
    const sm=manager();if(!sm||state==='persistent')return state;
    if(!fromUser&&(asked()||state==='declined'))return state;
    try{localStorage.setItem(askedKey,'1');}catch(e){}
    // A browser can grant later than it answers, so persisted() has the last word.
    try{set(await sm.persist()||await sm.persisted()?'persistent':'declined');}catch(e){set('unavailable');}
    return state;
  }
  const installed=()=>{try{return !!window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;}catch(e){return false;}};
  return {get state(){return state;},get estimate(){return estimate;},get brave(){return brave;},installed,refresh,request};
};

WorkoutStorage.createStoragePanel = function(options) {
  const {remote,persistence,backup,namespace,download}=options,name=options.appName,prefix=namespace.split('.')[0];
  const bike=options.layout==='bike',css={button:bike?'secondary':'btn',primary:bike?'secondary':'btn btn-primary',danger:bike?'secondary danger':'btn btn-danger'};
  const confirm=options.confirm,toast=options.toast,changed=()=>options.onChange?.();
  const ui={draft:null,saving:false,remoteBusy:false,message:'',error:false,connectionOpen:null};
  const CLOUD_IDS={backup:'cloudBackup',pause:'cloudPause','publish-local':'cloudKeepLocal',resume:'cloudResume',restore:'cloudUseRemote'};
  const CLOUD_RUN={backup:'remoteBackup',pause:'pauseRemoteSyncAction','publish-local':'remotePublishLocal',resume:'remoteResumeSync',restore:'remoteRestore'};
  function el(tag,props={},...children){
    const node=document.createElement(tag);
    for(const [key,value] of Object.entries(props)){if(key==='text')node.textContent=value;else if(key in node)node[key]=value;else node.setAttribute(key,value);}
    node.append(...children.filter(child=>child!=null));return node;
  }
  const hint=(text,props={})=>el('p',{className:'sp-hint',...props},text);
  const block=(title,...children)=>el('div',{className:'sp-block'},el('h3',{text:title}),...children);
  const actions=(...children)=>el('div',{className:'sp-actions'},...children);
  const button=(id,label,cls,run)=>{const node=el('button',{type:'button',id,className:cls,text:label});node.addEventListener('click',()=>Promise.resolve().then(run).catch(error=>toast(error.message)));return node;};
  const fileButton=(id,label,accept,run)=>{const input=el('input',{type:'file',id,accept});input.addEventListener('change',async()=>{const file=input.files?.[0];input.value='';if(file)try{await run(file);}catch(error){toast(error.message);}});return el('label',{className:'sp-file '+css.button},el('span',{text:label}),input);};
  const field=(label,input,extra='')=>el('label',{className:'field sp-field'+extra},el('span',{className:'cap',text:label}),input);
  const bytes=size=>size<1024?size+' B':Math.round(size/102.4)/10+' KB';
  const date=value=>new Date(value).toLocaleString();
  const since=options.since||(at=>at?date(at):'never');
  async function readJSON(file,limit){if(file.size>limit)throw new Error('File exceeds the '+(limit>=1048576?limit/1048576+' MiB':limit/1024+' KiB')+' limit.');return JSON.parse(await file.text());}
  const stamp=()=>new Date().toISOString().slice(0,10);
  const read=key=>{try{return localStorage.getItem(key);}catch(e){return null;}};

  // Recovery copies: what a replacement or an unreadable save left behind.
  const recoveryBox=el('div',{id:'recoveryCopies',className:'sp-recovery'});
  function renderRecovery(){
    const items=[];
    const unreadable=read(namespace+'.unreadable'),previous=read(namespace+'.before-remote-restore');
    if(unreadable!=null)items.push({kind:'unreadable',raw:unreadable,title:'Recovered unreadable data',
      detail:name+' kept '+bytes(new Blob([unreadable]).size)+' that it could not load. Download the untouched copy before discarding it.'});
    if(previous!=null){
      let obj=null;try{obj=JSON.parse(previous);}catch(e){}
      const at=Date.parse(obj?.exportedAt),held=obj&&options.recovery?.describe?.(obj);
      items.push({kind:'before-remote-restore',raw:previous,obj,title:'Previous local copy',
        detail:'Saved automatically'+(Number.isFinite(at)?' on '+date(at):'')+', just before a restore, clear or received handoff replaced this device’s data.'+(held?' '+held:'')+' The next replacement overwrites this copy.'});
    }
    for(const extra of options.recovery?.extra?.()||[])items.push(extra);
    const signature=JSON.stringify(items.map(item=>[item.kind,item.raw.length,item.detail]));
    if(recoveryBox.dataset.signature===signature)return;recoveryBox.dataset.signature=signature;recoveryBox.replaceChildren();
    for(const item of items){
      const suffix={unreadable:'Unreadable','before-remote-restore':'Recovery'}[item.kind]||item.kind[0].toUpperCase()+item.kind.slice(1);
      const row=actions(button('download'+suffix,'Download',css.button,()=>download(item.raw,prefix+'-'+item.kind+'-'+stamp()+(item.kind==='unreadable'?'.txt':'.json'))));
      if(item.kind==='before-remote-restore'&&item.obj&&options.recovery?.restore)row.append(button('restoreRecovery','Restore this copy…',css.button,async()=>{
        if(read(namespace+'.before-remote-restore')!==item.raw)throw new Error('The previous local copy changed. Review it again.');
        await options.recovery.restore(JSON.parse(item.raw));refresh();changed();
      }));
      if(item.kind==='unreadable'||item.kind==='before-remote-restore')row.append(button('discard'+suffix,'Discard…',css.danger,async()=>{
        const copy=item.kind==='unreadable'?['Discard rescued data?','This permanently removes the preserved unreadable copy. Download it first if you may need to recover it.']:['Discard previous local copy?','This removes the data saved before the most recent replacement. Download it first if you may need it.'];
        if(!await confirm(copy[0],copy[1],'Discard',true))return;
        if(read(namespace+'.'+item.kind)!==item.raw)throw new Error('This copy changed during review. Nothing discarded.');
        localStorage.removeItem(namespace+'.'+item.kind);refresh();toast('Copy discarded.');
      }));
      recoveryBox.append(el('div',{className:'sp-block',role:'status'},el('h3',{text:item.title,className:item.kind==='unreadable'?'sp-danger':''}),hint(item.detail),row));
    }
  }

  // Backup file.
  const fileDescription=hint(''),backupAge=hint('',{id:'backupAge'});
  const fileBlock=block('Backup file',fileDescription,backupAge,actions(
    button('exportBackup','Download full backup',css.button,()=>{backup.download();refresh();}),
    fileButton('importBackup','Restore from file','.json,application/json',async file=>{if(await backup.restore(await readJSON(file,8*1024*1024)))toast('Backup restored. Cloud backups stay paused until you review them.');refresh();changed();})));
  function backupInfo(){
    if(backup.info)return backup.info();
    const file=Number(backup.fileAt?.())||0,cloud=Number(remote.loadRemoteConfig()?.lastBackupAt)||0,at=Math.max(file,cloud);
    return {at:at||null,where:at?(cloud>=file?'cloud':'file'):null,stale:at?Date.now()-at>=14*86400000:!!backup.hasData?.()};
  }
  function renderFile(){
    fileDescription.textContent='Everything in one file: '+backup.contents+'. Restoring replaces what is on this device ('+bytes(backup.size())+').'+(remote.loadRemoteConfig()?'':' Nothing leaves this device unless you set up cloud backup below.');
    const info=backupInfo();
    backupAge.textContent='Last backup: '+since(info.at)+(info.where?', to '+(info.where==='cloud'?'the cloud':'a downloaded file'):'')+'.'+(info.stale?' Download a fresh full backup.':'');
    backupAge.classList.toggle('sp-warning',!!info.stale);
  }

  // Device storage: one line per state, and a button only where it can help.
  const deviceSize=hint('',{id:'storageDiagnostics'}),deviceLine=hint('',{id:'persistenceStatus'});
  const persistButton=button('requestPersistence','Request persistent storage',css.button,async()=>{
    const state=await persistence.request(true);
    toast(state==='persistent'?'Storage is now persistent.':state==='declined'?'This browser will not make storage persistent. Keep a backup.':'This browser cannot make storage persistent.');refresh();
  });
  const deviceBlock=block('Device storage',deviceSize,deviceLine,actions(persistButton));
  function renderDevice(){
    const state=persistence.state,estimate=persistence.estimate,ios=' iOS also clears it after about 7 days without a visit.';
    const full=estimate?.quota&&estimate.usage/estimate.quota>=0.8?' This site has used '+Math.round(100*estimate.usage/estimate.quota)+'% of its storage quota.':'';
    deviceSize.textContent=name+'’s data takes '+bytes(backup.size())+' on this device.'+full;
    deviceLine.textContent={
      persistent:'Persistent: this browser will not clear '+name+'’s data to free space.',
      declined:(persistence.brave?'Brave does not grant persistent storage':'This browser refused persistent storage')+', so it may clear '+name+'’s data when space runs low or site data is cleared.'+ios+(persistence.installed()?' The installed app is the most durable option here.':' Installing '+name+' to the home screen helps.')+' Keep an off-device backup.',
      'best-effort':'Best-effort: this browser may clear '+name+'’s data when space runs low.'+ios+' Persistent storage or installing '+name+' to the home screen prevents this.',
      unavailable:'This browser does not say whether it may clear '+name+'’s data, as on file:// or http:// pages. Keep an off-device backup.'
    }[state]||'Checking whether this browser may clear '+name+'’s data…';
    deviceLine.classList.toggle('sp-warning',state==='declined'||state==='best-effort'||state==='unavailable');
    persistButton.hidden=state!=='best-effort';
  }

  // Cloud backup: the mode's buttons, then earlier backups.
  const cloudDescription=hint('',{id:'cloudDescription'}),cloudActions=actions(),snapshots=el('div',{id:'remoteSnapshots',className:'remote-tools'});
  cloudActions.id='cloudActions';
  for(const [id,domId] of Object.entries(CLOUD_IDS))cloudActions.append(button(domId,'',css.button,async()=>{await remote[CLOUD_RUN[id]]();refresh();changed();}));
  const cloudBlock=block('Cloud backup',cloudDescription,cloudActions,snapshots);

  // The shared connection form, in one field order for every app.
  const input=(id,props={})=>{const node=el('input',{id,autocapitalize:'none',spellcheck:false,autocomplete:'off',...props});node.addEventListener('input',()=>{draft()[props['data-field']]=node.value;});return node;};
  const mode=el('select',{id:'cloudMode'},el('option',{value:'immutable',text:'Separate backup files (recommended)'}),el('option',{value:'conditional',text:'Conditional sync (one shared file)'}));
  mode.addEventListener('change',()=>{draft().syncMode=mode.value;});
  const fields={endpoint:input('cloudEndpoint',{type:'url','data-field':'endpoint',placeholder:'https://storage.example.com'}),region:input('cloudRegion',{'data-field':'region',placeholder:'Provider region'}),
    bucket:input('cloudBucket',{'data-field':'bucket'}),objectKey:input('cloudObject',{'data-field':'objectKey',placeholder:remote.defaultObjectKey}),
    accessKeyId:input('cloudAccess',{'data-field':'accessKeyId'}),secretAccessKey:input('cloudSecret',{type:'password','data-field':'secretAccessKey'})};
  const pathStyle=el('input',{type:'checkbox',id:'cloudPathStyle'});pathStyle.addEventListener('change',()=>{draft().pathStyle=pathStyle.checked;});
  const configStatus=el('p',{id:'cloudConfigStatus',className:'sp-hint',role:'status'});
  const saveButton=el('button',{type:'submit',id:'saveCloud',className:css.primary,text:'Check & save connection'});
  const exportButton=button('exportCloudConfig','Save config file',css.button,exportConfig);
  const configHint=hint('');
  const scope=el('div',{id:'connectionScope',className:'sp-scope'});
  const form=el('form',{id:'cloudForm',className:'sp-form',noValidate:true},
    field('Backup mode',mode),hint('Separate files never replace another device’s data. Conditional sync needs a provider that enforces overwrite protection.'),
    el('div',{className:'sp-row'},field('Endpoint URL',fields.endpoint,' sp-wide'),field('Region',fields.region),field('Bucket',fields.bucket)),
    hint('HTTPS address with no path or query. Plain HTTP works only from a local file or localhost.'),
    el('div',{className:'sp-row'},field('Backup path · this app',fields.objectKey,' sp-wide'),field('Access key ID',fields.accessKeyId),field('Secret access key',fields.secretAccessKey)),
    hint('Keys are stored unencrypted in this browser and shared by every app on this site. Use a key limited to this bucket.'),
    el('label',{className:'sp-check'},pathStyle,el('span',{text:'Path-style addressing'})),hint('Some S3-compatible services require it. Check your provider’s documentation.'),
    configStatus,actions(saveButton,fileButton('importCloudConfig','Load config file','.json,application/json',loadConfig),exportButton),configHint);
  form.addEventListener('submit',event=>{event.preventDefault();save();});
  const testButton=button('cloudTest','Test read access',css.button,async()=>{await remote.remoteTestConnection();refresh();});
  const forgetButton=button('cloudForget','Forget connection…',css.danger,forget);
  const connectionTools=actions(testButton,forgetButton);
  const connectionSummary=el('small'),connection=el('details',{id:'cloudConnection',className:'sp-details'},el('summary',{},el('span',{className:'sp-summary'},el('span',{text:'Connection'}),connectionSummary)),scope,form,connectionTools);
  connection.addEventListener('toggle',()=>{ui.connectionOpen=connection.open;});

  // Troubleshooting: the provider check and diagnostics, collapsed.
  const toolsSummary=el('small'),tools=el('div',{id:'remoteTools',className:'remote-tools'});
  const troubleshooting=el('details',{id:'storageTools',className:'sp-details'},el('summary',{},el('span',{className:'sp-summary'},el('span',{text:'Troubleshooting'}),toolsSummary)),tools);
  const noCrypto=el('p',{className:'sp-warning',text:'Cloud backup needs the Web Crypto API, only available in a secure context (https:// or localhost). It is unavailable here.'});

  const root=el('div',{className:'storage-panel'},recoveryBox,fileBlock,deviceBlock,cloudBlock,connection,troubleshooting);
  // A new form starts path-style: most S3-compatible services accept it. A
  // saved connection shows the backup path in use, the default included.
  function draftFromConfig(cfg){return {endpoint:cfg?.endpoint||'',region:cfg?.region||'',bucket:cfg?.bucket||'',objectKey:cfg?cfg.objectKey||remote.defaultObjectKey:'',accessKeyId:cfg?.accessKeyId||'',secretAccessKey:'',syncMode:remote.syncMode(cfg),pathStyle:cfg?!!cfg.pathStyle:true};}
  function draft(){return ui.draft||(ui.draft=draftFromConfig(remote.loadRemoteConfig()));}
  function fillForm(){const d=draft();for(const [key,node] of Object.entries(fields))if(node.value!==d[key])node.value=d[key];mode.value=d.syncMode;pathStyle.checked=d.pathStyle;}
  function message(text,error=false){ui.message=text;ui.error=error;}

  async function save(){
    const d=draft(),existing=remote.loadRemoteConfig();
    const endpoint=d.endpoint.trim().replace(/\/+$/,''),region=d.region.trim(),bucket=d.bucket.trim(),accessKeyId=d.accessKeyId.trim();
    if(!/^https?:\/\/.+/.test(endpoint)){message('Endpoint must be a full http:// or https:// address, such as https://storage.example.com.',true);refresh();return;}
    if(!region||!bucket||!accessKeyId){message('Region, bucket and access key ID are required.',true);refresh();return;}
    // A saved secret is kept only for the same access key ID.
    const secretAccessKey=d.secretAccessKey.trim()||(existing?.accessKeyId===accessKeyId?existing.secretAccessKey:'');
    if(!secretAccessKey){message('Enter the secret access key for this access key ID.',true);refresh();return;}
    ui.saving=true;message('Checking connection…');refresh();
    let generation=remote.generation;
    try{
      const pending=remote.configure({endpoint,region,bucket,objectKey:d.objectKey.trim()||remote.defaultObjectKey,accessKeyId,secretAccessKey,syncMode:d.syncMode,pathStyle:!!d.pathStyle});
      generation=remote.generation;await pending;
      ui.draft=null;ui.connectionOpen=false;
      // Says what the sync step that configure() starts does next.
      message(d.syncMode==='conditional'
        ?'Read check passed. Connection saved. Sync starts now: a device with only its starting data takes the cloud copy; if both hold data, sync pauses until you choose one.'
        :'Read check passed. Connection saved. This device backs up its own changes as new files; if cloud backups already exist, you are asked whether to restore one.');
      toast('Read check passed. Connection saved.');
    }catch(error){if(generation===remote.generation)message(error.message,true);}
    finally{ui.saving=false;refresh();changed();}
  }
  async function loadConfig(file){
    try{ui.draft=remote.configDraft(await readJSON(file,64*1024));}catch(error){message(error.message,true);refresh();return;}
    ui.connectionOpen=true;message('Config file loaded for review. '+(ui.draft.secretAccessKey?'':'Enter the secret access key. ')+'Choose Check & save connection to apply it.');refresh();
  }
  async function exportConfig(){
    if(!remote.loadRemoteConfig())return;
    const choice=await WorkoutUI.dialog({title:'Save config file?',
      body:'The file carries the endpoint, region, bucket, backup path and access key ID. Including the secret access key makes it a complete credential: anyone who opens the file, or anywhere it gets synced or mailed, can read and write that bucket.',
      buttons:[{label:'Cancel',value:'',autofocus:true},{label:'Without secret key',value:'safe',cls:'btn-primary',id:'exportConfigSafe'},{label:'Include secret key',value:'full',cls:'btn-danger-solid',id:'exportConfigSecret'}]});
    if(!choice)return;
    if(choice==='full'&&!await confirm('Include the secret access key?','Anyone with this file can read and write your bucket.','Include secret key',true))return;
    download(JSON.stringify(remote.configPayload(choice==='full'),null,2),prefix+'-connection-'+stamp()+'.json');
    toast(choice==='full'?'Config file saved. It contains your secret key.':'Config file saved without the secret key.');
  }
  async function forget(){
    const text=WorkoutStorage.forgetConnectionText(remote);
    if(!await confirm(text.title,text.body,'Forget connection',true))return;
    remote.clearRemoteConfig();ui.draft=null;ui.connectionOpen=null;message('Connection forgotten.');refresh();changed();
  }

  function refresh(){
    const cfg=remote.loadRemoteConfig(),crypto=remote.remoteCryptoAvailable(),busy=ui.saving||ui.remoteBusy;
    renderRecovery();renderFile();renderDevice();
    noCrypto.remove();cloudBlock.querySelector('h3').after(...(crypto?[]:[noCrypto]));
    cloudDescription.replaceChildren(...(cfg?[el('strong',{text:cfg.bucket}),' · '+(remote.syncMode(cfg)==='conditional'
      ?'Conditional sync. One shared file; sync can replace this device’s data with a newer cloud copy.'
      :'Separate backup files. Every backup is a new file; other devices change only when you restore one there.')]
      :['Back up automatically to S3-compatible storage you control. Requests go straight from this browser to your storage; '+name+' has no server. One connection serves every app on this site.']));
    cloudActions.hidden=!cfg||!crypto;snapshots.hidden=!cfg||!crypto;
    const buttons=Object.fromEntries(Object.entries(CLOUD_IDS).map(([id,domId])=>[id,cloudActions.querySelector('#'+domId)]));
    const shown=WorkoutStorage.cloudActions(remote.syncMode(cfg),remote.remoteSyncPaused());
    WorkoutStorage.applyCloudActions(buttons,remote.syncMode(cfg),remote.remoteSyncPaused());
    for(const [id,node] of Object.entries(buttons)){node.disabled=id!=='pause'&&busy;node.className=shown.find(item=>item.id===id)?.primary?css.primary:css.button;}
    // Without a connection these clear their containers.
    if(crypto)WorkoutStorage.renderRemoteTools(snapshots,remote,download,bike?'bike':'liftlog',['snapshots']);
    connection.hidden=!crypto;troubleshooting.hidden=!cfg||!crypto;
    connectionSummary.textContent=cfg?'Endpoint, bucket, keys and config file':'Required before the first backup';
    connection.open=ui.connectionOpen==null?!cfg:ui.connectionOpen;
    WorkoutStorage.renderConnectionScope(scope,remote,{className:'sp-hint',buttonClass:css.button,confirm,onChange:()=>{ui.draft=null;refresh();changed();}});
    fillForm();
    fields.secretAccessKey.placeholder=cfg?'•••••••• (leave blank to keep)':'';
    for(const node of form.querySelectorAll('input,select,button'))node.disabled=busy;
    saveButton.textContent=ui.saving?'Testing connection…':'Check & save connection';
    configStatus.textContent=ui.message;configStatus.classList.toggle('sp-warning',ui.error);configStatus.setAttribute('role',ui.error?'alert':'status');
    exportButton.hidden=!cfg;connectionTools.hidden=!cfg;testButton.disabled=busy;forgetButton.disabled=ui.saving;
    configHint.replaceChildren(cfg?'A config file sets up another device without retyping, with or without the secret key.':'Have a config file from another device? Load config file fills this form.');
    toolsSummary.textContent=remote.diagnosticsPayload().lastError?'Last connection failed; details inside':'Provider check and diagnostics';
    if(crypto)WorkoutStorage.renderRemoteTools(tools,remote,download,bike?'bike':'liftlog',['checks']);
  }
  return {
    root,refresh,
    // Moves the same nodes into a re-rendered placeholder.
    mount(container){if(!container)return;if(root.parentNode!==container)container.replaceChildren(root);refresh();},
    // The saved connection changed elsewhere: drop the draft and show it.
    reload(){ui.draft=null;refresh();},
    setBusy(busy){ui.remoteBusy=!!busy;refresh();},
    get saving(){return ui.saving;},
    // Opens the part a status card action points to and returns what to focus.
    open(target){
      if(target==='configure'){ui.connectionOpen=true;refresh();return fields.endpoint;}
      if(target==='snapshots'){refresh();return snapshots.querySelector('#snapshotList button')||snapshots.querySelector('#browseSnapshots');}
      if(target==='review')return [...cloudActions.querySelectorAll('button')].find(node=>!node.hidden&&(node.id==='cloudKeepLocal'||node.id==='cloudResume'))||null;
      return null;
    }
  };
};
