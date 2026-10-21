/* Shared storage tools presentation. Provider responses and keys stay inert text. */
WorkoutStorage.renderRemoteTools = function(container, remote, download, layout='liftlog') {
  const state=remote.remoteTools(),cfg=remote.loadRemoteConfig();
  container.replaceChildren();if(!cfg)return;
  const element=(tag,text,parent=container)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;parent.append(node);return node;};
  const paragraph=(text,parent=container)=>{const node=element('p',text,parent);node.className=layout==='bike'?'small':'hint';return node;};
  const actions=parent=>{const node=element('div',null,parent);node.className=layout==='bike'?'stack':'form-actions';return node;};
  const run=action=>Promise.resolve().then(action).catch(()=>{});
  const button=(text,id,action,parent,disabled=false)=>{
    const node=element('button',text,parent);node.type='button';node.id=id;node.className=layout==='bike'?'secondary':'btn';
    node.disabled=state.busy||disabled;node.addEventListener('click',()=>run(action));return node;
  };
  const immutable=state.mode==='immutable';
  paragraph(immutable?'Separate backups: each upload creates a new file. Devices keep their local copies until you explicitly restore a chosen backup. The former single backup remains available below.':'Conditional sync: the provider must enforce overwrite protection before multiple devices can safely update one backup.');
  element('h3','Storage provider checks');
  paragraph('Checks reading, writing and overwrite protection using a small temporary probe. Automatic sync pauses during checks. Cleanup needs DELETE in CORS and object-delete permission; your backup object is not changed.');
  let controls=actions(container);
  button('Check provider compatibility','providerCheck',()=>remote.remoteCheckProvider(),controls,!remote.remoteCryptoAvailable());
  button('Download diagnostics','downloadDiagnostics',()=>download(JSON.stringify(remote.diagnosticsPayload(),null,2),'storage-diagnostics.json'),controls);
  paragraph('Diagnostics include connection details and check results. Credentials and workout contents are excluded.');
  if(state.busy)paragraph('Storage operation in progress…');
  if(state.diagnostic){const error=paragraph('Last connection error: '+state.diagnostic.message);error.setAttribute('role','status');}
  if(state.report){
    const report=state.report;
    paragraph('Checked '+new Date(report.at).toLocaleString()+'. '+(report.compatible?'Checks passed for the selected backup mode.':'Some checks failed or could not be verified. '+(immutable?'Cloud backups stay':'Cloud sync stays')+' paused.'));
    const names={browserAccess:'Browser access to read responses',read:'Read-back',write:'Write',etag:'ETag exposure',ifNoneMatch:'Create-only protection',ifMatch:'Stale-version protection',matchedWrite:'Current-version update',cleanup:'Probe cleanup'};
    const list=element('ul');list.id='providerResults';
    for(const [name,label]of Object.entries(names))element('li',label+': '+({passed:'passed',failed:'failed',unknown:'not verified','not-needed':'not needed'}[report[name]]||'not verified'),list);
    if(report.error)paragraph(report.error.message);
    if(report.cleanupMessage)paragraph(report.cleanupMessage);
    if(report.persistenceMessage)paragraph(report.persistenceMessage);
    if(report.protectionMessage)paragraph(report.protectionMessage);
    for(const key of report.remainingProbeKeys||[])paragraph('Remaining probe: '+key).style.overflowWrap='anywhere';
  }
  element('h3','Cloud snapshots');
  paragraph('Browse earlier backups for this app only. Newest backups appear first, with 20 entries per page. Preview loads record counts; restoring changes this device and leaves '+(immutable?'cloud backups':'cloud sync')+' paused.');
  controls=actions(container);
  button('Browse cloud snapshots','browseSnapshots',()=>remote.remoteListSnapshots(),controls,!remote.remoteCryptoAvailable());
  if(immutable)button('Restore legacy backup locally…','restoreLegacyBackup',()=>remote.remoteRestoreLegacy(),controls,state.active);
  if(state.snapshots?.offset)button('Newer snapshots','previousSnapshots',()=>remote.remoteListSnapshots('previous'),controls);
  if(state.snapshots?.token)button('Older snapshots','nextSnapshots',()=>remote.remoteListSnapshots(true),controls);
  const list=element('div');list.id='snapshotList';
  if(state.snapshots&&!state.snapshots.items.length)paragraph('No snapshots found for this backup path.',list);
  for(const [index,item]of (state.snapshots?.items||[]).entries()){
    const row=element('div',null,list);row.className=layout==='bike'?'card':'setting-block';
    paragraph(new Date(item.at).toLocaleString()+' · '+(item.size/1024).toFixed(1)+' KiB',row);
    paragraph(item.key,row).style.overflowWrap='anywhere';
    if(item.summary)paragraph(`${item.summary.records} ${item.summary.recordLabel}${item.summary.hasActive?' · includes a saved workout':''}${item.summary.exportedAt?' · backup exported '+new Date(item.summary.exportedAt).toLocaleString():''}`,row);
    const rowActions=actions(row);
    button('Preview','snapshotPreview'+index,()=>remote.remotePreviewSnapshot(item.key),rowActions);
    button('Download','snapshotDownload'+index,async()=>{const file=await remote.remoteDownloadSnapshot(item.key);download(file.raw,file.name);},rowActions);
    button('Restore locally…','snapshotRestore'+index,()=>remote.remoteRestoreSnapshot(item.key),rowActions,state.active);
  }
  if(state.active)paragraph('Finish or end the saved workout before restoring a snapshot.');
};
