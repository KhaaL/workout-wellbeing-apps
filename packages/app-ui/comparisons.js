/* Side-by-side results; missing readings are never presented as zero. */
/* exported WorkoutComparisons */
const WorkoutComparisons = (()=>{
  function render(container,options){
    if(!container)return;container.replaceChildren();const items=options.items;if(items.length<2)return;
    container.className='comparison-panel';const title=document.createElement('h3');title.textContent='Compare two workouts';container.append(title);
    let first=items.find(item=>item.id===options.first)||items[0];
    const candidates=options.candidates?options.candidates(first):items;
    let second=candidates.find(item=>item.id===options.second&&item.id!==first.id)||candidates.find(item=>item.id!==first.id);
    const selectors=document.createElement('div');selectors.className='comparison-selectors';container.append(selectors);
    for(const [id,label,list,selected]of [['compareFirst','Workout A',items,first],['compareSecond','Workout B',candidates,second]]){
      const field=document.createElement('label');field.className='field';field.textContent=label;
      const select=document.createElement('select');select.id=id;
      for(const item of list){if(id==='compareSecond'&&item.id===first.id)continue;const option=document.createElement('option');option.value=item.id;option.textContent=options.label(item);option.selected=item.id===selected?.id;select.append(option);}
      select.addEventListener('change',()=>{options.onSelect(id==='compareFirst'?select.value:first.id,id==='compareSecond'?select.value:second?.id);});field.append(select);selectors.append(field);
    }
    if(!second){const hint=document.createElement('p');hint.textContent='No other workout matches this routine. Choose a different workout.';container.append(hint);return;}
    const model=options.compare(first,second);
    for(const detail of model.details||[]){const p=document.createElement('p');p.className='hint';p.textContent=detail;container.append(p);}
    for(const warning of model.warnings||[]){const p=document.createElement('p');p.className='hint';p.textContent=warning;container.append(p);}
    const wrap=document.createElement('div');wrap.className='comparison-scroll';container.append(wrap);
    const table=document.createElement('table');table.className='comparison-table';const caption=document.createElement('caption');caption.textContent='Earlier to later: '+options.label(model.before)+' → '+options.label(model.after);table.append(caption);
    const head=document.createElement('tr');for(const label of ['Measure','Earlier','Later','Difference']){const th=document.createElement('th');th.scope='col';th.textContent=label;head.append(th);}table.append(head);
    const format=value=>value==null||!Number.isFinite(Number(value))?'Unknown':Number(value).toLocaleString(undefined,{maximumFractionDigits:2});
    for(const row of model.rows){const tr=document.createElement('tr');for(const [index,text]of [row.label+(row.unit?' ('+row.unit+')':''),format(row.before),format(row.after),row.delta==null?'—':(row.delta>0?'+':'')+format(row.delta)].entries()){const cell=document.createElement(index===0?'th':'td');if(index===0)cell.scope='row';cell.textContent=text;tr.append(cell);}table.append(tr);}wrap.append(table);
  }
  return {render};
})();
