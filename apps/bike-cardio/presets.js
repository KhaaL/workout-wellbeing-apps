/* Named setup snapshots; applying one never mutates a running workout.
   Workout presets and machines share one picker; each option value is "kind:id". */
/* exported BikePresets */
const BikePresets = {
  mount(host,options){
    const kinds={presets:{group:'Workout presets',noun:'preset'},machines:{group:'Machines',noun:'machine'}};
    let selection='',open=false;
    function render(){
      host.replaceChildren();
      const section=document.createElement('details');section.className='card';section.open=open;section.addEventListener('toggle',()=>{open=section.open;});
      const count=options.get('presets').length+options.get('machines').length;
      const summary=document.createElement('summary');summary.textContent='Saved setups'+(count?' · '+count:'');section.append(summary);
      const help=document.createElement('p');help.className='hint';help.textContent='A preset saves this whole setup: targets, durations and sounds. A machine saves only the resistance cues and bike identifier, for consistent comparisons. Both travel with full backups.';section.append(help);
      const label=document.createElement('label');label.className='field';label.textContent='Saved setup';
      const select=document.createElement('select');select.id='saved-setup-select';select.add(new Option('Choose…',''));
      for(const [kind,{group}] of Object.entries(kinds)){const rows=options.get(kind);if(!rows.length)continue;const optgroup=document.createElement('optgroup');optgroup.label=group;for(const row of rows)optgroup.append(new Option(row.name,kind+':'+row.id));select.append(optgroup);}
      select.value=selection;if(select.value!==selection)selection='';label.append(select);section.append(label);
      const nameLabel=document.createElement('label');nameLabel.className='field';nameLabel.textContent='Name';const name=document.createElement('input');name.id='saved-setup-name';name.maxLength=80;nameLabel.append(name);section.append(nameLabel);
      const status=document.createElement('p');status.className='save-status';status.setAttribute('role','status');
      const actions=document.createElement('div');actions.className='shared-actions';section.append(actions,status);
      const add=(text,fn)=>{const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=text;b.addEventListener('click',async()=>{try{await fn();}catch(error){status.textContent=error.message;}});actions.append(b);return b;};
      const chosen=()=>{const [kind,id]=select.value.split(':');const row=kinds[kind]&&options.get(kind).find(item=>item.id===id);return row?{kind,row}:null;};
      const entry=(kind,cfg,row)=>kind==='machines'?{...row,bike:cfg.bike,bikeId:cfg.bikeId||row.name}:{...row,config:cfg};
      const load=add('Use',()=>{const picked=chosen();if(!picked)return;if(picked.kind==='machines')options.applyMachine(picked.row);else options.apply(picked.row.config);status.textContent='Applied to the next ride. Running rides keep their original setup.';});
      const saveAs=kind=>async()=>{
        const title=name.value.trim();if(!title){name.setCustomValidity('Enter a name.');name.reportValidity();return;}name.setCustomValidity('');
        const rows=options.get(kind);if(rows.length>=50)throw Error('Keep at most 50 '+kinds[kind].noun+'s. Delete an unused one first.');
        if(rows.some(row=>row.name.toLocaleLowerCase()===title.toLocaleLowerCase()))throw Error('A '+kinds[kind].noun+' with that name exists. Select it and choose Update selected.');
        const row=entry(kind,options.current(),{id:crypto.randomUUID(),name:title});
        if(!options.save(kind,[...rows,row]))throw Error('Could not save. Your existing entries were kept.');
        selection=kind+':'+row.id;render();options.notify('Saved '+title+'.');
      };
      add('Save as preset',saveAs('presets'));add('Save as machine',saveAs('machines'));
      const update=add('Update selected',async()=>{const picked=chosen();if(!picked)return;const {kind,row}=picked,title=name.value.trim()||row.name;if(options.get(kind).some(other=>other.id!==row.id&&other.name.toLocaleLowerCase()===title.toLocaleLowerCase()))throw Error('That name already exists.');const cfg=options.current();const expected=JSON.stringify(options.get(kind));if(!await options.confirm('Update '+row.name+'?','Replace this saved '+kinds[kind].noun+' with the values currently selected for your next ride?','Update'))return;if(expected!==JSON.stringify(options.get(kind)))throw Error('Saved setups changed. Review them and try again.');const updated=entry(kind,cfg,{...row,name:title});if(!options.save(kind,options.get(kind).map(item=>item.id===row.id?updated:item)))throw Error('Could not save the update.');render();options.notify('Saved setup updated.');});
      const remove=add('Delete selected',async()=>{const picked=chosen();if(!picked)return;const {kind,row}=picked;const expected=JSON.stringify(options.get(kind));if(!await options.confirm('Delete '+row.name+'?','Existing rides keep their recorded setup.','Delete',true))return;if(expected!==JSON.stringify(options.get(kind)))throw Error('Saved setups changed. Review them and try again.');if(!options.save(kind,options.get(kind).filter(item=>item.id!==row.id)))throw Error('Could not delete the saved setup.');selection='';render();options.notify('Saved setup deleted.');});
      function selected(){const picked=chosen();selection=picked?select.value:'';name.value=picked?.row.name||'';for(const b of [load,update,remove])b.disabled=!picked;}
      select.addEventListener('change',selected);name.addEventListener('input',()=>name.setCustomValidity(''));selected();host.append(section);
    }
    render();return {render};
  }
};
