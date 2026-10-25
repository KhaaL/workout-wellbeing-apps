/* Foodlog composition: screens, dialogs and saving through the shared engine. */
(() => {
  'use strict';
  const F=FoodCore,$=id=>document.getElementById(id);
  const info=Object.fromEntries(F.NUTRIENTS.map(n=>[n.key,n]));
  const fmt=(key,value)=>F.format(value,info[key].unit);
  const named=f=>f.brand?f.brand+' '+f.name:f.name;
  const plural=(n,word)=>n+' '+word+(n===1?'':'s');
  const el=(tag,props={},...children)=>{const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(c=>c!=null&&c!==false));return node;};
  const newId=prefix=>prefix+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  let storage=null,shell=null,updates=null,view='today',viewDate='',followToday=true,toastTimer=0,cloudBusy=false,configBusy=false;
  let historyLimit=60,sheetFoodId=null,editingEntryId=null,amountFood=null,selectedPortion='',editingFoodId=null,foodThen=null;
  const S=()=>storage.state;

  function toast(message,action){
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
    onRemoteStatus:(status,message)=>{$('cloudStatus').textContent=message||'Cloud storage is not configured.';},
    onBusy:busy=>{cloudBusy=busy;renderCloud();},onRefresh:()=>renderCloud(),
    onRestore:()=>{for(const id of ['addDialog','foodDialog','foodSheet'])if($(id).open)$(id).close();fillSettings();render();renderCloud();localStatus();}});

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
      const n=info[target.key],row=el('div',{className:'target'}),fill=el('span');
      row.dataset.status=target.status;fill.style.width=Math.min(100,Math.round(target.share*100))+'%';
      row.append(el('span',{textContent:n.label+(target.kind==='min'?' · at least':' · at most')}),
        el('span',{className:'value',textContent:F.round(target.current,n.unit)+' / '+fmt(target.key,target.value)}),
        el('span',{className:'bar'},fill),el('span',{className:'state',textContent:targetState(target)}));
      row.setAttribute('aria-label',n.label+': '+fmt(target.key,target.current)+' of '+(target.kind==='min'?'at least ':'at most ')+fmt(target.key,target.value)+'. '+targetState(target)+'.');
      box.append(row);
    }
    const table=el('table',{className:'nutrients'}),body=el('tbody');
    for(const n of F.NUTRIENTS){
      if(n.key==='energy_kj')continue;
      const missing=t.unknown[n.key];
      body.append(el('tr',{},el('th',{scope:'row',textContent:n.key==='sugars_g'?'Sugars (total, incl. fruit and dairy)':n.label}),
        el('td',{textContent:(missing?'at least ':'')+fmt(n.key,t.sums[n.key])+(missing?' ('+plural(missing,'item')+' unknown)':'')})));
    }
    for(const [key,value] of Object.entries(t.micros))body.append(el('tr',{},el('th',{scope:'row',textContent:F.microLabel(key)}),
      el('td',{textContent:F.format(value,F.microUnit(key))+(t.microUnknown[key]?' (not listed for '+plural(t.microUnknown[key],'item')+')':'')})));
    table.append(body);
    box.append(el('details',{},el('summary',{textContent:'All nutrients'}),table));
  }
  function renderMeals(d){
    const box=$('meals');box.replaceChildren();
    for(const m of d.meals){
      const section=el('section',{className:'panel meal'});section.setAttribute('aria-label',m.meal);
      const sub=m.items.length?fmt('energy_kcal',m.total.sums.energy_kcal)+' · '+fmt('protein_g',m.total.sums.protein_g)+' protein':'';
      section.append(el('div',{className:'meal-head'},el('h2',{textContent:m.meal}),sub&&el('span',{className:'hint',textContent:sub})));
      if(m.items.length){
        const list=el('ul',{className:'entries'});
        for(const {entry,v,amount} of m.items){
          const n=F.scaled(v,amount).nutrients,button=el('button',{type:'button',className:'row-btn'});
          button.append(el('span',{className:'main'},el('span',{className:'name'},named(v),v.estimate&&el('span',{className:'tag',textContent:'est.'})),
            el('span',{className:'sub',textContent:[amountText(v,amount,entry.portion),entry.time,entry.note].filter(Boolean).join(' · ')})),
            el('span',{className:'side',textContent:fmt('energy_kcal',n.energy_kcal)}));
          button.addEventListener('click',()=>openEntry(entry.id));list.append(el('li',{},button));
        }
        section.append(list);
      }
      const add=el('button',{type:'button',className:'btn add-to',textContent:'Add to '+m.meal});add.addEventListener('click',()=>openAdd(m.meal));section.append(add);
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

  /* Adding and editing entries. */
  function mealOptions(select,extra){
    const meals=[...S().settings.meals];if(extra&&!meals.includes(extra))meals.push(extra);
    select.replaceChildren(...meals.map(m=>el('option',{value:m,textContent:m})));
  }
  function defaultMeal(){
    const entries=S().entries.filter(e=>e.date===viewDate).sort((a,b)=>a.time.localeCompare(b.time));
    return entries.length?entries.at(-1).meal:S().settings.meals[0];
  }
  function showPane(pane){$('pickPane').hidden=pane!=='pick';$('amountPane').hidden=pane!=='amount';}
  function per(f){
    const unknown=f.nutrients.energy_kcal==null&&f.nutrients.protein_g==null;
    return 'per '+F.BASES[f.basis]+': '+(unknown?'values unknown':fmt('energy_kcal',f.nutrients.energy_kcal)+' · '+fmt('protein_g',f.nutrients.protein_g)+' protein');
  }
  function foodTags(f){
    const tags=[];if(f.estimate)tags.push('est.');if(f.archived)tags.push('archived');if(!f.inFile&&S().settings.catalog)tags.push('not in file');
    return tags.map(text=>el('span',{className:'tag',textContent:text}));
  }
  function openAdd(meal){
    editingEntryId=null;mealOptions($('addMeal'));$('addMeal').value=meal||defaultMeal();$('addSearch').value='';
    showPane('pick');renderResults();if(!$('addDialog').open)$('addDialog').showModal();$('addSearch').focus();
  }
  function renderResults(){
    const list=$('addResults'),query=$('addSearch').value.trim(),results=F.search(S(),{query,meal:$('addMeal').value});
    list.replaceChildren();
    for(const f of results.slice(0,50)){
      const button=el('button',{type:'button',className:'row-btn'},el('span',{className:'main'},el('span',{className:'name'},named(f),...foodTags(f)),el('span',{className:'sub',textContent:per(f)})));
      button.addEventListener('click',()=>chooseFood(f));list.append(el('li',{},button));
    }
    if(!results.length)list.append(el('li',{},el('p',{className:'hint',textContent:query?'No food matches “'+query+'”.':'No foods yet. Import a catalog file in Foods, or add a new food.'})));
    else if(results.length>50)list.append(el('li',{},el('p',{className:'hint',textContent:'Showing 50 of '+results.length+'. Type more to narrow the list.'})));
    $('addNewFood').textContent=query?'New food “'+query+'”…':'New food…';
  }
  function lastUse(foodId){
    let last=null;for(const e of S().entries)if(F.foodIdOf(e.version)===foodId&&(!last||e.date+e.time>last.date+last.time))last=e;
    return last;
  }
  function chooseFood(f){
    amountFood=f;editingEntryId=null;
    const last=lastUse(f.id),lastBasis=last&&S().versions[last.version].basis===f.basis;
    const start=lastBasis?{amount:last.amount,portion:f.portions.some(p=>p.label===last.portion)?last.portion:''}
      :f.portions[0]?{amount:f.portions[0].amount,portion:f.portions[0].label}:{amount:f.basis==='portion'?1:100,portion:''};
    setupAmount(F.versionOf(f).value,f.portions,{...start,time:nowTime(),meal:$('addMeal').value,note:''});
    showPane('amount');if(!$('addDialog').open)$('addDialog').showModal();$('amount').focus();$('amount').select();
  }
  function openEntry(id){
    const e=S().entries.find(x=>x.id===id);if(!e)return;
    const v=S().versions[e.version],food=S().foods.find(f=>f.id===F.foodIdOf(e.version));
    editingEntryId=id;amountFood=food||null;
    setupAmount(v,food&&food.basis===v.basis?food.portions:[],{amount:e.amount,portion:e.portion||'',time:e.time,meal:e.meal,note:e.note||''});
    showPane('amount');$('addDialog').showModal();$('amount').focus();
  }
  let amountVersion=null;
  function setupAmount(v,portions,values){
    amountVersion=v;selectedPortion=values.portion;
    const unit=v.basis==='portion'?'portions':F.UNITS[v.basis];
    $('amountTitle').textContent=named(v);
    $('amountBasis').textContent='Values per '+F.BASES[v.basis]+(v.estimate?' · estimate':'')+(editingEntryId?' · as logged':'');
    $('amountLabel').textContent='Amount · '+unit;$('amount').setAttribute('aria-label','Amount in '+(unit==='g'?'grams':unit==='ml'?'millilitres':'portions'));
    $('amount').dataset.increment=v.basis==='portion'?'0.5':v.basis==='ml'?'25':'5';
    $('amount').value=String(values.amount);$('entryTime').value=values.time;$('entryNote').value=values.note;
    mealOptions($('entryMeal'),values.meal);$('entryMeal').value=values.meal;
    const chips=$('portionChips');chips.replaceChildren();chips.hidden=!portions.length;
    for(const p of portions){
      const button=el('button',{type:'button',className:'btn',textContent:p.label+' · '+F.round(p.amount,'g')+' '+(v.basis==='portion'?'':F.UNITS[v.basis])});
      button.dataset.label=p.label;button.dataset.amount=String(p.amount);
      button.addEventListener('click',()=>{$('amount').value=String(p.amount);selectedPortion=p.label;renderPreview();});chips.append(button);
    }
    $('amountBack').hidden=!!editingEntryId;$('removeEntry').hidden=!editingEntryId;$('saveEntry').textContent=editingEntryId?'Save':'Add';
    renderPreview();
  }
  function renderPreview(){
    const amount=$('amount').valueAsNumber;
    for(const chip of $('portionChips').children)chip.setAttribute('aria-pressed',String(chip.dataset.label===selectedPortion&&Number(chip.dataset.amount)===amount));
    if(!Number.isFinite(amount)||amount<=0){$('amountPreview').textContent='Enter an amount.';return;}
    const n=F.scaled(amountVersion,amount).nutrients,preview=$('amountPreview');preview.replaceChildren(el('strong',{textContent:fmt('energy_kcal',n.energy_kcal)}));
    for(const key of ['protein_g','carbohydrate_g','fat_g','saturated_fat_g','fibre_g','salt_g'])
      preview.append(' · '+(n[key]==null?info[key].label.toLowerCase()+' unknown':fmt(key,n[key])+' '+info[key].label.toLowerCase()));
  }
  $('amount').addEventListener('input',()=>{const chip=[...$('portionChips').children].find(c=>c.dataset.label===selectedPortion);if(!chip||Number(chip.dataset.amount)!==$('amount').valueAsNumber)selectedPortion='';renderPreview();});
  $('amountPane').addEventListener('submit',event=>{
    event.preventDefault();if(!$('amountPane').reportValidity())return;
    const fields={time:$('entryTime').value,meal:$('entryMeal').value,amount:$('amount').valueAsNumber,portion:selectedPortion,note:$('entryNote').value.trim()};
    try{
      let label;
      if(editingEntryId){F.updateEntry(S(),editingEntryId,fields);label='Saved.';}
      else{
        if(S().entries.length>=F.LIMITS.entries)throw new Error('The log holds at most '+F.LIMITS.entries+' items. Download a backup, then remove old days.');
        F.log(S(),amountFood,{...fields,date:viewDate},newId('e-'));label='Added '+named(amountFood)+' to '+fields.meal+'.';
      }
      const ok=save();$('addDialog').close();
      if(view!=='today')navigate('today');else renderToday();
      toast(ok?label:'Saved in memory only. Download a backup before closing.');
    }catch(error){toast(error.message);}
  });
  $('removeEntry').addEventListener('click',()=>{
    const index=S().entries.findIndex(e=>e.id===editingEntryId);if(index<0)return;
    const [removed]=S().entries.splice(index,1),version=S().versions[removed.version];
    F.prune(S());save();$('addDialog').close();renderToday();
    toast('Removed '+named(version)+'.',{label:'Undo',run:()=>{
      if(S().entries.some(e=>e.id===removed.id))return;
      S().versions[removed.version] ||= version;S().entries.push(removed);save();render();
    }});
  });
  $('amountBack').addEventListener('click',()=>{showPane('pick');renderResults();$('addSearch').focus();});
  $('addSearch').addEventListener('input',renderResults);$('addMeal').addEventListener('change',renderResults);
  $('addNewFood').addEventListener('click',()=>openFoodForm(null,{name:$('addSearch').value.trim(),then:'log'}));
  for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',()=>button.closest('dialog').close());

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
  }
  function openFoodForm(f,{name='',then=null}={}){
    editingFoodId=f?.id||null;foodThen=then;$('foodError').textContent='';
    $('foodFormTitle').textContent=f?'Edit food':'New food';
    $('foodName').value=f?.name??name;$('foodBrand').value=f?.brand??'';$('foodKind').value=f?.kind??'generic';$('foodBasis').value=f?.basis??'g';
    $('foodSource').value=f?.source??'typical';$('foodEstimate').checked=f?f.estimate:true;$('foodNote').value=f?.note??'';
    for(const [key,input] of nutrientInputs)input.value=f?.nutrients[key]==null?'':String(f.nutrients[key]);
    $('portionRows').replaceChildren(...(f?.portions||[]).map(portionRow));
    const serving=f?.details?.serving?.note;$('servingNote').hidden=!serving;$('servingNote').textContent=serving?'From the catalog file: '+serving:'';
    basisChanged();$('foodDialog').showModal();$('foodName').focus();
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
        const number=Number(value);if(!Number.isFinite(number))throw new Error(info[key].label+' must be a number.');return [key,number];
      }));
      const portions=[...$('portionRows').children].map(row=>{const [label,amount]=row.querySelectorAll('input');return {label:label.value.trim(),amount:amount.value.trim()};})
        .filter(p=>p.label||p.amount).map(p=>({label:p.label,amount:Number(p.amount)}));
      const food=F.food({id:current?.id||slug($('foodName').value),name:$('foodName').value,brand:$('foodBrand').value,kind:$('foodKind').value,basis,nutrients,
        micros:current&&current.basis===basis?current.micros:{},portions,source:$('foodSource').value,estimate:$('foodEstimate').checked,note:$('foodNote').value,
        details:current?.details,inFile:current?.inFile,archived:current?.archived});
      if(current)S().foods[S().foods.indexOf(current)]=food;else S().foods.push(food);
      save();$('foodDialog').close();
      if(foodThen==='log')chooseFood(food);
      else{renderFoods();if($('foodSheet').open)openSheet(food.id);toast(current?'Food saved.':'Food added.');}
    }catch(error){$('foodError').textContent=error.message;}
  });

  /* Foods screen and food sheet. */
  function renderFoods(){
    const list=$('foodList'),c=S().settings.catalog,foods=S().foods;
    const found=F.search(S(),{query:$('foodSearch').value.trim(),archived:$('showArchived').checked}).sort((a,b)=>a.name.localeCompare(b.name));
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
    body.append(el('p',{className:'hint',textContent:[f.brand,F.KINDS[f.kind],F.SOURCES[f.source]+(f.estimate?', estimate':''),f.inFile?'in the catalog file':c?'not in the catalog file':null,f.archived?'archived':null,'logged '+plural(F.usage(S(),f.id),'time')].filter(Boolean).join(' · ')}));
    const table=el('table',{className:'nutrients'},el('caption',{className:'hint',textContent:'Per '+(f.basis==='portion'?'1 portion':F.BASES[f.basis])}));
    const tbody=el('tbody');for(const n of F.NUTRIENTS)tbody.append(el('tr',{},el('th',{scope:'row',textContent:n.label}),el('td',{textContent:f.nutrients[n.key]==null?'unknown':fmt(n.key,f.nutrients[n.key])})));
    for(const [key,value] of Object.entries(f.micros))tbody.append(el('tr',{},el('th',{scope:'row',textContent:F.microLabel(key)}),el('td',{textContent:F.format(value,F.microUnit(key))})));
    table.append(tbody);body.append(table);
    body.append(el('p',{textContent:f.portions.length?'Portions: '+f.portions.map(p=>p.label+' ('+F.round(p.amount,'g')+(f.basis==='portion'?'':' '+f.basis)+')').join(', ')+'.':'No portions yet. Edit the food to add one, such as the weight of one piece.'}));
    if(f.details?.serving?.note)body.append(el('p',{className:'hint',textContent:'From the catalog file: '+f.details.serving.note}));
    if(f.note)body.append(el('p',{textContent:f.note}));
    const d=f.details||{};
    if(typeof d.ingredients==='string')body.append(el('p',{className:'hint',textContent:'Ingredients: '+d.ingredients}));
    for(const [key,label] of [['allergens_contains','Contains'],['allergens_may_contain','May contain']])if(Array.isArray(d[key])&&d[key].length)body.append(el('p',{className:'hint',textContent:label+': '+d[key].join(', ')+'.'}));
    const rows=flatten(d,'',[]);
    if(rows.length){const list=el('dl',{className:'details'});for(const [key,value] of rows)list.append(el('dt',{textContent:key}),el('dd',{textContent:value}));body.append(el('details',{},el('summary',{textContent:'All catalog file fields'}),list));}
    $('archiveFood').textContent=f.archived?'Unarchive':'Archive';
    if(!$('foodSheet').open)$('foodSheet').showModal();
  }
  $('logFood').addEventListener('click',()=>{const f=S().foods.find(x=>x.id===sheetFoodId);if(!f)return;$('foodSheet').close();if(view!=='today')navigate('today');mealOptions($('addMeal'));$('addMeal').value=defaultMeal();chooseFood(f);});
  $('editFood').addEventListener('click',()=>{const f=S().foods.find(x=>x.id===sheetFoodId);if(f)openFoodForm(f);});
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
  const describeTargets=targets=>targets.map(t=>info[t.key].label.toLowerCase()+(t.kind==='min'?' at least ':' at most ')+fmt(t.key,t.value)).join(', ');
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
        const sugar=result.ignoredTargets.some(key=>/sugar/.test(key))?' The sugar limit is not applied: labels give total sugars, including fruit and dairy.':'';
        if(await WorkoutUI.confirm('Use the file’s daily targets?','Set '+describeTargets(result.targets)+'.'+sugar,'Use targets')){S().settings.targets=result.targets;save();fillSettings();}
      }
      toast('Catalog imported: '+r.added.length+' new, '+r.updated.length+' updated.');
    }catch(error){toast(error.message);}
  });
  $('exportCatalog').addEventListener('click',()=>{const c=S().settings.catalog;downloadJSON(F.exportCatalog(S(),Date.now()),'foodlog-catalog'+(c?.revision!=null?'-rev'+c.revision:'')+'.json');});

  /* History. */
  function renderHistory(){
    const days=F.loggedDays(S()),list=$('dayList');list.replaceChildren();$('historyEmpty').hidden=!!days.length;
    for(const date of days.slice(0,historyLimit)){
      const d=F.day(S(),date),chips=el('span',{className:'chips'});
      for(const t of d.targets){const chip=el('span',{className:'chip',textContent:info[t.key].label+' '+fmt(t.key,t.current)+(t.status==='met'?' ✓':t.status==='over'?' over':'')});chip.dataset.status=t.status;chips.append(chip);}
      const button=el('button',{type:'button',className:'row-btn'},el('span',{className:'main'},el('span',{className:'name',textContent:dayName(date)+' · '+longDate(date)}),
        el('span',{className:'sub',textContent:fmt('energy_kcal',d.total.sums.energy_kcal)+' · '+plural(d.total.count,'item')}),d.targets.length&&chips));
      button.addEventListener('click',()=>{viewDate=date;followToday=date===today();navigate('today',false);});list.append(el('li',{},button));
    }
    $('olderDays').hidden=days.length<=historyLimit;
  }
  $('olderDays').addEventListener('click',()=>{historyLimit+=60;renderHistory();});

  /* Settings. */
  function targetRow(t){
    const key=el('select',{},...F.TARGET_KEYS.map(k=>el('option',{value:k,textContent:info[k].label+(k==='energy_kcal'?' (kcal)':'')}))),kind=el('select',{},el('option',{value:'min',textContent:'at least'}),el('option',{value:'max',textContent:'at most'}));
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

  /* Backups and cloud storage, as in Tabata. */
  function renderRecovery(){
    const container=$('recoveryCopies');container.replaceChildren();
    for(const [suffix,label] of [['before-remote-restore','Download pre-restore copy'],['unreadable','Download unreadable data']]){
      let raw;try{raw=localStorage.getItem('foodlog.v1.'+suffix);}catch{}if(!raw)continue;
      const button=el('button',{className:'btn',type:'button',textContent:label});button.addEventListener('click',()=>downloadJSON(raw,'foodlog-'+suffix+'.json'));container.append(button);
    }
  }
  function renderCloud(){
    if(!storage)return;
    const remote=storage.remote,cfg=remote.loadRemoteConfig(),paused=remote.remoteSyncPaused();
    $('cloudActions').hidden=!cfg;$('cloudBackup').hidden=paused;$('cloudPause').hidden=paused;$('cloudResume').hidden=!paused;
    $('cloudUseRemote').hidden=remote.syncMode(cfg)==='immutable';
    for(const node of document.querySelectorAll('#cloudForm input,#cloudForm select,#cloudForm button,#cloudActions button'))node.disabled=cloudBusy||configBusy;
    WorkoutStorage.renderConnectionScope($('connectionScope'),remote,{confirm:WorkoutUI.confirm,onChange:()=>{loadCloud();renderCloud();}});
    renderRecovery();WorkoutStorage.renderRemoteTools($('remoteTools'),remote,downloadJSON,'foodlog',['mode','checks','snapshots']);
  }
  function loadCloud(){
    const cfg=storage.remote.loadRemoteConfig();if(!cfg)return;
    for(const [field,name] of [['cloudEndpoint','endpoint'],['cloudRegion','region'],['cloudBucket','bucket'],['cloudObject','objectKey'],['cloudAccess','accessKeyId']])$(field).value=cfg[name]||(name==='objectKey'?storage.remote.defaultObjectKey:'');
    $('cloudPathStyle').checked=cfg.pathStyle;$('cloudMode').value=storage.remote.syncMode(cfg);
  }
  $('exportBackup').addEventListener('click',()=>{storage.local.flush();downloadJSON(storage.backup(),'foodlog-backup.json');});
  $('importBackup').addEventListener('change',async event=>{try{const raw=await readJSON(event.target);if(raw&&await storage.restore(raw))toast('Backup restored. Cloud sync is paused.');}catch(error){toast(error.message);}});
  $('cloudForm').addEventListener('submit',async event=>{
    event.preventDefault();configBusy=true;renderCloud();
    try{const cfg={endpoint:$('cloudEndpoint').value.trim(),region:$('cloudRegion').value.trim(),bucket:$('cloudBucket').value.trim(),objectKey:$('cloudObject').value.trim(),accessKeyId:$('cloudAccess').value.trim(),secretAccessKey:$('cloudSecret').value||storage.remote.loadRemoteConfig()?.secretAccessKey,pathStyle:$('cloudPathStyle').checked,syncMode:$('cloudMode').value};
      if(!cfg.secretAccessKey)throw new Error('Enter the secret access key.');await storage.configure(cfg);$('cloudSecret').value='';
    }catch(error){toast(error.message);}finally{configBusy=false;renderCloud();}
  });
  for(const [id,method] of [['cloudBackup','remoteBackup'],['cloudPause','pauseRemoteSyncAction'],['cloudResume','remoteResumeSync'],['cloudKeepLocal','remotePublishLocal'],['cloudUseRemote','remoteRestore']])$(id).addEventListener('click',async()=>{try{await storage.remote[method]();}catch(error){toast(error.message);}renderCloud();});
  $('cloudForget').addEventListener('click',async()=>{const text=WorkoutStorage.forgetConnectionText(storage.remote);if(await WorkoutUI.confirm(text.title,text.body,'Forget connection',true)){storage.remote.clearRemoteConfig();$('cloudForm').reset();$('cloudSecret').value='';loadCloud();renderCloud();}});

  /* Navigation. */
  function render(){if(view==='today')renderToday();else if(view==='foods')renderFoods();else if(view==='history')renderHistory();}
  function navigate(target,resetDay=true){
    if(target==='today'&&resetDay){viewDate=today();followToday=true;}
    view=target;for(const id of ['today','foods','history','settings'])$(id).hidden=id!==target;
    document.documentElement.classList.toggle('setup-screen',target==='today');shell.update(target,false,false);
    if(target==='settings')renderCloud();render();updates?.refresh();window.scrollTo(0,0);
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
  updates=WorkoutUpdates.create({workerUrl:'service-worker.js',isActive:()=>false,flush:()=>storage.save(false),onChange:state=>{if(updates)WorkoutUpdates.render($('updatesPanel'),updates,state);}});
  WorkoutUpdates.render($('updatesPanel'),updates);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){storage.local.flush();return;}if(followToday&&viewDate!==today()){viewDate=today();if(view==='today')renderToday();}storage.remote.remoteStartupSync();});
  window.addEventListener('pagehide',()=>storage.local.flush());
  window.addEventListener('online',()=>storage.remote.remoteStartupSync());
  // Another app on this site saved or forgot the shared connection.
  window.addEventListener('storage',event=>{if(event.key===WorkoutStorage.SHARED_CONNECTION_KEY){loadCloud();renderCloud();}});
  fillSettings();loadCloud();localStatus();navigate('today');
  storage.remote.remoteStartupSync();
})();
