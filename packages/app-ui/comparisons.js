/* Side-by-side results; missing readings are never presented as zero. */
/* exported WorkoutComparisons */
const WorkoutComparisons = (()=>{
  function render(container,options){
    if(!container)return;container.replaceChildren();const items=options.items;if(!items.length)return;if(items.length<2&&!options.compact)return;
    container.className='comparison-panel';const title=document.createElement('h3');title.textContent=options.compact?'Compared with your previous session':'Compare two workouts';container.append(title);
    let first=items.find(item=>item.id===options.first)||items[0];
    const candidates=options.candidates?options.candidates(first):items;
    let second=candidates.find(item=>item.id===options.second&&item.id!==first.id)||candidates.filter(item=>item.id!==first.id&&(!options.compact||item.startedAt<first.startedAt)).sort((a,b)=>b.startedAt-a.startedAt)[0];
    const selectors=document.createElement('div');selectors.className='comparison-selectors';if(!options.compact)container.append(selectors);
    for(const [id,label,list,selected]of [['compareFirst','Workout A',items,first],['compareSecond','Workout B',candidates,second]]){
      const field=document.createElement('label');field.className='field';field.textContent=label;
      const select=document.createElement('select');select.id=id;
      for(const item of list){if(id==='compareSecond'&&item.id===first.id)continue;const option=document.createElement('option');option.value=item.id;option.textContent=options.label(item);option.selected=item.id===selected?.id;select.append(option);}
      select.addEventListener('change',()=>{options.onSelect(id==='compareFirst'?select.value:first.id,id==='compareSecond'?select.value:second?.id);});field.append(select);selectors.append(field);
    }
    if(!second){const hint=document.createElement('p');hint.textContent=options.compact?'No earlier matching session yet. Future sessions with the same setup will appear here.':'No other workout matches this setup. Choose a different workout.';container.append(hint);return;}
    const model=options.compare(first,second),notes=document.createElement('div');
    const previous=document.createElement('p');previous.className='hint';previous.textContent='Previous: '+options.label(model.before);container.append(previous);
    for(const detail of model.details||[]){const p=document.createElement('p');p.className='hint';p.textContent=detail;notes.append(p);}
    for(const warning of model.warnings||[]){const p=document.createElement('p');p.className='hint';p.textContent=warning;notes.append(p);}
    const format=value=>value==null||!Number.isFinite(Number(value))?'Unknown':Number(value).toLocaleString(undefined,{maximumFractionDigits:2});
    const highlights=document.createElement('div');highlights.className='comparison-highlights';container.append(highlights);
    for(const row of [...model.rows.filter(row=>row.after!=null),...model.rows.filter(row=>row.after==null)].slice(0,3)){const card=document.createElement('div');card.className='comparison-highlight';const label=document.createElement('span');label.textContent=row.label;const value=document.createElement('strong');value.textContent=format(row.after)+(row.after==null?'':' '+row.unit);const delta=document.createElement('span');delta.textContent=row.delta==null?'No comparable difference':(row.delta>0?'+':'')+format(row.delta)+' '+row.unit+' from previous';card.append(label,value,delta);highlights.append(card);}
    const details=document.createElement('details');details.className='comparison-details';details.open=false;const summary=document.createElement('summary');summary.textContent='Detailed comparison & notes';details.append(summary,notes);container.append(details);
    const wrap=document.createElement('div');wrap.className='comparison-scroll';details.append(wrap);
    const table=document.createElement('table');table.className='comparison-table';const caption=document.createElement('caption');caption.textContent='Earlier to later: '+options.label(model.before)+' → '+options.label(model.after);table.append(caption);
    const head=document.createElement('tr');for(const label of ['Measure','Earlier','Later','Difference']){const th=document.createElement('th');th.scope='col';th.textContent=label;head.append(th);}table.append(head);
    for(const row of model.rows){const tr=document.createElement('tr');for(const [index,text]of [row.label+(row.unit?' ('+row.unit+')':''),format(row.before),format(row.after),row.delta==null?'—':(row.delta>0?'+':'')+format(row.delta)].entries()){const cell=document.createElement(index===0?'th':'td');if(index===0)cell.scope='row';cell.textContent=text;tr.append(cell);}table.append(tr);}wrap.append(table);
  }
  return {render};
})();
