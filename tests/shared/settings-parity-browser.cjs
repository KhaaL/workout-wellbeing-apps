// Settings parity across the four apps on one origin: section order, one theme
// control, one backup-mode choice, one connection form vocabulary, and the same
// cloud buttons for each backup mode and pause state. No legacy restore remains.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const site=require('./site-server.cjs');
const SHARED='wellbeing.connection.v1';
const APPS={
  liftlog:{ns:'liftlog.v1',order:['Storage','Rest timer','Appearance','Backup & restore','Cloud backup','Transfer routines & history','Move workout to another device','App updates','Advanced & destructive actions']},
  'bike-cardio':{ns:'bike-cardio.v1',order:['Storage','Default targets & durations','Appearance','Backups & cloud storage','Move workout to another device','App updates']},
  tabata:{ns:'tabata.v1',order:['Quick presets','Appearance','Backups & cloud storage','App updates']},
  foodlog:{ns:'foodlog.v1',order:['Daily targets','Meals','Appearance','Backups & cloud storage','App updates']}
};
const FIELDS=['Backup mode','Endpoint URL','Region','Bucket','Backup path · this app','Access key ID','Secret access key'];
const EXPECTED={
  immutable:{running:['Back up now','Pause cloud backups'],paused:['Resume backups…']},
  conditional:{running:['Sync now','Pause cloud sync','Use cloud copy…'],paused:['Keep local copy & update cloud…','Resume automatic sync…','Use cloud copy…']}
};
(async()=>{
  const server=await site.start(),origin=server.origin;
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'}),errors=[];
    await context.route('https://storage.test/**',route=>{
      const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, PUT, DELETE','Access-Control-Allow-Headers':'*','Access-Control-Expose-Headers':'ETag'};
      if(route.request().method()==='PUT')return route.fulfill({status:200,headers:{...cors,ETag:'"1"'},body:''});
      return route.fulfill({status:404,headers:cors,body:'<Error><Code>NoSuchKey</Code></Error>'});
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    const connect=mode=>page.evaluate(([key,mode])=>{localStorage.setItem(key,JSON.stringify({endpoint:'https://storage.test',region:'test',bucket:'apps',accessKeyId:'fake',secretAccessKey:'synthetic',pathStyle:true,syncMode:mode}));},[SHARED,mode]);
    const open=async app=>{
      await page.goto(origin+'/'+app+'/');await page.locator('.nav-btn[data-view="settings"]').first().click();
      await page.evaluate(()=>{for(const node of document.querySelectorAll('main details'))node.open=true;});
    };
    // Visible cloud buttons in DOM order; Liftlog renders them by data-action, the others by id.
    const cloudButtons=()=>page.evaluate(()=>[...document.querySelectorAll('[data-action^="remote-"],#cloudBackup,#cloudPause,#cloudKeepLocal,#cloudResume,#cloudUseRemote')]
      .filter(node=>['remote-backup','remote-pause','remote-publish-local','remote-resume','remote-restore'].includes(node.dataset.action)||node.id)
      .filter(node=>!node.hidden&&node.getClientRects().length).map(node=>node.textContent.trim()));
    const pause=app=>page.locator(app==='liftlog'?'[data-action="remote-pause"]':'#cloudPause').click();
    const expectButtons=async(app,labels)=>{
      try{await page.waitForFunction(labels=>{const nodes=[...document.querySelectorAll('[data-action="remote-backup"],[data-action="remote-pause"],[data-action="remote-publish-local"],[data-action="remote-resume"],[data-action="remote-restore"],#cloudBackup,#cloudPause,#cloudKeepLocal,#cloudResume,#cloudUseRemote')];
        return JSON.stringify(nodes.filter(node=>!node.hidden&&node.getClientRects().length).map(node=>node.textContent.trim()))===JSON.stringify(labels);},labels,{timeout:10000});}
      catch(error){assert.deepEqual(await cloudButtons(),labels,app);}
    };
    await page.goto(origin+'/');
    const modes=[],themes=[];
    for(const [app,spec] of Object.entries(APPS)){
      await connect('immutable');await page.evaluate(ns=>localStorage.removeItem(ns+'.remote-paused'),spec.ns);
      await open(app);
      const view=await page.evaluate(()=>{
        const main=document.querySelector('main'),visible=node=>node.getClientRects().length>0;
        const titles=[...main.querySelectorAll('h1,h2,h3,summary')].filter(visible).map(node=>(node.matches('summary')?(node.querySelector('.settings-summary')?.firstChild||node).textContent:node.textContent).trim());
        const labels=[...main.querySelectorAll('[data-form="remote-config"] .cap,#cloudForm label.field')].map(node=>(node.matches('.cap')?node:node.firstChild).textContent.trim());
        return {titles,labels,h1:[...main.querySelectorAll('h1')].filter(visible).map(node=>node.textContent.trim()),text:main.textContent,
          modes:[...main.querySelectorAll('[data-field="syncMode"] option,#cloudMode option')].map(node=>[node.value,node.textContent]),
          themes:[...document.querySelectorAll('#themeChoice option')].map(node=>node.value)};
      });
      assert.deepEqual(view.h1,['Settings'],app+' has one visible h1');
      let at=-1;
      for(const title of spec.order){const next=view.titles.indexOf(title,at+1);assert.ok(next>at,app+': "'+title+'" follows the earlier sections in '+JSON.stringify(view.titles));at=next;}
      assert.deepEqual(view.labels.filter(label=>FIELDS.includes(label)),FIELDS,app+' connection fields');
      for(const text of ['Path-style addressing','Check & save connection','Forget connection…','Download full backup','Restore from file'])assert.ok(view.text.includes(text),app+' shows '+text);
      assert.doesNotMatch(view.text,/legacy/i,app+' offers no legacy restore');
      modes.push(view.modes);themes.push(view.themes);
      await expectButtons(app,EXPECTED.immutable.running);await pause(app);await expectButtons(app,EXPECTED.immutable.paused);
      await connect('conditional');await page.evaluate(ns=>localStorage.removeItem(ns+'.remote-paused'),spec.ns);await open(app);
      await expectButtons(app,EXPECTED.conditional.running);await pause(app);await expectButtons(app,EXPECTED.conditional.paused);
      console.log('PASS '+app+': section order, connection vocabulary and cloud buttons for both modes');
    }
    for(const list of modes)assert.deepEqual(list,[['immutable','Separate backup files (recommended)'],['conditional','Conditional sync (one shared file)']]);
    for(const list of themes)assert.deepEqual(list,themes[0]);assert.equal(themes[0].length,14);
    assert.deepEqual(errors,[]);
    console.log('PASS every app offers the same backup modes and theme list');
  }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
