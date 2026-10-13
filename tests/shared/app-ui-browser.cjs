const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {appWithTestAPI}=require('../../apps/liftlog/tests/harness.cjs');
const {navigate}=require('./ui-navigation.cjs');
const root=path.resolve(__dirname,'../..');
(async()=>{
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  try{
    for(const app of ['liftlog','bike-cardio']){
      const html=app==='liftlog'?appWithTestAPI('{get state(){return state},get timer(){return timer}}'):fs.readFileSync(path.join(root,'dist',app,'index.html'),'utf8');
      const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('https://ui.test/**',route=>route.fulfill({contentType:'text/html',body:html}));
      await page.goto('https://ui.test/'+app);
      const workout=app==='liftlog'?'today':'setup';
      for(const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:1024,height:768},{width:1440,height:900}]){
        await page.setViewportSize(viewport);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,app+' fits '+viewport.width);
        assert.equal(await page.locator('.nav-btn').evaluateAll(nodes=>nodes.every(node=>{const r=node.getBoundingClientRect();return r.width>=48&&r.height>=48&&r.left>=0&&r.right<=innerWidth;})),true,app+' navigation has usable touch targets');
        if(app==='bike-cardio')assert.equal(await page.locator('#start').evaluate(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true,'Bike Start stays in the viewport');
      }
      await page.setViewportSize({width:390,height:844});await navigate(page,'settings');
      if(app==='liftlog')await page.getByText('Nord',{exact:true}).click();else await page.selectOption('#themeChoice','nord');
      assert.equal(await page.locator('html').getAttribute('data-theme'),'nord');
      await page.reload();assert.equal(await page.locator('html').getAttribute('data-theme'),'nord',app+' remembers theme');
      await navigate(page,workout);
      await page.screenshot({animations:'disabled',path:'/tmp/wellbeing-'+app+'-mobile.png'});
      if(app==='bike-cardio'){
        assert.doesNotMatch(await page.locator('body').textContent(),/Keep it easy|Keep it steady|Your bike workout, one phase at a time/);
        await page.locator('#cooldown').focus();await page.setViewportSize({width:390,height:520});
        await page.waitForFunction(()=>document.documentElement.classList.contains('keyboard-open'));
        assert.equal(await page.locator('#start').isVisible(),false,'software-keyboard layout gives numeric entry space');
        await page.locator('#setup h1').click();await page.setViewportSize({width:390,height:844});
        assert.equal(await page.locator('#start').isVisible(),true,'workout actions return after editing');
        await page.locator('#rideAdjustments > summary').click();await page.fill('#mainMinutes','35');await page.locator('#mainMinutes').press('Tab');
        const defaults=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('bike-cardio.state.v1')).settings);
        assert.equal((await defaults()).mainMinutes,25,'ride adjustment does not replace defaults');
        await navigate(page,'settings');await page.uncheck('#voice');await page.uncheck('#beeps');await navigate(page,'setup');
        await page.click('#start');
        const active=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('bike-cardio.state.v1')).active);
        assert.equal((await active()).config.mainMinutes,35,'upcoming ride uses its adjustment');
        const started=(await active()).startedAt;
        await navigate(page,'settings');await page.locator('#defaultTargets > summary').click();
        await page.getByRole('button',{name:'Increase Zone 2 main block · minutes',exact:true}).click();await page.click('#saveDefaults');
        assert.equal((await defaults()).mainMinutes,26,'default stepper saves new defaults');
        assert.equal((await active()).config.mainMinutes,35,'changing defaults keeps the running plan');
        assert.equal((await active()).startedAt,started,'navigation keeps workout identity');
        assert.equal((await active()).status,'running','navigation does not pause riding');
        await page.getByRole('button',{name:'Return to workout',exact:true}).click();assert.equal(await page.locator('#run').isVisible(),true);
        assert.equal(await page.locator('.return-workout').isHidden(),true,'return control is hidden on the workout');
        await page.click('#pause');assert.equal(await page.locator('#pauseDialog').isVisible(),true);await page.click('#resume');
        await page.screenshot({animations:'disabled',path:'/tmp/wellbeing-bike-workout-mobile.png'});
      }else{
        await page.locator('[data-action="routine-start"]').first().click();
        const editor=page.getByRole('dialog',{name:'Edit set 1'});
        const first=()=>page.evaluate(()=>window.testAPI.state.activeWorkout.exercises[0].sets[0]);
        const before=await first();await page.locator('[data-action="edit-set"]').first().click();
        await editor.getByRole('button',{name:/Increase Set 1 weight/}).click();
        assert.equal((await first()).weight,before.weight,'set adjustment is a draft');
        await editor.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await first()).weight,before.weight,'cancel keeps the set');
        await page.locator('[data-action="edit-set"]').first().click();await editor.getByRole('button',{name:/Increase Set 1 weight/}).click();await editor.getByRole('button',{name:'Save changes',exact:true}).click();
        assert.equal((await first()).weight,before.weight+2.5,'set editor uses the configured load step');
        await page.locator('[data-action="edit-set"]').first().click();await editor.locator('input').first().fill('23');
        await editor.getByRole('button',{name:/Increase Set 1 weight/}).click();await editor.getByRole('button',{name:'Save changes',exact:true}).click();
        assert.equal((await first()).weight,25.5,'load increments also work from values between the configured steps');
        await page.locator('[data-action="toggle-set"]').first().click();const end=await page.evaluate(()=>window.testAPI.timer.endsAt);
        await navigate(page,'settings');assert.equal(await page.evaluate(()=>window.testAPI.timer.endsAt),end,'navigation keeps rest deadline');
        await page.getByRole('button',{name:'Return to workout',exact:true}).click();
        assert.equal(await page.locator('.return-workout').isHidden(),true,'return control is hidden on the workout');
        assert.equal(await page.locator('.actionbar').evaluate(node=>{const r=node.getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0;}),true,'rest controls stay in viewport');
        await page.screenshot({animations:'disabled',path:'/tmp/wellbeing-liftlog-workout-mobile.png'});
      }
      assert.deepEqual(errors,[],app+' has no browser errors');await context.close();
      console.log('PASS '+app+': themes, navigation, responsive touch controls and preserved active workouts');
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
