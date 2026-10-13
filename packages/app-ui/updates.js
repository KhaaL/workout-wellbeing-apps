/* Explicit app updates; storage and workout state are supplied by each app. */
globalThis.WorkoutUpdates = (() => {
  function create(options){
    const service=navigator.serviceWorker,version=document.querySelector('meta[name="app-version"]')?.content||'development';
    let registration=null,busy=false,applyRequested=false,locked=false,lockTimer=0,lastAutoCheck=0,status='Checking offline support…',error='';
    const active=()=>!!options.isActive();
    const notify=()=>options.onChange?.(api.state());
    function refresh(){notify();}
    function flush(){try{return options.flush()!==false;}catch(error){return false;}}
    function unlock(){locked=false;clearTimeout(lockTimer);notify();}
    function lock(){locked=true;clearTimeout(lockTimer);lockTimer=setTimeout(unlock,15000);notify();}
    function message(event){
      if(event.data?.type!=='APP_UPDATE_STATE'||!event.ports?.[0])return;
      const ready=!active()&&flush()&&!active();
      if(ready&&event.data.lock)lock();
      event.ports[0].postMessage({ready});
    }
    async function check({automatic=false}={}){
      if(!registration||busy)return;
      if(automatic&&(document.visibilityState!=='visible'||navigator.onLine===false||registration.waiting||registration.installing||Date.now()-lastAutoCheck<60000))return;
      lastAutoCheck=Date.now();
      busy=true;error='';status='Checking for an update…';notify();
      try{await registration.update();status=registration.waiting?'Update ready.':registration.installing?'Downloading app update…':'App update check complete.';}
      catch(e){error='Could not check for updates. Connect to the internet and try again.';}
      finally{busy=false;notify();}
    }
    async function apply(){
      if(busy||!registration?.waiting)return;
      if(active()){error='Finish or end the saved workout before applying an update.';notify();return;}
      if(!flush()){error='Save failed. Download a backup before closing this app.';notify();return;}
      busy=true;error='';applyRequested=true;status='Checking every open app tab…';notify();
      const channel=new MessageChannel();
      const result=await new Promise(resolve=>{
        const timer=setTimeout(()=>{channel.port1.close();resolve({ok:false,message:'Another tab could not confirm it is ready. Finish workouts and close other app tabs, then try again.'});},7000);
        channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data||{ok:false});};
        try{registration.waiting.postMessage({type:'PREPARE_APP_UPDATE'},[channel.port2]);}
        catch(e){clearTimeout(timer);resolve({ok:false,message:'Update changed while checking. Check again.'});}
      });
      if(!result.ok){applyRequested=false;busy=false;unlock();error=result.message||'Update deferred. A workout is active or a tab could not save.';notify();}
      else{status='Applying update…';notify();}
    }
    const api={check,apply,refresh,canStart:()=>!locked&&!applyRequested,state:()=>({version,status,error,busy,waiting:!!registration?.waiting,active:active(),locked})};
    if(!service||!window.isSecureContext){status='Offline installation needs HTTPS hosting.';notify();return api;}
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check({automatic:true});});
    window.addEventListener('online',()=>check({automatic:true}));
    service.addEventListener('message',message);
    service.addEventListener('controllerchange',()=>{
      if(applyRequested){if(!active()&&flush())(options.reload||(()=>location.reload()))();else{applyRequested=false;busy=false;error='Update installed. Finish your workout and reopen the app when saved.';unlock();}}
      else unlock();
    });
    service.register(options.workerUrl,{updateViaCache:'none'}).then(reg=>{
      registration=reg;status=reg.waiting?'Update ready.':'Offline app registered.';notify();
      const watched=new WeakSet();
      // Some browsers dispatch installed before registration.waiting is assigned.
      // Re-read it after the event rather than rendering a disabled Apply button.
      const installed=(worker,attempt=0)=>{
        if(reg.waiting===worker){status='Update ready.';notify();return;}
        if(worker.state==='installed'&&attempt<10){setTimeout(()=>installed(worker,attempt+1),50);return;}
        if(worker.state==='activated'){status='Offline app files installed.';notify();}
      };
      const watch=worker=>{
        if(!worker||watched.has(worker))return;watched.add(worker);
        const changed=()=>{
          if(worker.state==='installed')installed(worker);
          if(worker.state==='redundant'){busy=false;applyRequested=false;error='App update could not install. Check again.';notify();}
        };
        worker.addEventListener('statechange',changed);changed();
      };
      watch(reg.installing);watch(reg.waiting);
      reg.addEventListener('updatefound',()=>{status='Downloading app update…';watch(reg.installing);notify();});
      check({automatic:true});
      service.ready.then(()=>{options.onReady?.();notify();}).catch(()=>{});
    }).catch(()=>{status='Offline installation is unavailable here.';notify();});
    return api;
  }
  function render(container,controller,state=controller.state(),layout='liftlog'){
    if(!container)return;container.replaceChildren();
    const paragraph=document.createElement('p');paragraph.className=layout==='bike'?'small':'desc';paragraph.textContent=`Loaded app version: ${state.version}. ${state.error||state.status}${state.waiting&&state.active?' Update deferred until the saved workout is finished or ended.':''}`;paragraph.setAttribute('role','status');container.append(paragraph);
    const actions=document.createElement('div');actions.className=layout==='bike'?'stack':'form-actions';
    for(const [id,label,run,disabled]of [['checkAppUpdate','Check for app update',()=>controller.check(),state.busy],['applyAppUpdate','Apply update & reopen',()=>controller.apply(),state.busy||state.active||!state.waiting]]){const button=document.createElement('button');button.type='button';button.id=id;button.textContent=label;button.className=layout==='bike'?'secondary':'btn';button.disabled=disabled;button.addEventListener('click',run);actions.append(button);}container.append(actions);
  }
  return {create,render};
})();
