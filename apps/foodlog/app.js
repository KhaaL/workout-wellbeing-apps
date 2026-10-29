/* Foodlog composition: screens, dialogs and saving through the shared engine. */
(() => {
  'use strict';
  const F=FoodCore,$=id=>document.getElementById(id);
  // Label and unit for nutrients, free sugars and micronutrients alike.
  const info=key=>F.describe(key);
  const fmt=(key,value)=>F.format(value,info(key).unit);
  const named=f=>f.brand?f.brand+' '+f.name:f.name;
  const plural=(n,word)=>n+' '+word+(n===1?'':'s');
  const el=(tag,props={},...children)=>{const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(c=>c!=null&&c!==false));return node;};
  const newId=prefix=>prefix+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  let storage=null,shell=null,updates=null,view='today',viewDate='',followToday=true,toastTimer=0,cloudBusy=false,remoteStatus='',panel=null;
  let historyLimit=60,sheetFoodId=null,editingEntryId=null,amountFood=null,selectedPortion='',editingFoodId=null,foodThen=null;
  let composing=false,returnToSearch=false,pickResults=[];
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
  async function readJSON(input){
    const file=input.files[0];input.value='';if(!file)return null;
    if(file.size>8*1024*1024)throw new Error('The file exceeds 8 MiB.');
    try{return JSON.parse(await file.text());}catch{throw new Error('The file is not valid JSON.');}
  }

  storage=FoodlogStorage.create({toast,confirm:WorkoutUI.confirm,onLocalStatus:localStatus,
    onRemoteStatus:status=>{remoteStatus=status;renderStorage();},
    onBusy:busy=>{cloudBusy=busy;panel?.setBusy(busy);renderStatus();},onRefresh:()=>renderStorage(),
    onRestore:()=>{for(const id of ['addDialog','foodDialog','foodSheet'])if($(id).open)$(id).close();fillSettings();render();renderStorage();localStatus();}});

  /* Days. */
  const today=()=>F.dayFor(Date.now(),S().settings.dayStart);
  const nowTime=()=>F.localTime(new Date());
  const longDate=date=>new Date(date+'T12:00:00').toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short',year:'numeric'});
  function dayName(date){
    const t=today();if(date===t)return 'Today';if(date===F.shiftDate(t,-1))return 'Yesterday';
    return new Date(date+'T12:00:00').toLocaleDateString(undefined,{weekday:'long'});
  }
  function amountText(v,amount,portion){
    const base=v.basis==='portion'?(amount===1?'1 portion':F.round(amount,'g')+' portions'):F.round(amount,'g')+' '+F.UNITS[v.basis];
    return portion?portion+' · '+base:base;
  }
  function targetState(t){
    const gap=Math.abs(t.value-t.current);
    const text=t.status==='met'?'Target met':t.status==='short'?fmt(t.key,gap)+' to go':t.status==='over'?fmt(t.key,gap)+' over the limit':fmt(t.key,gap)+' left';
    return text+(t.missing?' · unknown for '+plural(t.missing,'item')+', so the true total is higher':'');
  }
  function renderTotals(d){
    const box=$('dayTotals'),t=d.total;box.replaceChildren();
    const facts=[plural(t.count,'item')];
    if(t.unknown.energy_kcal)facts.push('energy unknown for '+plural(t.unknown.energy_kcal,'item'));
    if(t.estimatedShare>0)facts.push(Math.round(t.estimatedShare*100)+'% of energy from estimates');
    box.append(el('div',{className:'energy'},el('strong',{textContent:fmt('energy_kcal',t.sums.energy_kcal)}),el('span',{className:'hint',textContent:facts.join(' · ')})));
    if(!d.targets.length)box.append(el('p',{className:'hint',textContent:'No daily targets yet. Set them in Settings, or import a catalog file with budgets.'}));
    for(const target of d.targets){
      const n=info(target.key),row=el('div',{className:'target'}),fill=el('span');
      row.dataset.status=target.status;fill.style.width=Math.min(100,Math.round(target.share*100))+'%';
      row.append(el('span',{textContent:n.label+(target.kind==='min'?' · at least':' · at most')}),
        el('span',{className:'value',textContent:F.round(target.current,n.unit)+' / '+fmt(target.key,target.value)}),
        el('span',{className:'bar'},fill),el('span',{className:'state',textContent:targetState(target)}));
      row.setAttribute('aria-label',n.label+': '+fmt(target.key,target.current)+' of '+(target.kind==='min'?'at least ':'at most ')+fmt(target.key,target.value)+'. '+targetState(target)+'.');
      box.append(row);
    }
    // Foods with sugars that are not yet marked free or not free, on this day.
    const unmarked=[...new Map(d.meals.flatMap(m=>m.items).filter(i=>!i.free&&(F.scaled(i.v,i.amount).nutrients.sugars_g??1)>0)
      .map(i=>S().foods.find(f=>f.id===F.foodIdOf(i.entry.version))).filter(Boolean).map(f=>[f.id,f])).values()];
    const sugarButton=()=>{const b=el('button',{type:'button',className:'link-btn',textContent:'Mark which sugars are free ('+plural(unmarked.length,'food')+')…'});b.addEventListener('click',()=>openSugars(unmarked));return b;};
    if(unmarked.length&&d.targets.some(x=>x.key===F.FREE))box.append(el('p',{},sugarButton()));
    const table=el('table',{className:'nutrients'}),body=el('tbody');
    for(const key of [...F.KEYS.filter(k=>k!=='energy_kj'),F.FREE].sort((a,b)=>(a===F.FREE?F.KEYS.indexOf('sugars_g')+0.5:F.KEYS.indexOf(a))-(b===F.FREE?F.KEYS.indexOf('sugars_g')+0.5:F.KEYS.indexOf(b)))){
      const missing=t.unknown[key];
      body.append(el('tr',{},el('th',{scope:'row',textContent:key==='sugars_g'?'Sugars (total, incl. fruit and dairy)':info(key).label}),
        el('td',{textContent:(missing?'at least ':'')+fmt(key,t.sums[key])+(missing?' ('+plural(missing,'item')+' unknown)':'')})));
    }
    table.append(body);
    const all=el('details',{},el('summary',{textContent:'All nutrients'}),table);
    if(unmarked.length)all.append(el('p',{},sugarButton()));
    box.append(all);
    // Vitamins and minerals: only foods that list a value count, so coverage is shown with each total.
    const micros=Object.entries(t.micros);
    if(micros.length){
      const list=el('table',{className:'nutrients'}),rows=el('tbody');
      for(const [key,value] of micros)rows.append(el('tr',{},el('th',{scope:'row',textContent:info(key).label}),
        el('td',{textContent:fmt(key,value)+' · listed for '+(t.count-t.microUnknown[key])+' of '+plural(t.count,'item')})));
      list.append(rows);box.append(el('details',{},el('summary',{textContent:'Vitamins & minerals'}),list));
    }
  }
  function entryButton({entry,v,amount}){
    const n=F.scaled(v,amount).nutrients,button=el('button',{type:'button',className:'row-btn'});
    button.append(el('span',{className:'main'},el('span',{className:'name'},named(v),v.estimate&&el('span',{className:'tag',textContent:'est.'})),
      el('span',{className:'sub',textContent:[amountText(v,amount,entry.portion),entry.time,entry.note].filter(Boolean).join(' · ')})),
      el('span',{className:'side',textContent:fmt('energy_kcal',n.energy_kcal)}));
    button.addEventListener('click',()=>openEntry(entry.id));return button;
  }
  function renderMeals(d){
    const box=$('meals');box.replaceChildren();
    for(const m of d.meals){
      const section=el('section',{className:'panel meal'});section.setAttribute('aria-label',m.meal);
      const sub=m.items.length?fmt('energy_kcal',m.total.sums.energy_kcal)+' · '+fmt('protein_g',m.total.sums.protein_g)+' protein':'';
      section.append(el('div',{className:'meal-head'},el('h2',{textContent:m.meal}),sub&&el('span',{className:'hint',textContent:sub})));
      if(m.items.length){
        const list=el('ul',{className:'entries'});
        for(const item of m.items)list.append(el('li',{},entryButton(item)));
        section.append(list);
      }
      const add=el('button',{type:'button',className:'btn',textContent:'Add to '+m.meal}),copy=el('button',{type:'button',className:'btn',textContent:'Copy a meal…'});
      add.addEventListener('click',()=>openAdd(m.meal));copy.addEventListener('click',()=>openCopy(m.meal));copy.setAttribute('aria-label','Copy a meal into '+m.meal);
      section.append(el('div',{className:'meal-actions'},add,copy));
      box.append(section);
    }
  }
  function renderToday(){
    const t=today();if(!viewDate)viewDate=t;
    const d=F.day(S(),viewDate);
    $('dayTitle').textContent=dayName(viewDate);$('dayDate').textContent=longDate(viewDate);$('nextDay').disabled=viewDate>=t;
    renderTotals(d);renderMeals(d);
    $('dayNotes').value=d.notes.notes||'';$('dayActivity').value=d.notes.activity||'';
    $('exportDay').disabled=!d.total.count&&!d.notes.notes&&!d.notes.activity;
  }
  function saveDayNotes(){
    const notes=$('dayNotes').value.trim(),activity=$('dayActivity').value.trim();
    if(notes||activity)S().days[viewDate]={...(notes?{notes}:{}),...(activity?{activity}:{})};else delete S().days[viewDate];
    save();$('exportDay').disabled=false;
  }

  /* Adding and editing entries. The add sheet stays open while a meal is put together:
     + logs a food at its start amount, the food's name opens the amount first, and
     both return to the list. Opened from a logged item or a food page, it closes after one. */
  function mealOptions(select,extra){
    const meals=[...S().settings.meals];if(extra&&!meals.includes(extra))meals.push(extra);
    select.replaceChildren(...meals.map(m=>el('option',{value:m,textContent:m})));
  }
  function defaultMeal(){
    const entries=S().entries.filter(e=>e.date===viewDate).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
    return entries.length?entries.at(-1).meal:S().settings.meals[0];
  }
  // The clock time on today; another day gets no time, since the clock time would be wrong there.
  const defaultTime=()=>viewDate===today()?nowTime():'';
  function showPane(pane){$('pickPane').hidden=pane!=='pick';$('amountPane').hidden=pane!=='amount';}
  function per(f){
    const unknown=f.nutrients.energy_kcal==null&&f.nutrients.protein_g==null;
    return 'per '+F.BASES[f.basis]+': '+(unknown?'values unknown':fmt('energy_kcal',f.nutrients.energy_kcal)+' · '+fmt('protein_g',f.nutrients.protein_g)+' protein');
  }
  function foodTags(f){
    const tags=[];if(f.favourite)tags.push('★');if(f.estimate)tags.push('est.');if(f.archived)tags.push('archived');if(!f.inFile&&S().settings.catalog)tags.push('not in file');
    return tags.map(text=>el('span',{className:'tag',textContent:text}));
  }
  function openAdd(meal){
    editingEntryId=null;composing=true;mealOptions($('addMeal'));$('addMeal').value=meal||defaultMeal();$('addSearch').value='';$('addSoFar').open=false;
    showPane('pick');renderPick();if(!$('addDialog').open)$('addDialog').showModal();
    // An on-screen keyboard would cover the suggestions, so only a mouse or trackpad starts in the search.
    if(matchMedia('(pointer: fine)').matches)$('addSearch').focus();
  }
  function renderPick(){renderSoFar();renderResults();}
  const refreshPick=()=>{if($('addDialog').open&&!$('pickPane').hidden)renderPick();};
  // What the meal holds on the day being logged. The summary stays one line, so the list below does not move.
  function renderSoFar(){
    const meal=$('addMeal').value,m=F.day(S(),viewDate).meals.find(x=>x.meal===meal),items=m?.items||[];
    $('addSoFarText').textContent=meal+' · '+dayName(viewDate)+': '+(items.length?plural(items.length,'item')+' · '+fmt('energy_kcal',m.total.sums.energy_kcal):'nothing yet');
    $('addSoFarList').replaceChildren(...items.map(item=>el('li',{},entryButton(item))));
  }
  function markAdded(button,f,start,count){
    button.setAttribute('aria-label','Add '+named(f)+', '+amountText(f,start.amount,start.portion)+(count?', '+count+' already in '+$('addMeal').value:''));
    if(count)button.dataset.count=String(count);else delete button.dataset.count;
  }
  function renderResults(){
    const list=$('addResults'),query=$('addSearch').value.trim(),meal=$('addMeal').value;
    // Ranked by days before this one, so foods added now keep their place in the list.
    const results=F.search(S(),{query,meal,before:viewDate}),shown=results.slice(0,50),starts=F.startAmounts(S(),shown,meal),counts=new Map();
    for(const e of S().entries)if(e.date===viewDate&&e.meal===meal){const id=F.foodIdOf(e.version);counts.set(id,(counts.get(id)||0)+1);}
    pickResults=shown;list.replaceChildren();
    for(const f of shown){
      const start=starts.get(f.id),kcal=F.scaled(f,start.amount).nutrients.energy_kcal;
      const pick=el('button',{type:'button',className:'row-btn'},el('span',{className:'main'},el('span',{className:'name'},named(f),...foodTags(f)),
        el('span',{className:'sub',textContent:amountText(f,start.amount,start.portion)+' · '+(kcal==null?'energy unknown':fmt('energy_kcal',kcal))})));
      const add=el('button',{type:'button',className:'btn quick-add',textContent:'+'});markAdded(add,f,start,counts.get(f.id));
      pick.addEventListener('click',()=>chooseFood(f));add.addEventListener('click',()=>quickAdd(f,start,add));
      list.append(el('li',{className:'pick-row'},pick,add));
    }
    if(!results.length)list.append(el('li',{},el('p',{className:'hint',textContent:query?'No food matches “'+query+'”.':'No foods yet. Import a catalog file in Foods, or add a new food.'})));
    else if(results.length>50)list.append(el('li',{},el('p',{className:'hint',textContent:'Showing 50 of '+results.length+'. Type more to narrow the list.'})));
    $('addNewFood').textContent=query?'New food “'+query+'”…':'New food…';
  }
  function logEntry(f,fields){
    if(S().entries.length>=F.LIMITS.entries)throw new Error('The log holds at most '+F.LIMITS.entries+' items. Download a backup, then remove old days.');
    return F.log(S(),f,{...fields,date:viewDate},newId('e-'));
  }
  function undoAdd(id){
    const index=S().entries.findIndex(e=>e.id===id);if(index<0)return;
    S().entries.splice(index,1);F.prune(S());save();render();refreshPick();
  }
  // One tap logs the amount the row shows; only this row and the summary change, so the next tap lands where expected.
  function quickAdd(f,start,button){
    try{
      const e=logEntry(f,{amount:start.amount,portion:start.portion,time:defaultTime(),meal:$('addMeal').value,note:''}),ok=save();
      render();renderSoFar();markAdded(button,f,start,(Number(button.dataset.count)||0)+1);
      toast(ok?'Added '+named(f)+' · '+amountText(f,start.amount,start.portion)+'.':'Saved in memory only. Download a backup before closing.',{label:'Undo',run:()=>undoAdd(e.id)});
    }catch(error){toast(error.message);}
  }
  function chooseFood(f,{fromSearch=false}={}){
    amountFood=f;editingEntryId=null;returnToSearch=fromSearch;
    const meal=$('addMeal').value;
    setupAmount(F.versionOf(f).value,f.portions,{...F.startAmounts(S(),[f],meal).get(f.id),time:defaultTime(),meal,note:''});
    showPane('amount');if(!$('addDialog').open)$('addDialog').showModal();$('amount').focus();$('amount').select();
  }
  function openEntry(id){
    const e=S().entries.find(x=>x.id===id);if(!e)return;
    const v=S().versions[e.version],food=S().foods.find(f=>f.id===F.foodIdOf(e.version));
    editingEntryId=id;amountFood=food||null;returnToSearch=false;
    setupAmount(v,food&&food.basis===v.basis?food.portions:[],{amount:e.amount,portion:e.portion||'',time:e.time,meal:e.meal,note:e.note||''});
    showPane('amount');if(!$('addDialog').open)$('addDialog').showModal();$('amount').focus();
  }
  function backToPick(){
    editingEntryId=null;composing=true;showPane('pick');renderPick();
    // Keyboard use continues in the search; otherwise focus lands on the summary, which reads out what the meal holds.
    if(returnToSearch)$('addSearch').focus();else $('addSoFarText').focus({preventScroll:true});
  }
  let amountVersion=null;
  function setupAmount(v,portions,values){
    amountVersion=v;selectedPortion=values.portion;
    const unit=v.basis==='portion'?'portions':F.UNITS[v.basis];
    $('amountTitle').textContent=named(v);
    $('amountBasis').textContent='Values per '+F.BASES[v.basis]+(v.estimate?' · estimate':'')+(editingEntryId?' · as logged':'');
    $('amountLabel').textContent='Amount · '+unit;$('amount').setAttribute('aria-label','Amount in '+(unit==='g'?'grams':unit==='ml'?'millilitres':'portions'));
    $('amount').dataset.increment=v.basis==='portion'?'0.5':v.basis==='ml'?'25':'5';
    $('amount').value=String(values.amount);$('entryTime').value=values.time||'';$('entryNote').value=values.note;
    mealOptions($('entryMeal'),values.meal);$('entryMeal').value=values.meal;
    const chips=$('portionChips');chips.replaceChildren();chips.hidden=!portions.length;
    for(const p of portions){
      const button=el('button',{type:'button',className:'btn',textContent:p.label+' · '+F.round(p.amount,'g')+' '+(v.basis==='portion'?'':F.UNITS[v.basis])});
      button.dataset.label=p.label;button.dataset.amount=String(p.amount);
      button.addEventListener('click',()=>{$('amount').value=String(p.amount);selectedPortion=p.label;renderPreview();});chips.append(button);
    }
    $('amountBack').hidden=!!editingEntryId&&!composing;$('removeEntry').hidden=!editingEntryId;$('entryMore').open=false;
    syncMore();renderPreview();
  }
  // Time, meal and note sit folded; the summary shows their values and the Add button names the meal.
  function syncMore(){
    const note=$('entryNote').value.trim();
    $('entryMoreText').textContent='Time, meal & note: '+[$('entryTime').value||'no time',$('entryMeal').value,note&&'“'+note+'”'].filter(Boolean).join(' · ');
    $('saveEntry').textContent=editingEntryId?'Save':'Add to '+$('entryMeal').value;
  }
  function renderPreview(){
    const amount=$('amount').valueAsNumber;
    for(const chip of $('portionChips').children)chip.setAttribute('aria-pressed',String(chip.dataset.label===selectedPortion&&Number(chip.dataset.amount)===amount));
    if(!Number.isFinite(amount)||amount<=0){$('amountPreview').textContent='Enter an amount.';return;}
    const n=F.scaled(amountVersion,amount).nutrients,preview=$('amountPreview');preview.replaceChildren(el('strong',{textContent:fmt('energy_kcal',n.energy_kcal)}));
    for(const key of ['protein_g','carbohydrate_g','fat_g','saturated_fat_g','fibre_g','salt_g'])
      preview.append(' · '+(n[key]==null?info(key).label.toLowerCase()+' unknown':fmt(key,n[key])+' '+info(key).label.toLowerCase()));
  }
  $('amount').addEventListener('input',()=>{const chip=[...$('portionChips').children].find(c=>c.dataset.label===selectedPortion);if(!chip||Number(chip.dataset.amount)!==$('amount').valueAsNumber)selectedPortion='';renderPreview();});
  for(const id of ['entryTime','entryNote'])$(id).addEventListener('input',syncMore);$('entryMeal').addEventListener('change',syncMore);
  $('amountPane').addEventListener('submit',event=>{
    event.preventDefault();if(!$('amountPane').reportValidity())return;
    const fields={time:$('entryTime').value,meal:$('entryMeal').value,amount:$('amount').valueAsNumber,portion:selectedPortion,note:$('entryNote').value.trim()};
    try{
      let label,undo;
      if(editingEntryId){F.updateEntry(S(),editingEntryId,fields);label='Saved.';}
      else{const e=logEntry(amountFood,fields);label='Added '+named(amountFood)+' to '+fields.meal+'.';undo={label:'Undo',run:()=>undoAdd(e.id)};}
      const ok=save();
      // A new item clears the search for the next food; an edited one keeps it.
      if(composing){if(!editingEntryId)$('addSearch').value='';backToPick();}else $('addDialog').close();
      if(view!=='today')navigate('today');else renderToday();
      toast(ok?label:'Saved in memory only. Download a backup before closing.',undo);
    }catch(error){toast(error.message);}
  });
  $('removeEntry').addEventListener('click',()=>{
    const index=S().entries.findIndex(e=>e.id===editingEntryId);if(index<0)return;
    const [removed]=S().entries.splice(index,1),version=S().versions[removed.version];
    F.prune(S());save();if(composing)backToPick();else $('addDialog').close();renderToday();
    toast('Removed '+named(version)+'.',{label:'Undo',run:()=>{
      if(S().entries.some(e=>e.id===removed.id))return;
      S().versions[removed.version] ||= version;S().entries.push(removed);save();render();refreshPick();
    }});
  });
  $('amountBack').addEventListener('click',backToPick);
  $('addSearch').addEventListener('input',renderResults);$('addMeal').addEventListener('change',renderPick);
  // Tapping into the search selects the last query, so typing the next food replaces it.
  $('addSearch').addEventListener('focus',()=>{const input=$('addSearch');input.select();input.addEventListener('mouseup',event=>event.preventDefault(),{once:true});});
  // Enter takes the first match to its amount, and Enter there adds it and returns to the search.
  $('addSearch').addEventListener('keydown',event=>{
    if(event.key!=='Enter'||event.isComposing||!$('addSearch').value.trim()||!pickResults.length)return;
    event.preventDefault();chooseFood(pickResults[0],{fromSearch:true});
  });
  $('addDialog').addEventListener('close',()=>{composing=false;returnToSearch=false;});
  $('addNewFood').addEventListener('click',()=>openFoodForm(null,{name:$('addSearch').value.trim(),then:'log'}));
  for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',()=>button.closest('dialog').close());
  for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('close',()=>{if(dialog.contains($('toast')))document.body.append($('toast'));});

  /* Food form. */
  const nutrientInputs=F.NUTRIENTS.map(n=>{
    const input=el('input',{id:'nut-'+n.key,type:'number',min:'0',max:'10000',step:'any',inputMode:'decimal'});
    $('nutrientInputs').append(el('label',{className:'field'},n.label+' · '+n.unit,input));return [n.key,input];
  });
  for(const [select,options] of [[$('foodKind'),F.KINDS],[$('foodSource'),F.SOURCES]])select.append(...Object.entries(options).map(([value,label])=>el('option',{value,textContent:label})));
  $('foodBasis').append(...Object.entries({g:'100 g',ml:'100 ml',portion:'1 portion'}).map(([value,label])=>el('option',{value,textContent:label})));
  function portionRow(p={label:'',amount:''}){
    const label=el('input',{maxLength:40,value:p.label,placeholder:'e.g. 1 slice',autocomplete:'off'}),amount=el('input',{type:'number',min:'0.01',max:'5000',step:'any',inputMode:'decimal',value:String(p.amount)});
    const remove=el('button',{type:'button',className:'btn icon-only',textContent:'×'});remove.setAttribute('aria-label','Remove portion');
    const row=el('div',{className:'portion-row'},el('label',{className:'field'},'Portion',label),el('label',{className:'field',},el('span',{className:'portion-unit',textContent:'Amount'}),amount),remove);
    remove.addEventListener('click',()=>row.remove());return row;
  }
  function basisChanged(){
    const basis=$('foodBasis').value;$('basisLegend').textContent=basis==='portion'?'1 portion':'100 '+basis;
    for(const node of $('portionRows').querySelectorAll('.portion-unit'))node.textContent=basis==='portion'?'Portions':'Amount · '+basis;
    for(const node of $('microRows').querySelectorAll('.micro-unit'))node.textContent=basis==='portion'?'Per portion':'Per 100 '+basis;
  }
  function openFoodForm(f,{name='',then=null}={}){
    editingFoodId=f?.id||null;foodThen=then;$('foodError').textContent='';
    $('foodFormTitle').textContent=f?'Edit food':'New food';
    $('foodName').value=f?.name??name;$('foodBrand').value=f?.brand??'';$('foodKind').value=f?.kind??'generic';$('foodBasis').value=f?.basis??'g';
    $('foodSource').value=f?.source??'typical';$('foodEstimate').checked=f?f.estimate:true;$('foodNote').value=f?.note??'';
    for(const [key,input] of nutrientInputs)input.value=f?.nutrients[key]==null?'':String(f.nutrients[key]);
    $('portionRows').replaceChildren(...(f?.portions||[]).map(portionRow));
    const serving=f?.details?.serving?.note;$('servingNote').hidden=!serving;$('servingNote').textContent=serving?'From the catalog file: '+serving:'';
    $('foodFreeSugars').value=f?.freeSugars||'';
    $('microRows').replaceChildren(...Object.entries(f?.micros||{}).map(([key,value])=>microRow(key,value)));
    basisChanged();$('foodDialog').showModal();$('foodName').focus();
  }
  // A vitamin or mineral row: the common list plus any other key the food already has.
  function microRow(key='',value=''){
    const keys=[...new Set([...F.COMMON_MICROS,...(key?[key]:[])])];
    const select=el('select',{},...keys.map(k=>el('option',{value:k,textContent:info(k).label+' · '+info(k).unit})));if(key)select.value=key;
    const amount=el('input',{type:'number',min:'0',max:'100000',step:'any',inputMode:'decimal',value:String(value)}),remove=el('button',{type:'button',className:'btn icon-only',textContent:'×'});
    remove.setAttribute('aria-label','Remove vitamin or mineral');
    const basis=$('foodBasis').value,row=el('div',{className:'portion-row'},el('label',{className:'field'},'Vitamin or mineral',select),el('label',{className:'field'},el('span',{className:'micro-unit',textContent:basis==='portion'?'Per portion':'Per 100 '+basis}),amount),remove);
    remove.addEventListener('click',()=>row.remove());return row;
  }
  function slug(name){
    const base=F.fold(name).replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'food';
    for(;;){const id=base+'-'+Math.random().toString(16).slice(2,6);if(!S().foods.some(f=>f.id===id))return id;}
  }
  $('foodBasis').addEventListener('change',basisChanged);
  // Typical values are estimates; label and menu values are published figures.
  $('foodSource').addEventListener('change',()=>{$('foodEstimate').checked=$('foodSource').value==='typical';});
  $('addPortion').addEventListener('click',()=>{const row=portionRow();$('portionRows').append(row);basisChanged();row.querySelector('input').focus();});
  $('foodForm').addEventListener('submit',event=>{
    event.preventDefault();
    const current=S().foods.find(f=>f.id===editingFoodId),basis=$('foodBasis').value;
    try{
      const nutrients=Object.fromEntries(nutrientInputs.map(([key,input])=>{
        const value=input.value.trim();if(value==='')return [key,null];
        const number=Number(value);if(!Number.isFinite(number))throw new Error(info(key).label+' must be a number.');return [key,number];
      }));
      const portions=[...$('portionRows').children].map(row=>{const [label,amount]=row.querySelectorAll('input');return {label:label.value.trim(),amount:amount.value.trim()};})
        .filter(p=>p.label||p.amount).map(p=>({label:p.label,amount:Number(p.amount)}));
      const micros={};
      for(const row of $('microRows').children){
        const key=row.querySelector('select').value,value=row.querySelector('input').value.trim();if(value==='')continue;
        if(key in micros)throw new Error(info(key).label+' is listed twice.');
        const number=Number(value);if(!Number.isFinite(number))throw new Error(info(key).label+' must be a number.');micros[key]=number;
      }
      const food=F.food({id:current?.id||slug($('foodName').value),name:$('foodName').value,brand:$('foodBrand').value,kind:$('foodKind').value,basis,nutrients,
        micros,portions,source:$('foodSource').value,estimate:$('foodEstimate').checked,note:$('foodNote').value,freeSugars:$('foodFreeSugars').value||null,
        details:current?.details,inFile:current?.inFile,archived:current?.archived,favourite:current?.favourite});
      if(current)S().foods[S().foods.indexOf(current)]=food;else S().foods.push(food);
      save();$('foodDialog').close();
      if(foodThen==='log')chooseFood(food);
      else{renderFoods();if($('foodSheet').open)openSheet(food.id);toast(current?'Food saved.':'Food added.');}
    }catch(error){$('foodError').textContent=error.message;}
  });

  /* Foods screen and food sheet. */
  function renderFoods(){
    const list=$('foodList'),c=S().settings.catalog,foods=S().foods;
    const found=F.search(S(),{query:$('foodSearch').value.trim(),archived:$('showArchived').checked}).filter(f=>!$('showFavourites').checked||f.favourite).sort((a,b)=>a.name.localeCompare(b.name));
    const fromFile=foods.filter(f=>f.inFile).length;
    $('catalogInfo').textContent=c?'Catalog file revision '+(c.revision??'unknown')+(c.updated?', dated '+c.updated:'')+(c.importedAt?', imported '+new Date(c.importedAt).toLocaleDateString():'')+'. '+plural(fromFile,'food')+' from the file, '+(foods.length-fromFile)+' added here.'
      :plural(foods.length,'food')+'. Import a catalog file below, or add foods here.';
    if(!foods.length)$('catalogBox').open=true;
    list.replaceChildren();
    for(const f of found.slice(0,200)){
      const button=el('button',{type:'button',className:'row-btn'},el('span',{className:'main'},el('span',{className:'name'},named(f),...foodTags(f)),
        el('span',{className:'sub',textContent:F.KINDS[f.kind]+' · '+per(f)})));
      button.addEventListener('click',()=>openSheet(f.id));list.append(el('li',{},button));
    }
    if(!found.length)list.append(el('li',{},el('p',{className:'hint',textContent:foods.length?'No food matches.':'No foods yet.'})));
    if(found.length>200)list.append(el('li',{},el('p',{className:'hint',textContent:'Showing 200 of '+found.length+'. Search to narrow the list.'})));
  }
  function flatten(value,prefix,rows){
    if(rows.length>=80)return rows;
    if(value&&typeof value==='object'&&!Array.isArray(value)){for(const [key,inner] of Object.entries(value))flatten(inner,prefix?prefix+' › '+key:key,rows);return rows;}
    const text=Array.isArray(value)?value.map(v=>typeof v==='object'?JSON.stringify(v):String(v)).join(', '):String(value);
    if(text!=='')rows.push([prefix,text]);return rows;
  }
  function openSheet(id){
    const f=S().foods.find(x=>x.id===id);if(!f)return;sheetFoodId=id;
    const body=$('sheetBody'),c=S().settings.catalog;body.replaceChildren();
    $('sheetTitle').textContent=f.name;
    body.append(el('p',{className:'hint',textContent:[f.brand,F.KINDS[f.kind],F.SOURCES[f.source]+(f.estimate?', estimate':''),f.inFile?'in the catalog file':c?'not in the catalog file':null,f.archived?'archived':null,f.favourite?'★ favourite':null,f.freeSugars==='yes'?'sugars count as free sugars':f.freeSugars==='no'?'sugars are not free sugars':null,'logged '+plural(F.usage(S(),f.id),'time')].filter(Boolean).join(' · ')}));
    const table=el('table',{className:'nutrients'},el('caption',{className:'hint',textContent:'Per '+(f.basis==='portion'?'1 portion':F.BASES[f.basis])}));
    const tbody=el('tbody');for(const n of F.NUTRIENTS)tbody.append(el('tr',{},el('th',{scope:'row',textContent:n.label}),el('td',{textContent:f.nutrients[n.key]==null?'unknown':fmt(n.key,f.nutrients[n.key])})));
    for(const [key,value] of Object.entries(f.micros))tbody.append(el('tr',{},el('th',{scope:'row',textContent:info(key).label}),el('td',{textContent:fmt(key,value)})));
    table.append(tbody);body.append(table);
    body.append(el('p',{textContent:f.portions.length?'Portions: '+f.portions.map(p=>p.label+' ('+F.round(p.amount,'g')+(f.basis==='portion'?'':' '+f.basis)+')').join(', ')+'.':'No portions yet. Edit the food to add one, such as the weight of one piece.'}));
    if(f.details?.serving?.note)body.append(el('p',{className:'hint',textContent:'From the catalog file: '+f.details.serving.note}));
    if(f.note)body.append(el('p',{textContent:f.note}));
    const d=f.details||{};
    if(typeof d.ingredients==='string')body.append(el('p',{className:'hint',textContent:'Ingredients: '+d.ingredients}));
    for(const [key,label] of [['allergens_contains','Contains'],['allergens_may_contain','May contain']])if(Array.isArray(d[key])&&d[key].length)body.append(el('p',{className:'hint',textContent:label+': '+d[key].join(', ')+'.'}));
    const rows=flatten(d,'',[]);
    if(rows.length){const list=el('dl',{className:'details'});for(const [key,value] of rows)list.append(el('dt',{textContent:key}),el('dd',{textContent:value}));body.append(el('details',{},el('summary',{textContent:'All catalog file fields'}),list));}
    $('archiveFood').textContent=f.archived?'Unarchive':'Archive';$('favouriteFood').textContent=f.favourite?'Remove from favourites':'Add to favourites';$('favouriteFood').setAttribute('aria-pressed',String(!!f.favourite));
    if(!$('foodSheet').open)$('foodSheet').showModal();
  }
  $('logFood').addEventListener('click',()=>{const f=S().foods.find(x=>x.id===sheetFoodId);if(!f)return;$('foodSheet').close();if(view!=='today')navigate('today');mealOptions($('addMeal'));$('addMeal').value=defaultMeal();$('addSearch').value='';chooseFood(f);});
  $('editFood').addEventListener('click',()=>{const f=S().foods.find(x=>x.id===sheetFoodId);if(f)openFoodForm(f);});
  // Favourites come right after this meal's recent foods when adding.
  $('favouriteFood').addEventListener('click',()=>{
    const f=S().foods.find(x=>x.id===sheetFoodId);if(!f)return;
    if(f.favourite)delete f.favourite;else f.favourite=true;save();renderFoods();openSheet(f.id);toast(f.favourite?'Added to favourites.':'Removed from favourites.');
  });
  $('showFavourites').addEventListener('change',renderFoods);
  $('addMicro').addEventListener('click',()=>{const row=microRow();$('microRows').append(row);row.querySelector('select').focus();});
  $('archiveFood').addEventListener('click',()=>{
    const f=S().foods.find(x=>x.id===sheetFoodId);if(!f)return;
    if(f.archived)delete f.archived;else f.archived=true;save();renderFoods();openSheet(f.id);toast(f.archived?'Archived. It no longer appears when adding food.':'Unarchived.');
  });
  $('deleteFood').addEventListener('click',async()=>{
    const f=S().foods.find(x=>x.id===sheetFoodId);if(!f)return;
    if(!await WorkoutUI.confirm('Delete '+f.name+'?','Logged days keep the values they were logged with. A catalog import with this id adds it again.','Delete food',true))return;
    S().foods=S().foods.filter(x=>x.id!==f.id);save();$('foodSheet').close();renderFoods();toast('Food deleted.');
  });
  $('foodSearch').addEventListener('input',renderFoods);$('showArchived').addEventListener('change',renderFoods);
  $('newFood').addEventListener('click',()=>openFoodForm(null));

  /* Catalog file. */
  const listed=(names,limit=3)=>names.slice(0,limit).join(', ')+(names.length>limit?' and '+(names.length-limit)+' more':'');
  const describeTargets=targets=>targets.map(t=>info(t.key).label.toLowerCase()+(t.kind==='min'?' at least ':' at most ')+fmt(t.key,t.value)).join(', ');
  $('importCatalog').addEventListener('change',async event=>{
    try{
      const raw=await readJSON(event.target);if(!raw)return;
      const before=JSON.stringify(S().foods),result=F.importCatalog(raw,S()),r=result.report;
      if(result.older&&!await WorkoutUI.confirm('Import an older catalog file?','This file is revision '+result.catalog.revision+'. Revision '+S().settings.catalog.revision+' was imported before.','Import older file'))return;
      const parts=[r.added.length+' new',r.updated.length+' updated',r.unchanged.length+' unchanged'];
      if(r.notInFile.length)parts.push(r.notInFile.length+' no longer in the file (kept here: '+listed(r.notInFile)+')');
      if(r.skipped.length)parts.push(r.skipped.length+' skipped ('+r.skipped.slice(0,3).map(s=>s.id+': '+s.reason).join('; ')+')');
      if(r.portionsReset.length)parts.push('portions reset after a unit change: '+listed(r.portionsReset));
      if(r.detailsDropped.length)parts.push('extra fields too large to keep: '+listed(r.detailsDropped));
      if(!await WorkoutUI.confirm('Import catalog file?',parts.join('; ')+'. Logged days keep their values.','Import'))return;
      if(before!==JSON.stringify(S().foods))throw new Error('Foods changed during review. Import cancelled.');
      S().foods=result.foods;S().settings={...S().settings,catalog:{...result.catalog,importedAt:Date.now()}};save();renderFoods();
      if(result.targets?.length&&JSON.stringify(result.targets)!==JSON.stringify(S().settings.targets)){
        const sugar=result.targets.some(t=>t.key===F.FREE)?' The sugar limit applies to free sugars: mark which foods’ sugars are free from Today.':'';
        if(await WorkoutUI.confirm('Use the file’s daily targets?','Set '+describeTargets(result.targets)+'.'+sugar,'Use targets')){S().settings.targets=result.targets;save();fillSettings();}
      }
      toast('Catalog imported: '+r.added.length+' new, '+r.updated.length+' updated.');
    }catch(error){toast(error.message);}
  });
  $('exportCatalog').addEventListener('click',()=>{const c=S().settings.catalog;downloadJSON(F.exportCatalog(S(),Date.now()),'foodlog-catalog'+(c?.revision!=null?'-rev'+c.revision:'')+'.json');});

  /* History. */
  /* 7-day trends: averages per day with food logged, days on target, and the week before for comparison. */
  function renderTrends(){
    const t=F.trends(S(),today()),c=t.current,p=t.previous,box=$('trendRows');box.replaceChildren();
    $('trends').hidden=!c.days;if(!c.days)return;
    $('trendsSummary').textContent=plural(c.days,'day')+' with food logged, '+longDate(c.from)+' to '+longDate(c.to)+'. Averages count only those days'+(p.days?'; the week before had '+plural(p.days,'day')+'.':'.');
    for(const row of c.rows){
      const target=t.targets.find(x=>x.key===row.key),before=p.rows.find(x=>x.key===row.key);
      const facts=[];
      if(target)facts.push((target.kind==='min'?'at least ':'at most ')+fmt(row.key,target.value)+': on target '+row.onTarget+' of '+plural(c.days,'day'));
      if(before.average!=null)facts.push('week before '+fmt(row.key,before.average));
      if(row.partial)facts.push('unknown for some items on '+plural(row.partial,'day'));
      box.append(el('li',{},el('strong',{textContent:info(row.key).label+' · '+fmt(row.key,row.average)+' a day'}),facts.join(' · ')));
    }
  }
  function renderHistory(){
    renderTrends();
    const days=F.loggedDays(S()),list=$('dayList');list.replaceChildren();$('historyEmpty').hidden=!!days.length;
    for(const date of days.slice(0,historyLimit)){
      const d=F.day(S(),date),chips=el('span',{className:'chips'});
      for(const t of d.targets){const chip=el('span',{className:'chip',textContent:info(t.key).label+' '+fmt(t.key,t.current)+(t.status==='met'?' ✓':t.status==='over'?' over':'')});chip.dataset.status=t.status;chips.append(chip);}
      const button=el('button',{type:'button',className:'row-btn'},el('span',{className:'main'},el('span',{className:'name',textContent:dayName(date)+' · '+longDate(date)}),
        el('span',{className:'sub',textContent:fmt('energy_kcal',d.total.sums.energy_kcal)+' · '+plural(d.total.count,'item')}),d.targets.length&&chips));
      button.addEventListener('click',()=>{viewDate=date;followToday=date===today();navigate('today',false);});list.append(el('li',{},button));
    }
    $('olderDays').hidden=days.length<=historyLimit;
  }
  $('olderDays').addEventListener('click',()=>{historyLimit+=60;renderHistory();});

  /* Copy a meal from the last 14 days: the same meal first. Foods still in the catalog log at today's values. */
  function openCopy(meal){
    const list=$('copyList'),meals=F.recentMeals(S(),viewDate,meal).slice(0,12);list.replaceChildren();
    $('copyTitle').textContent='Copy into '+meal;
    $('copyHint').textContent=meals.length?'Meals from the 14 days before '+longDate(viewDate)+'. Copied items keep their amounts, portions and notes.':'No meals in the 14 days before '+longDate(viewDate)+'.';
    for(const source of meals){
      const names=source.entries.map(e=>named(S().versions[e.version])),button=el('button',{type:'button',className:'row-btn'},
        el('span',{className:'main'},el('span',{className:'name',textContent:dayName(source.date)+' · '+source.meal}),el('span',{className:'sub',textContent:names.slice(0,4).join(', ')+(names.length>4?' and '+(names.length-4)+' more':'')})),
        el('span',{className:'side',textContent:fmt('energy_kcal',source.total.sums.energy_kcal)}));
      button.addEventListener('click',()=>{
        try{
          const copied=F.copyMeal(S(),source,viewDate,meal,()=>newId('e-')),ids=new Set(copied.map(e=>e.id)),ok=save();
          $('copyDialog').close();renderToday();
          toast((ok?'Copied ':'Copied in memory only: ')+plural(copied.length,'item')+' into '+meal+'.',{label:'Undo',run:()=>{S().entries=S().entries.filter(e=>!ids.has(e.id));F.prune(S());save();render();}});
        }catch(error){toast(error.message);}
      });
      list.append(el('li',{},button));
    }
    $('copyDialog').showModal();(list.querySelector('button')||$('copyDialog').querySelector('[data-close]')).focus();
  }

  /* Mark foods' sugars as free or not; totals on every day follow the mark. */
  function openSugars(foods){
    const list=$('sugarList');list.replaceChildren();
    for(const f of foods){
      const row=el('div',{className:'sugar-row'},el('span',{},named(f),el('span',{className:'sub',textContent:'Sugars '+fmt('sugars_g',f.nutrients.sugars_g)+' per '+(f.basis==='portion'?'portion':F.BASES[f.basis])})));
      const choices=el('span',{className:'choices'});
      for(const [value,label] of [['yes','Free'],['no','Not free']]){
        const b=el('button',{type:'button',className:'btn',textContent:label});b.setAttribute('aria-label',label+': '+named(f));
        const sync=()=>b.setAttribute('aria-pressed',String(f.freeSugars===value));sync();
        b.addEventListener('click',()=>{f.freeSugars=value;save();for(const other of choices.children)other.setAttribute('aria-pressed',String(other===b));renderToday();});
        choices.append(b);
      }
      row.append(choices);list.append(el('li',{},row));
    }
    $('sugarDialog').showModal();list.querySelector('button')?.focus();
  }

  /* Settings. */
  function targetRow(t){
    const key=el('select',{},...F.TARGET_KEYS.map(k=>el('option',{value:k,textContent:info(k).label+(k==='energy_kcal'?' (kcal)':'')}))),kind=el('select',{},el('option',{value:'min',textContent:'at least'}),el('option',{value:'max',textContent:'at most'}));
    const value=el('input',{type:'number',min:'0.1',max:'100000',step:'any',inputMode:'decimal',required:true,value:t.value==null?'':String(t.value)}),remove=el('button',{type:'button',className:'btn icon-only',textContent:'×'});
    key.value=t.key;kind.value=t.kind;remove.setAttribute('aria-label','Remove target');
    const row=el('div',{className:'target-row'},el('label',{className:'field'},'Nutrient',key),el('label',{className:'field target-kind'},'Type',kind),el('label',{className:'field'},'Amount',value),remove);
    remove.addEventListener('click',()=>row.remove());return row;
  }
  function fillSettings(){
    $('targetRows').replaceChildren(...S().settings.targets.map(targetRow));
    $('mealNames').value=S().settings.meals.join('\n');$('dayStart').value=S().settings.dayStart;
  }
  $('addTarget').addEventListener('click',()=>{
    const used=[...$('targetRows').querySelectorAll('select:first-of-type')].map(s=>s.value),key=F.TARGET_KEYS.find(k=>!used.includes(k));
    if(!key){toast('Every nutrient already has a target.');return;}
    const row=targetRow({key,kind:'min',value:null});$('targetRows').append(row);row.querySelector('input').focus();
  });
  $('targetsForm').addEventListener('submit',event=>{
    event.preventDefault();if(!$('targetsForm').reportValidity())return;
    try{
      const targets=[...$('targetRows').children].map(row=>{const [key,kind]=row.querySelectorAll('select');return {key:key.value,kind:kind.value,value:row.querySelector('input').valueAsNumber};});
      S().settings=F.settings({...S().settings,targets});$('targetsStatus').textContent=save()?'Targets saved.':'Targets are in memory only. Download a backup before closing.';
    }catch(error){$('targetsStatus').textContent=error.message;}
  });
  $('mealsForm').addEventListener('submit',event=>{
    event.preventDefault();if(!$('mealsForm').reportValidity())return;
    try{
      const meals=$('mealNames').value.split('\n').map(m=>m.trim()).filter(Boolean);
      S().settings=F.settings({...S().settings,meals,dayStart:$('dayStart').value});$('mealsStatus').textContent=save()?'Meals saved. Logged items keep their meal names.':'Meals are in memory only. Download a backup before closing.';
    }catch(error){$('mealsStatus').textContent=error.message;}
  });

  /* Settings: the shared status card and Backups & cloud storage panel. */
  function exportBackup(){storage.local.flush();downloadJSON(storage.backup(),'foodlog-backup-'+new Date().toISOString().slice(0,10)+'.json');if(!WorkoutStorage.recordFileBackup('foodlog.v1'))toast('Backup downloaded; its date could not be saved.');renderStorage();}
  function openStorage(target){
    $('storage-options').open=true;
    const node=panel.open(target)||$('storage-options').querySelector('summary');node.scrollIntoView({block:'nearest'});node.focus();
  }
  function renderStatus(){
    if(!storage)return;
    WorkoutStorage.renderStorageSummary($('storage-summary'),WorkoutStorage.summaryInput({local:storage.local,remote:storage.remote,status:remoteStatus,busy:cloudBusy||panel?.saving,
      revision:S().updatedAt,fileAt:WorkoutStorage.fileBackupAt('foodlog.v1')}),
    {download:exportBackup,details:()=>openStorage(),configure:()=>openStorage('configure'),backup:()=>storage.remote.remoteBackup(),retry:()=>storage.remote.remoteBackup(),
      review:()=>openStorage('review'),resume:async()=>{await storage.remote.remotePublishLocal();renderStorage();},error:error=>toast(error.message)});
  }
  function renderStorage(){if(!storage||!panel)return;panel.refresh();renderStatus();}
  const persistence=WorkoutStorage.createPersistence({askedKey:'foodlog.v1.persist-asked',onChange:()=>panel?.refresh()});
  panel=WorkoutStorage.createStoragePanel({appName:'Foodlog',namespace:'foodlog.v1',remote:storage.remote,persistence,confirm:WorkoutUI.confirm,toast,download:downloadJSON,onChange:renderStatus,
    backup:{contents:'foods, logged items, day notes and settings',size:()=>new Blob([JSON.stringify(S())]).size,download:exportBackup,restore:raw=>storage.restore(raw),
      fileAt:()=>WorkoutStorage.fileBackupAt('foodlog.v1'),hasData:()=>S().entries.length>0||S().foods.length>0},
    recovery:{restore:raw=>storage.restore(raw),describe:raw=>Array.isArray(raw.entries)?'It holds '+raw.entries.length+' logged items.':''}});
  panel.mount($('storagePanel'));persistence.refresh();

  /* Navigation. */
  function render(){if(view==='today')renderToday();else if(view==='foods')renderFoods();else if(view==='history')renderHistory();}
  function navigate(target,resetDay=true){
    if(target==='today'&&resetDay){viewDate=today();followToday=true;}
    view=target;for(const id of ['today','foods','history','settings'])$(id).hidden=id!==target;
    document.documentElement.classList.toggle('setup-screen',target==='today');shell.update(target,false,false);
    if(target==='settings')renderStorage();render();updates?.refresh();window.scrollTo(0,0);
  }
  shell=WorkoutUI.createShell({name:'Foodlog',items:[{id:'today',label:'Today',icon:'today'},{id:'foods',label:'Foods',icon:'foods'},{id:'history',label:'History',icon:'history'},{id:'settings',label:'Settings',icon:'settings'}],onNavigate:navigate});
  const themeSelect=$('themeChoice');
  for(const theme of WorkoutUI.themes)themeSelect.append(el('option',{value:theme.id,textContent:theme.label}));
  let theme='system';try{theme=localStorage.getItem('foodlog.ui.theme')||theme;}catch{}
  themeSelect.value=WorkoutUI.applyTheme(theme);
  themeSelect.addEventListener('change',()=>{WorkoutUI.applyTheme(themeSelect.value);try{localStorage.setItem('foodlog.ui.theme',themeSelect.value);}catch{toast('Theme changed for this visit. Device storage is unavailable.');}});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>WorkoutUI.applyTheme(themeSelect.value));
  WorkoutUI.attachSteppers($('amountPane'));
  $('prevDay').addEventListener('click',()=>{viewDate=F.shiftDate(viewDate,-1);followToday=false;renderToday();});
  $('nextDay').addEventListener('click',()=>{if(viewDate<today()){viewDate=F.shiftDate(viewDate,1);followToday=viewDate===today();renderToday();}});
  $('addFood').addEventListener('click',()=>openAdd());
  for(const id of ['dayNotes','dayActivity'])$(id).addEventListener('change',saveDayNotes);
  $('exportDay').addEventListener('click',()=>downloadJSON(F.exportDay(S(),viewDate),'food_log_'+viewDate+'.json'));

  /* Day file import: a preview lists every item's outcome, then the file is added to the day or replaces it. */
  const howText={id:'catalog, by id',name:'catalog, by name',values:'catalog, by matching values'};
  const parts=()=>({foods:S().foods,versions:S().versions,entries:S().entries,days:S().days});
  function importAmount(it){return it.food.basis==='portion'?(it.amount===1?'1 portion':F.round(it.amount,'g')+' portions'):F.round(it.amount,'g')+' '+F.UNITS[it.food.basis];}
  function importChoice(p){
    return new Promise(resolve=>{
      const body=$('importBody'),actions=$('importActions'),dialog=$('importDialog');let settled=false;
      const finish=value=>{if(settled)return;settled=true;if(dialog.open)dialog.close();resolve(value);};
      body.replaceChildren();actions.replaceChildren();
      $('importTitle').textContent='Import '+dayName(p.date)+' · '+longDate(p.date)+'?';
      const items=p.meals.flatMap(m=>m.items),linked=items.filter(i=>howText[i.how]).length;
      body.append(el('p',{textContent:plural(p.items,'item')+' in '+plural(p.meals.length,'meal')+': '+linked+' from your catalog, '+plural(p.newFoods.length,'new food')+(p.skipped.length?', '+p.skipped.length+' skipped':'')+'.'}));
      if(p.existing)body.append(el('p',{className:'notice',textContent:'This day already has '+plural(p.existing,'logged item')+'. Add the file to them, or replace them.'}));
      const [kcal,protein]=p.check;
      if(p.items){
        const agree=kcal.file==null||(Math.abs(kcal.items-kcal.file)<=Math.max(kcal.file*0.01,1)&&(protein.file==null||Math.abs(protein.items-protein.file)<=Math.max(protein.file*0.01,0.5)));
        body.append(el('p',{className:agree?'hint':'notice',textContent:'Items add up to '+fmt('energy_kcal',kcal.items)+' and '+fmt('protein_g',protein.items)+' protein.'+(kcal.file==null?'':' The file’s day total says '+fmt('energy_kcal',kcal.file)+(protein.file==null?'':' and '+fmt('protein_g',protein.file))+(agree?'.':'; check the file.'))}));
      }
      for(const m of p.meals){
        body.append(el('h3',{textContent:m.meal}));
        const list=el('ul',{className:'import-list'});
        for(const it of m.items){
          const target=howText[it.how]?named(it.food)+' ('+howText[it.how]+')':it.how==='again'?'the new food above':'new food'+(it.food.estimate?' (estimate)':'');
          const extra=(it.differs?'; the file’s values differ from the catalog, so the day keeps the file’s':'')+(it.filled.length?'; the file fills '+it.filled.map(k=>info(k).label.toLowerCase()).join(', '):'');
          list.append(el('li',{},it.name+' · '+importAmount(it)+(it.time?' · '+it.time:''),el('span',{className:'sub',textContent:'→ '+target+extra})));
        }
        body.append(list);
      }
      if(p.skipped.length){body.append(el('h3',{textContent:'Skipped'}));const list=el('ul',{className:'import-list'});for(const x of p.skipped)list.append(el('li',{},[x.meal,x.item].filter(Boolean).join(' · ')||'Meal',el('span',{className:'sub',textContent:x.reason})));body.append(list);}
      const notes=[];
      if(p.ignored.length)notes.push('Not imported: '+p.ignored.join(', ')+'.');
      if(p.shortened)notes.push('Notes or activity were shortened to fit.');
      if(items.some(i=>!i.time))notes.push('Items without a time keep the file’s order.');
      if(notes.length)body.append(el('p',{className:'hint',textContent:notes.join(' ')}));
      const button=(label,value,cls='btn')=>{const b=el('button',{type:'button',className:cls,textContent:label});b.addEventListener('click',()=>finish(value));actions.append(b);return b;};
      button('Cancel',null);
      if(p.items&&p.existing){button('Add to the day','add');button('Replace the day','replace','btn btn-danger-solid');}
      else if(p.items)button('Import day','replace','btn btn-primary');
      dialog.addEventListener('close',()=>finish(null),{once:true});
      // Focus Cancel without scrolling, so the summary at the top stays in view.
      dialog.showModal();actions.querySelector('button').focus({preventScroll:true});dialog.scrollTop=0;
    });
  }
  $('importDayButton').addEventListener('click',()=>$('importDay').click());
  $('importDay').addEventListener('change',async event=>{
    try{
      const raw=await readJSON(event.target);if(!raw)return;
      const taken=new Set(S().foods.map(f=>f.id));
      const foodId=name=>{const base=F.fold(name).replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'food';for(;;){const id=base+'-'+Math.random().toString(16).slice(2,6);if(!taken.has(id)){taken.add(id);return id;}}};
      const plan=F.planDayImport(raw,S(),foodId),before=JSON.stringify(parts());
      const mode=await importChoice(plan);if(!mode)return;
      if(before!==JSON.stringify(parts()))throw new Error('The log changed during review. Import cancelled.');
      F.applyDayImport(S(),plan,mode,()=>newId('e-'));const ok=save(),after=JSON.stringify(parts());
      viewDate=plan.date;followToday=plan.date===today();navigate('today',false);
      toast((ok?'Imported ':'Imported in memory only: ')+plural(plan.items,'item')+' for '+longDate(plan.date)+'.',{label:'Undo',run:()=>{
        if(JSON.stringify(parts())!==after){toast('The log changed after the import, so it cannot be undone.');return;}
        Object.assign(S(),JSON.parse(before));save();render();toast('Import undone.');
      }});
    }catch(error){toast(error.message);}
  });

  /* File formats and samples: the samples come from the same builders as real exports. */
  function formatHelp(section){
    const files=F.samples(F.shiftDate(today(),-1)),body=$('formatBody');
    const code=obj=>el('pre',{className:'code',tabIndex:0},el('code',{textContent:JSON.stringify(obj,null,2)}));
    const rows=list=>{const tbody=el('tbody');for(const [field,use] of list)tbody.append(el('tr',{},el('td',{},el('code',{textContent:field})),el('td',{textContent:use})));return el('table',{className:'fields'},tbody);};
    body.replaceChildren(
      el('h3',{id:'format-day',textContent:'Day file'}),
      el('p',{className:'hint',textContent:'Import day file reads Foodlog’s own day export, or a file with the same shape. Each item links to a catalog food by food_id, else by exact name (brand and name, ignoring case and accents), else by values that match a food within 2% for that amount. Otherwise a new food is added from the item’s values. A preview lists every item before anything changes.'}),
      rows([['date','Required: the day, as YYYY-MM-DD.'],['notes','Optional text; the first 2,000 characters are kept.'],['activity','Optional list of lines, or one text; the first 500 characters are kept.'],
        ['meals[]','Required. The day keeps this order. A name matching your meal list (ignoring case) uses your spelling.'],['meals[].items[]','Required: what was eaten.'],
        ['items[].item','Required name, at most 120 characters.'],['items[].food_id','Optional catalog id. Foodlog’s day export writes it.'],
        ['items[].amount_g, amount_ml or amount','Required: grams, millilitres, or a count such as "1 portion". Grams and millilitres count as equal.'],
        ['items[].nutrition','Values eaten for this amount: energy_kcal, protein_g, carbohydrate_g, sugars_g, fibre_g, fat_g, saturated_fat_g, salt_g (energy_kj optional). null or missing means unknown.'],
        ['items[].time','Optional HH:MM, or meals[].time for the whole meal. Without one the item has no time.'],
        ['items[].portion, assumption','Optional portion label (40 characters) and note (300 characters).'],
        ['items[].source','Optional. For a new food, “menu” or “restaurant” marks menu values; “typical” or “estimate” marks estimates.'],
        ['day_total_eaten','Optional. The preview compares its energy and protein with the items.'],['targets, subtotal, day_summary, timing','Not imported.']]),
      code(files.day),
      el('h3',{id:'format-catalog',textContent:'Catalog file'}),
      el('p',{className:'hint',textContent:'Catalog import reads schema 1.x and merges foods by id: label values come from the file, while portions added here and archived foods stay. Fields Foodlog does not use are kept and written back on export.'}),
      rows([['schema_version','Required, 1.x.'],['revision','Optional number. Importing a lower revision than before asks first.'],
        ['personal_budgets_per_day','Optional. contribution keys become “at least” targets and limit keys “at most” targets; sugar limits are skipped.'],
        ['products[].id, name, brand','Id (letters, digits, . - _) and name required; brand optional.'],
        ['products[].nutrition_per_100g, _100ml or _portion','Exactly one table, with the nutrition keys above. null means unknown.'],
        ['products[].serving','unit_weight_g, powder_g or unit_volume_ml become portions.'],['products[].foodlog','Written by Foodlog: kind, source, estimate, portions, note, archived.'],
        ['Other fields','Kept per food and written back on export.']]),
      code(files.catalog));
    if(!$('formatDialog').open)$('formatDialog').showModal();
    if(section==='catalog')$('format-catalog').scrollIntoView({block:'start'});else $('formatDialog').scrollTop=0;
  }
  $('dayFormat').addEventListener('click',()=>formatHelp('day'));$('catalogFormat').addEventListener('click',()=>formatHelp('catalog'));
  $('sampleDay').addEventListener('click',()=>{const date=F.shiftDate(today(),-1);downloadJSON(F.samples(date).day,'foodlog-sample-day-'+date+'.json');toast('Sample day file downloaded.');});
  $('sampleCatalog').addEventListener('click',()=>{downloadJSON(F.samples(F.shiftDate(today(),-1)).catalog,'foodlog-sample-catalog.json');toast('Sample catalog file downloaded.');});
  updates=WorkoutUpdates.create({workerUrl:'service-worker.js',isActive:()=>false,flush:()=>storage.save(false),onChange:state=>{if(updates)WorkoutUpdates.render($('updatesPanel'),updates,state);}});
  WorkoutUpdates.render($('updatesPanel'),updates);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){storage.local.flush();return;}if(followToday&&viewDate!==today()){viewDate=today();if(view==='today')renderToday();}storage.remote.remoteStartupSync();});
  window.addEventListener('pagehide',()=>storage.local.flush());
  window.addEventListener('online',()=>storage.remote.remoteStartupSync());
  // Another app on this site saved or forgot the shared connection.
  window.addEventListener('storage',event=>{if(event.key===WorkoutStorage.SHARED_CONNECTION_KEY){panel.reload();renderStatus();}});
  fillSettings();localStatus();navigate('today');
  storage.remote.remoteStartupSync();
})();
