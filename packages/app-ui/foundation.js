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
  return {themes,schemes,applyTheme,createShell,attachSteppers};
})();
