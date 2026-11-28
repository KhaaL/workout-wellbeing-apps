// Separate cloud backups in every app: the first change saves one file;
// "Back up now" with nothing new, or a save that moved only the revision,
// saves none. npm run build first.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const site=require('./site-server.cjs');
const SHARED='wellbeing.connection.v1';
const APPS=['liftlog','bike-cardio','tabata','foodlog','checkin'];
(async()=>{
  const server=await site.start(),origin=server.origin;
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  try{
    for(const app of APPS){
      const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'}),errors=[];
      const objects=new Map();let etag=0;
      await context.route('https://storage.test/**',async route=>{
        const req=route.request(),url=new URL(req.url()),key=decodeURIComponent(url.pathname).split('/').slice(2).join('/');
        const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, PUT, DELETE','Access-Control-Allow-Headers':'*','Access-Control-Expose-Headers':'ETag'};
        if(req.method()==='OPTIONS')return route.fulfill({status:200,headers:cors});
        if(req.method()==='PUT'){objects.set(key,{raw:req.postData()||'',etag:'"'+(++etag)+'"'});return route.fulfill({status:200,headers:{...cors,ETag:'"'+etag+'"'},body:''});}
        if(req.method()==='GET'&&url.searchParams.get('list-type')==='2')
          return route.fulfill({status:200,headers:{...cors,'Content-Type':'application/xml'},body:'<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>'});
        const hit=objects.get(key);
        return hit?route.fulfill({status:200,headers:{...cors,ETag:hit.etag},body:hit.raw}):route.fulfill({status:404,headers:cors,body:'<Error><Code>NoSuchKey</Code></Error>'});
      });
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
      const files=()=>[...objects.keys()].filter(key=>key.includes('.snapshots/')).length;
      /* Load once to let the app write its starting data, then mark it changed
         (its revision field) so it is no longer pristine, and connect. */
      await page.goto(origin+'/'+app+'/');
      await page.evaluate(([shared,app])=>{
        for(const key of Object.keys(localStorage)){
          if(!key.startsWith(app))continue;
          let value;try{value=JSON.parse(localStorage.getItem(key));}catch(e){continue;}
          if(!value||typeof value!=='object')continue;
          if('updatedAt' in value){value.updatedAt=Date.now()-1000;localStorage.setItem(key,JSON.stringify(value));}
          else if(value.settings&&'seededAt' in value.settings){value.settings.lastModifiedAt=Date.now()-1000;localStorage.setItem(key,JSON.stringify(value));}
        }
        /* apps that write nothing until the first change: their smallest valid
           state, with a revision */
        const smallest={tabata:{version:3,history:[]},foodlog:{version:3,foods:[],versions:{},entries:[],days:{}},checkin:{version:2,items:[],entries:[]}}[app];
        if(smallest&&!localStorage.getItem(app+'.state.v1'))localStorage.setItem(app+'.state.v1',JSON.stringify({app,...smallest,updatedAt:Date.now()-1000}));
        localStorage.setItem(shared,JSON.stringify({endpoint:'https://storage.test',region:'test',bucket:'apps',accessKeyId:'fake',secretAccessKey:'synthetic',pathStyle:true,syncMode:'immutable'}));
      },[SHARED,app]);
      await page.reload();
      for(let i=0;i<100&&files()<1;i++)await page.waitForTimeout(100);
      assert.equal(files(),1,app+': the changed data saves one backup file');
      await page.locator('.nav-btn[data-view="settings"]').first().click();
      await page.evaluate(()=>{for(const node of document.querySelectorAll('main details'))node.open=true;});
      await page.locator('#cloudActions button',{hasText:'Back up now'}).click();
      await page.waitForTimeout(1500);
      assert.equal(files(),1,app+': Back up now with nothing new saves no file');
      /* The revision moves while the data stays the same (as a timestamp-only
         save does): the reload schedules a backup, and the data check skips it. */
      await page.evaluate(app=>{const key=app+'.v1.remote',rec=JSON.parse(localStorage.getItem(key));rec.lastUploadedModifiedAt=1;localStorage.setItem(key,JSON.stringify(rec));},app);
      await page.reload();
      await page.waitForFunction(app=>{const rec=JSON.parse(localStorage.getItem(app+'.v1.remote'));return rec.lastUploadedModifiedAt!==1;},app,{timeout:15000});
      assert.equal(files(),1,app+': a save that changed only the revision saves no file');
      assert.deepEqual(errors,[],app+': no page errors');
      console.log('PASS '+app+': one file for a change, none for Back up now or a revision-only save');
      await context.close();
    }
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exit(1);});
