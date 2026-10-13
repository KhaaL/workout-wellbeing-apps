/* Wait for every app tab to save and report no active workout. Old or
   unresponsive tabs defer activation, rather than being assumed safe. */
let updateActivationBusy=false;
self.addEventListener('message',event=>{
  if(event.data?.type!=='PREPARE_APP_UPDATE'||!event.ports?.[0])return;
  const reply=event.ports[0];
  event.waitUntil((async()=>{
    if(updateActivationBusy){reply.postMessage({ok:false,message:'Another tab is applying an update. Try again shortly.'});return;}
    updateActivationBusy=true;
    try{
      const scope=self.registration.scope;
      const clients=(await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(client=>client.url.startsWith(scope));
      if(!clients.length||!clients.some(client=>client.id===event.source?.id)){reply.postMessage({ok:false,message:'Could not verify this app tab. Reopen the app and try again.'});return;}
      const results=await Promise.all(clients.map(client=>new Promise(resolve=>{
        const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(false);},3000);
        channel.port1.onmessage=message=>{clearTimeout(timer);channel.port1.close();resolve(message.data?.ready===true);};
        try{client.postMessage({type:'APP_UPDATE_STATE',lock:true},[channel.port2]);}catch(error){clearTimeout(timer);resolve(false);}
      })));
      if(results.some(ready=>!ready)){reply.postMessage({ok:false,message:'Update deferred. Finish saved workouts in every app tab. Close tabs that cannot respond, then try again.'});return;}
      reply.postMessage({ok:true});await self.skipWaiting();
    }catch(error){reply.postMessage({ok:false,message:'Could not prepare the app update. Try again.'});}
    finally{updateActivationBusy=false;}
  })());
});
