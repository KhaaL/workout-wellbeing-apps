/* Named setup snapshots; applying one never mutates a running workout. */
/* exported BikePresets */
const BikePresets = {
  mount(host,options){
    const selections={presets:'',machines:''};
    function render(){
      host.replaceChildren();
      for(const kind of ['presets','machines']){
        const machine=kind==='machines',section=document.createElement('details');section.className='card';
        const summary=document.createElement('summary');summary.textContent=machine?'Machine profiles':'Saved workout presets';section.append(summary);
        const help=document.createElement('p');help.className='hint';help.textContent=machine?'Reuse the same identifier and resistance cues for consistent comparisons.':'Save a named copy of the current setup, including targets, durations and sound preferences. Presets travel with full backups.';section.append(help);
        const label=document.createElement('label');label.className='field';label.textContent=machine?'Saved machine':'Saved preset';
        const select=document.createElement('select');select.id=kind+'-select';select.add(new Option('Choose…',''));
        for(const row of options.get(kind))select.add(new Option(row.name,row.id));select.value=selections[kind];label.append(select);section.append(label);
        const nameLabel=document.createElement('label');nameLabel.className='field';nameLabel.textContent=machine?'Machine profile name':'Preset name';const name=document.createElement('input');name.id=kind+'-name';name.maxLength=80;nameLabel.append(name);section.append(nameLabel);
        const status=document.createElement('p');status.className='save-status';status.setAttribute('role','status');
        const actions=document.createElement('div');actions.className='shared-actions';section.append(actions,status);
        const add=(text,fn)=>{const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=text;b.addEventListener('click',async()=>{try{await fn();}catch(error){status.textContent=error.message;}});actions.append(b);return b;};
        const chosen=()=>options.get(kind).find(row=>row.id===select.value);
        const load=add(machine?'Use machine':'Use preset',()=>{const row=chosen();if(!row)return;if(machine)options.applyMachine(row);else options.apply(row.config);status.textContent='Applied to the next ride. Running rides keep their original setup.';});
        add('Save new',async()=>{
          const title=name.value.trim();if(!title){name.setCustomValidity('Enter a name.');name.reportValidity();return;}name.setCustomValidity('');
          const rows=options.get(kind);if(rows.length>=50)throw Error('Keep at most 50 entries. Delete an unused entry first.');
          if(rows.some(row=>row.name.toLocaleLowerCase()===title.toLocaleLowerCase()))throw Error('That name exists. Select it and choose Update selected.');
          const cfg=options.current(),row=machine?{id:crypto.randomUUID(),name:title,bike:cfg.bike,bikeId:cfg.bikeId||title}:{id:crypto.randomUUID(),name:title,config:cfg};
          if(!options.save(kind,[...rows,row]))throw Error('Could not save. Your existing entries were kept.');
          selections[kind]=row.id;render();options.notify('Saved '+title+'.');
        });
        const update=add('Update selected',async()=>{const row=chosen();if(!row)return;const title=name.value.trim()||row.name;if(options.get(kind).some(other=>other.id!==row.id&&other.name.toLocaleLowerCase()===title.toLocaleLowerCase()))throw Error('That name already exists.');const cfg=options.current();const expected=JSON.stringify(options.get(kind));if(!await options.confirm('Update '+row.name+'?','Replace this saved setup with the values currently selected for your next ride?','Update'))return;if(expected!==JSON.stringify(options.get(kind)))throw Error('Saved setups changed. Review them and try again.');const updated=machine?{...row,name:title,bike:cfg.bike,bikeId:cfg.bikeId||title}:{...row,name:title,config:cfg};if(!options.save(kind,options.get(kind).map(item=>item.id===row.id?updated:item)))throw Error('Could not save the update.');render();options.notify('Saved setup updated.');});
        const remove=add('Delete selected',async()=>{const row=chosen();if(!row)return;const expected=JSON.stringify(options.get(kind));if(!await options.confirm('Delete '+row.name+'?','Existing rides keep their recorded setup.','Delete',true))return;if(expected!==JSON.stringify(options.get(kind)))throw Error('Saved setups changed. Review them and try again.');if(!options.save(kind,options.get(kind).filter(item=>item.id!==row.id)))throw Error('Could not delete the saved setup.');selections[kind]='';render();options.notify('Saved setup deleted.');});
        function selected(){const row=chosen();selections[kind]=row?.id||'';name.value=row?.name||'';for(const b of [load,update,remove])b.disabled=!row;}
        select.addEventListener('change',selected);name.addEventListener('input',()=>name.setCustomValidity(''));selected();host.append(section);
      }
    }
    render();return {render};
  }
};
