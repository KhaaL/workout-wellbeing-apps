/* Shared presentation only. Adapters own workouts and durable saving. */
/* exported WorkoutUI */
const WorkoutUI = (() => {
  const themes = ['system','light','dark','dracula','gruvbox','nord','solarized','monokai'].map(id=>({id,label:id[0].toUpperCase()+id.slice(1)}));
  const schemes = Object.fromEntries(themes.map(({id})=>[id,id==='system'?null:id==='light'?'light':'dark']));
  function applyTheme(value){
    const theme=themes.some(t=>t.id===value)?value:'system',root=document.documentElement;
    if(theme==='system')root.removeAttribute('data-theme');else root.dataset.theme=theme;
    root.style.colorScheme=schemes[theme]||'light dark';
    // Browser chrome follows the rendered theme, not an inverted text color.
    root.removeAttribute('data-statusbar');
    document.querySelectorAll('meta[name="theme-color"][media]').forEach(m=>m.remove());
    let meta=document.querySelector('meta[name="theme-color"]');
    if(!meta){meta=document.createElement('meta');meta.name='theme-color';document.head.append(meta);}
    const css=getComputedStyle(root);meta.content=css.getPropertyValue('--surface').trim();
    return theme;
  }
  const paths={workout:'M4 9v6m3-9v12m10-12v12m3-9v6M7 12h10',routines:'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',history:'M4 5v5h5M4 10a8 8 0 1 1 1 7M12 7v5l3 2',exercises:'M4 6h6v6H4zM14 6h6v6h-6zM4 16h6M14 16h6',settings:'M4 7h16M4 17h16M8 4v6M16 14v6'};
  function createShell({name,items,onNavigate}){
    installValidation();
    const header=document.querySelector('.app-header'),nav=header.querySelector('.main-nav'),list=nav.querySelector('ul');
    nav.style.setProperty('--nav-count',String(items.length));list.replaceChildren();
    for(const item of items){
      const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='nav-btn';button.dataset.view=item.id;button.dataset.action='nav';
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.classList.add('nav-icon');
      const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[item.icon]||paths.workout);svg.append(path);
      const label=document.createElement('span');label.className='nav-label';label.textContent=item.label;button.append(svg,label);li.append(button);list.append(li);
      button.addEventListener('click',event=>{event.stopPropagation();onNavigate(item.id);});
    }
    const title=document.createElement('div');title.className='shell-title';const brand=document.createElement('strong');brand.textContent=name;
    const menuButton=document.createElement('button');menuButton.type='button';menuButton.className='btn shell-menu-button';menuButton.textContent='Menu';title.append(brand,menuButton);header.prepend(title);
    const menu=document.createElement('dialog');menu.className='shell-menu';menu.setAttribute('aria-label','Workout menu');const h=document.createElement('h2');h.textContent='Workout menu';menu.append(h);
    const links=document.createElement('div');links.className='menu-items';menu.append(links);
    for(const item of items){const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=item.label;button.addEventListener('click',()=>{menu.close();onNavigate(item.id);});links.append(button);}
    const close=document.createElement('button');close.className='btn menu-close';close.textContent='Close';close.type='button';close.addEventListener('click',()=>menu.close());menu.append(close);document.body.append(menu);
    menuButton.addEventListener('click',()=>menu.showModal());
    const back=document.createElement('button');back.className='btn btn-primary return-workout';back.type='button';back.textContent='Return to workout';back.hidden=true;header.after(back);back.addEventListener('click',()=>onNavigate(items[0].id));
    const root=document.documentElement;
    function update(current,active,onWorkout){
      root.classList.toggle('workout-screen',!!onWorkout);back.hidden=!active||onWorkout;menuButton.hidden=!onWorkout;
      for(const button of list.querySelectorAll('button')){if(button.dataset.view===current)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
      measure();
    }
    function measure(){
      const action=[...document.querySelectorAll('.workout-actions,.actionbar')].find(node=>node.getClientRects().length&&getComputedStyle(node).display!=='none');
      if(action){observer.observe(action);const height=Math.ceil(action.getBoundingClientRect().height)+'px';if(root.style.getPropertyValue('--action-h')!==height)root.style.setProperty('--action-h',height);}
    }
    const observer=new ResizeObserver(measure);observer.observe(document.body);
    const vv=window.visualViewport;
    let fullHeight=vv?.height||innerHeight,fullWidth=vv?.width||innerWidth;
    const keyboard=()=>{
      const input=document.activeElement?.matches('input,textarea,select'),height=vv?.height||innerHeight,width=vv?.width||innerWidth;
      if(!input||Math.abs(width-fullWidth)>80){fullHeight=height;fullWidth=width;}
      root.style.setProperty('--visible-h',height+'px');
      const touch=window.matchMedia('(pointer:coarse)').matches;
      root.classList.toggle('keyboard-open',!!input&&touch&&(!vv||vv.scale===1)&&(Math.max(fullHeight,innerHeight)-height>150));
    };
    vv?.addEventListener('resize',keyboard);window.addEventListener('resize',keyboard);document.addEventListener('focusin',keyboard);document.addEventListener('focusout',()=>{root.classList.remove('keyboard-open');});
    return {update,measure};
  }
  let numericId=0;
  function attachSteppers(container){
    for(const input of container.querySelectorAll('input[data-stepper]')){
      if(input.closest('.numeric-stepper'))continue;
      const labelNode=input.closest('label');
      const label=input.getAttribute('aria-label')||labelNode?.childNodes[0]?.textContent.trim()||'value';
      input.setAttribute('aria-label',label);
      if(!input.id)input.id='ui-number-'+(++numericId);
      if(labelNode)labelNode.htmlFor=input.id;
      const wrap=document.createElement('div');wrap.className='numeric-stepper';input.before(wrap);wrap.append(input);
      for(const [text,direction]of [['−',-1],['+',1]]){
        const button=document.createElement('button');button.type='button';button.textContent=text;
        button.setAttribute('aria-label',(direction<0?'Decrease ':'Increase ')+label);
        button.addEventListener('click',()=>{
          try{
            if(input.dataset.increment){
              const amount=Number(input.dataset.increment),base=Number.isFinite(input.valueAsNumber)?input.valueAsNumber:0;
              const min=input.min===''?-Infinity:Number(input.min),max=input.max===''?Infinity:Number(input.max);
              input.value=String(Math.round(Math.min(max,Math.max(min,base+direction*amount))*1e8)/1e8);
            }else direction<0?input.stepDown():input.stepUp();
            input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
          }catch{}
        });
        if(direction<0)wrap.prepend(button);else wrap.append(button);
      }
    }
  }
  let validationInstalled=false,validationId=0;
  function installValidation(){
    if(validationInstalled)return;validationInstalled=true;
    function clear(input){
      const id=input.dataset.validationMessage;if(!id)return;
      document.getElementById(id)?.remove();input.removeAttribute('aria-invalid');
      const described=(input.getAttribute('aria-describedby')||'').split(' ').filter(value=>value&&value!==id).join(' ');
      if(described)input.setAttribute('aria-describedby',described);else input.removeAttribute('aria-describedby');delete input.dataset.validationMessage;
    }
    document.addEventListener('invalid',event=>{
      const input=event.target;if(!input.matches('input,select,textarea'))return;clear(input);
      const message=document.createElement('span');message.id='field-error-'+(++validationId);message.className='field-error';message.textContent=input.validationMessage;
      const anchor=input.closest('.numeric-stepper')||input;anchor.after(message);input.dataset.validationMessage=message.id;input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby',((input.getAttribute('aria-describedby')||'')+' '+message.id).trim());
    },true);
    document.addEventListener('input',event=>{const input=event.target;if(input.matches('input,select,textarea')&&input.validity.valid)clear(input);});
  }
  function dialog({title,body,buttons=[{label:'OK',value:true,cls:'btn-primary'}]}){
    let dlg=document.getElementById('dlg');
    if(!dlg){dlg=document.createElement('dialog');dlg.id='dlg';dlg.innerHTML='<h2 id="dlg-title"></h2><p id="dlg-body"></p><div id="dlg-actions"></div>';document.body.append(dlg);}
    // Never replace the contents of an unanswered confirmation.
    if(dlg.open)return Promise.resolve(null);
    const opener=document.activeElement;dlg.classList.add('shared-dialog');dlg.setAttribute('aria-labelledby','dlg-title');dlg.setAttribute('aria-describedby','dlg-body');
    document.getElementById('dlg-title').textContent=title;document.getElementById('dlg-body').textContent=body;
    const actions=document.getElementById('dlg-actions');actions.className='shared-actions';actions.replaceChildren();let result=null;
    for(const option of buttons){const button=document.createElement('button');button.type='button';button.className='btn '+(option.cls||'');button.textContent=option.label;button.autofocus=!!option.autofocus;button.addEventListener('click',()=>{result=option.value;dlg.close();});actions.append(button);}
    return new Promise(resolve=>{dlg.addEventListener('close',()=>{if(opener?.isConnected)opener.focus();resolve(result);},{once:true});dlg.showModal();(actions.querySelector('[autofocus]')||actions.querySelector('button'))?.focus();});
  }
  const confirm=(title,body,label='Confirm',danger=false)=>dialog({title,body,buttons:[{label:'Cancel',value:false,autofocus:true},{label,value:true,cls:danger?'btn-danger-solid':'btn-primary'}]});
  function renderRecent(container,journal,notify){
    if(!container)return;container.replaceChildren();
    const details=document.createElement('details'),heading=document.createElement('summary');heading.textContent='Recent changes & recently deleted';details.append(heading);container.append(details);
    const hint=document.createElement('p');hint.className='hint';hint.textContent='Up to 30 changes from the last 30 days, on this device only. Undo keeps unrelated records and refuses to overwrite newer edits. Restored records follow your current backup settings.';details.append(hint);
    let entries;try{entries=journal.list();}catch(error){hint.textContent=error.message;return;}
    if(!entries.length){const p=document.createElement('p');p.textContent='No recent changes.';details.append(p);}
    for(const entry of entries){const row=document.createElement('div');row.className='recent-change';const text=document.createElement('span');text.textContent=entry.label+' · '+new Date(entry.at).toLocaleString();const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=entry.deleted?'Restore':'Undo';button.setAttribute('aria-label',button.textContent+' '+entry.label);button.addEventListener('click',()=>{try{journal.undo(entry.id);notify('Change restored.');}catch(error){notify(error.message);}renderRecent(container,journal,notify);details.open=true;});row.append(text,button);details.append(row);}
  }
  function offerUndo(journal,entry,notify){
    if(!entry)return;
    let bar=document.getElementById('undo-bar');if(!bar){bar=document.createElement('div');bar.id='undo-bar';bar.className='undo-bar';bar.setAttribute('role','status');(document.querySelector('main')||document.body.lastElementChild).before(bar);}
    bar.replaceChildren();const text=document.createElement('span');text.textContent=entry.label;const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='Undo';button.addEventListener('click',()=>{try{journal.undo(entry.id);bar.remove();notify('Change restored.');}catch(error){notify(error.message);}});const close=document.createElement('button');close.type='button';close.className='btn';close.textContent='Dismiss';close.addEventListener('click',()=>bar.remove());bar.append(text,button,close);
  }
  return {themes,schemes,applyTheme,createShell,attachSteppers,dialog,confirm,renderRecent,offerUndo};
})();
