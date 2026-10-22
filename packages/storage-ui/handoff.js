/* Shared explicit transfer controls; all provider strings remain inert text. */
/* options.heading:false when the app already titles the section;
   options.fileButton renders the file picker as the app's styled file button. */
WorkoutStorage.renderHandoff = function(container,handoff,download,notify,options={}){
  if(!container)return;container.replaceChildren();
  const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;container.append(n);return n;};
  if(options.heading!==false)node('h3','Move workout to another device');
  node('p','Pause the workout here, then receive it on the other device by file'+(handoff.configured?' or cloud code':'')+'. Finished workouts stay where they are. Keep this device paused until the other one finishes.').className='hint';
  const run=fn=>Promise.resolve().then(fn).catch(error=>notify(error.message));
  const button=(id,text,fn,disabled=false)=>{const b=node('button',text);b.id=id;b.type='button';b.className='btn secondary';b.disabled=handoff.busy||disabled;b.addEventListener('click',()=>run(fn));return b;};
  let held;try{held=handoff.held();}catch(error){node('p',error.message);return;}
  if(held?.invalid){
    node('p','Handoff state could not be read. Export a full backup before resetting this hold.');
    button('handoffCancel','Reset unreadable handoff hold…',()=>handoff.cancel());return;
  }
  if(held){
    const label=node('p','Workout held on this device. Handoff code: '+held.payload.id);label.id='handoffCode';label.style.overflowWrap='anywhere';
    button('handoffFile','Download handoff file',()=>download(JSON.stringify(held.payload,null,2),'workout-handoff-'+held.payload.id+'.json'));
    if(handoff.configured)button('handoffUpload','Save handoff to cloud',async()=>{await handoff.upload(held.payload);notify('Cloud handoff verified. Enter its code on the other device.');});
    button('handoffCancel','Cancel handoff on this device…',()=>handoff.cancel());
  }else button('handoffOffer','Prepare workout handoff…',()=>handoff.offer(),!handoff.hasActive);
  const label=node('label');label.className=options.fileButton?'file-btn':'field';
  if(options.fileButton){const text=document.createElement('span');text.textContent='Receive handoff file';label.append(text);}else label.textContent='Receive handoff file';
  const file=document.createElement('input');file.id='handoffImport';file.type='file';file.accept='.json,application/json';file.disabled=handoff.busy||handoff.hasActive;label.append(file);
  if(options.fileButton)file.setAttribute('aria-label','Receive handoff file');
  file.addEventListener('change',()=>{const selected=file.files[0];file.value='';if(selected)run(async()=>{if(selected.size>8*1024*1024)throw new Error('Handoff exceeds the 8 MiB limit.');await handoff.receive(JSON.parse(await selected.text()));});});
  if(!handoff.configured)return;
  const codeLabel=node('label');codeLabel.className='field';codeLabel.textContent='Receive cloud handoff code';
  const code=document.createElement('input');code.type='text';code.id='handoffReceiveCode';code.autocomplete='off';code.disabled=handoff.busy||handoff.hasActive;codeLabel.append(code);
  button('handoffReceive','Review cloud handoff…',()=>handoff.receiveCode(code.value.trim()),handoff.hasActive);
};
