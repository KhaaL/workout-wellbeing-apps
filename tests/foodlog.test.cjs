// Foodlog model and storage schema: catalog import/merge/export, frozen versions, totals with unknowns, day export and validation.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const context=vm.createContext({TextEncoder});
for(const file of ['packages/storage-engine/local.js','apps/foodlog/food-core.js','apps/foodlog/storage-adapter.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
const F=vm.runInContext('FoodCore',context),Store=vm.runInContext('FoodlogStorage',context);
const plain=value=>JSON.parse(JSON.stringify(value));
const catalog=()=>JSON.parse(fs.readFileSync(path.join(root,'examples/foodlog-catalog.json'),'utf8'));
const empty=()=>({settings:F.settings(),foods:[],versions:{},entries:[],days:{}});
function imported(){const s=empty(),r=F.importCatalog(catalog(),s);s.foods=r.foods;s.settings.catalog={...r.catalog,importedAt:1};s.settings.targets=r.targets;return s;}
const by=(s,id)=>s.foods.find(f=>f.id===id);
let n=0;const log=(s,id,amount,extra={})=>F.log(s,by(s,id),{date:'2026-01-20',time:'08:00',meal:'Breakfast',amount,...extra},'e'+(++n));

test('a schema 1.0 catalog imports with bases, portions, micronutrients, details and targets',()=>{
  const s=empty(),r=F.importCatalog(catalog(),s);
  assert.equal(r.report.added.length,5);assert.deepEqual(plain(r.report.skipped),[]);
  s.foods=r.foods;
  assert.equal(by(s,'example-oat-drink').basis,'ml');assert.deepEqual(plain(by(s,'example-oat-drink').portions),[{label:'1 serving',amount:200}]);
  assert.deepEqual(plain(by(s,'example-oat-drink').micros),{vitamin_d_ug:1.1,calcium_mg:120});
  assert.deepEqual(plain(by(s,'example-protein-powder').portions),[{label:'1 serving',amount:20}]);
  assert.deepEqual(plain(by(s,'example-crispbread').portions),[],'a null piece weight adds no portion');
  assert.equal(by(s,'example-crispbread').details.serving.note,'Weigh one piece once and fill in');assert.equal(by(s,'example-crispbread').details.derived.frequency_class,'everyday');
  assert.equal(by(s,'example-cottage-cheese').nutrients.fibre_g,null,'unknown stays unknown');
  assert.deepEqual(plain(r.targets),[{key:'protein_g',kind:'min',value:100},{key:'fibre_g',kind:'min',value:30},{key:'saturated_fat_g',kind:'max',value:25},{key:'salt_g',kind:'max',value:6}]);
  assert.deepEqual(plain(r.ignoredTargets),['sugar_g'],'the sugar limit is not applied to total sugars');
  assert.equal(r.catalog.revision,3);assert.equal(r.older,false);
});

test('merging by id keeps local portions and archiving, reports changes and keeps foods missing from the file',()=>{
  const s=imported();
  by(s,'example-crispbread').portions=[{label:'1 piece',amount:12}];by(s,'example-oat-drink').archived=true;
  s.foods.push(F.food({id:'boiled-egg',name:'Boiled egg',brand:'',kind:'generic',basis:'g',nutrients:{energy_kcal:143,protein_g:12.6},source:'typical',estimate:true}));
  const next=catalog();next.revision=4;
  next.products.find(p=>p.id==='example-cottage-cheese').nutrition_per_100g.protein_g=15;
  next.products=next.products.filter(p=>p.id!=='example-peanut-butter');
  next.products.push({id:'example-yoghurt',name:'Greek Yoghurt 0.2%',nutrition_per_100g:{energy_kcal:59,protein_g:9.5,salt_g:0.14}},{id:'bad one',name:'Bad id',nutrition_per_100g:{}},{id:'no-table',name:'No table'},{id:'example-yoghurt',name:'Repeat',nutrition_per_100g:{}});
  const r=F.importCatalog(next,s);
  assert.deepEqual(plain(r.report.added),['Greek Yoghurt 0.2%']);assert.deepEqual(plain(r.report.updated),['Cottage Cheese 1.5%']);
  assert.equal(r.report.unchanged.length,3);assert.deepEqual(plain(r.report.notInFile),['Peanut Butter Crunchy']);
  assert.deepEqual(plain(r.report.skipped.map(x=>x.id)),['bad one','no-table','example-yoghurt']);
  s.foods=r.foods;
  assert.deepEqual(plain(by(s,'example-crispbread').portions),[{label:'1 piece',amount:12}],'local portions stay');
  assert.equal(by(s,'example-oat-drink').archived,true,'archiving stays');
  assert.equal(by(s,'example-peanut-butter').inFile,undefined);assert.ok(by(s,'boiled-egg'),'foods added here stay');
  assert.equal(by(s,'example-cottage-cheese').nutrients.protein_g,15,'label values come from the file');
  s.settings.catalog={...r.catalog,importedAt:2};
  const older=catalog();older.revision=2;assert.equal(F.importCatalog(older,s).older,true);
  const changed=catalog();changed.products[0]={...changed.products[0],nutrition_per_100g:changed.products[0].nutrition_per_100ml};delete changed.products[0].nutrition_per_100ml;
  by(s,'example-oat-drink').portions=[{label:'1 glass',amount:250}];
  assert.deepEqual(plain(F.importCatalog(changed,s).report.portionsReset),['Oat Drink Original'],'a unit change drops portions in the old unit');
  for(const bad of [{},{schema_version:'2.0',products:[]},{schema_version:'1.0'}])assert.throws(()=>F.importCatalog(bad,s));
});

test('export writes the same schema, keeps unmodelled fields and round-trips unchanged',()=>{
  const s=imported();by(s,'example-crispbread').portions=[{label:'1 piece',amount:12}];
  s.settings.targets=[{key:'protein_g',kind:'min',value:110},{key:'salt_g',kind:'max',value:5}];
  const out=F.exportCatalog(s,Date.UTC(2026,0,20));
  assert.equal(out.schema_version,'1.0');assert.equal(out.revision,3);
  const bread=out.products.find(p=>p.id==='example-crispbread');
  assert.equal(bread.derived.frequency_class,'everyday');assert.equal(bread.wholegrain_pct,60);assert.equal(bread.nutrition_per_100g.protein_g,12);
  assert.deepEqual(plain(bread.foodlog.portions),[{label:'1 piece',amount:12}]);
  assert.deepEqual(plain(out.products.find(p=>p.id==='example-oat-drink').micronutrients_per_100ml),{vitamin_d_ug:1.1,calcium_mg:120});
  assert.deepEqual(plain(out.personal_budgets_per_day.contribution),{protein_g:110});
  assert.deepEqual(plain(out.personal_budgets_per_day.limit),{sugar_g:50,salt_g:5},'targets set here replace tracked keys; the sugar limit stays');
  const again=F.importCatalog(out,s);assert.equal(again.report.unchanged.length,5);assert.equal(again.report.updated.length,0);
});

test('logging freezes values: later label changes leave logged days alone',()=>{
  const s=imported();log(s,'example-cottage-cheese',150);
  by(s,'example-cottage-cheese').nutrients.protein_g=20;log(s,'example-cottage-cheese',100,{time:'12:00',meal:'Lunch'});
  assert.equal(Object.keys(s.versions).length,2);
  const d=F.day(s,'2026-01-20');
  assert.equal(F.round(d.meals.find(m=>m.meal==='Breakfast').total.sums.protein_g,'g'),21);assert.equal(d.meals.find(m=>m.meal==='Lunch').total.sums.protein_g,20);
  const first=s.entries[0];F.updateEntry(s,first.id,{amount:300,note:'double'});
  assert.equal(s.entries[0].version,first.version);assert.equal(s.entries[0].note,'double');
  s.entries.splice(1,1);F.prune(s);assert.deepEqual(Object.keys(s.versions),[first.version],'unused versions go');
  assert.ok(F.state(plain(s)),'the state stays valid');
});

test('totals scale by 100 g, 100 ml and portions; unknowns are counted, never zero',()=>{
  const s=imported();
  s.foods.push(F.food({id:'bowl',name:'Rice bowl',brand:'',kind:'dish',basis:'portion',nutrients:{energy_kcal:700,protein_g:30,salt_g:6,fibre_g:null},source:'menu',estimate:false}));
  s.foods.push(F.food({id:'apple',name:'Apple',brand:'',kind:'generic',basis:'g',nutrients:{energy_kcal:52,protein_g:0.3,fibre_g:2.4,salt_g:0},source:'typical',estimate:true}));
  log(s,'example-oat-drink',250);log(s,'bowl',1.5);log(s,'example-cottage-cheese',100);log(s,'apple',150);
  const d=F.day(s,'2026-01-20'),t=d.total;
  assert.equal(F.round(t.sums.energy_kcal,'kcal'),Math.round(120+1050+76+78));
  assert.ok(Math.abs(t.sums.salt_g-10.05)<1e-9,'0.25 + 9 + 0.8 g salt');
  assert.equal(t.unknown.fibre_g,2,'the bowl and the cottage cheese have no fibre value');
  assert.equal(F.round(t.sums.fibre_g,'g'),5.6);
  assert.equal(F.round(t.micros.vitamin_d_ug,'g'),2.8);assert.equal(t.microUnknown.vitamin_d_ug,3);
  assert.equal(Math.round(t.estimatedShare*100),6,'only the apple is an estimate');
  const status=Object.fromEntries(d.targets.map(x=>[x.key,x.status]));
  assert.deepEqual(status,{protein_g:'short',fibre_g:'short',saturated_fat_g:'under',salt_g:'over'});
  assert.equal(F.format(t.sums.energy_kcal,'kcal'),'1,324 kcal');assert.equal(F.format(null,'g'),'—');
});

test('days change at the configured time, search folds accents and ranks recent use',()=>{
  assert.equal(F.dayFor(new Date(2026,0,21,3,30),'04:00'),'2026-01-20');assert.equal(F.dayFor(new Date(2026,0,21,4,0),'04:00'),'2026-01-21');
  assert.equal(F.shiftDate('2026-03-01',-1),'2026-02-28');
  const s=imported();s.foods.push(F.food({id:'jordnotssmor',name:'Jordnötssmör',brand:'Exempel',kind:'product',basis:'g',nutrients:{energy_kcal:600},source:'label'}));
  assert.deepEqual(F.search(s,{query:'jordnotssmor'}).map(f=>f.id),['jordnotssmor']);
  assert.deepEqual(F.search(s,{query:'example dairy cottage'}).map(f=>f.id),['example-cottage-cheese']);
  log(s,'example-peanut-butter',15,{meal:'Snack',time:'10:00'});log(s,'example-oat-drink',200,{meal:'Snack',time:'21:00'});log(s,'example-crispbread',20);
  assert.deepEqual(F.search(s,{meal:'Snack'}).slice(0,2).map(f=>f.id),['example-oat-drink','example-peanut-butter']);
  by(s,'example-oat-drink').archived=true;assert.equal(F.search(s,{query:'oat'}).length,0);assert.equal(F.search(s,{query:'oat',archived:true}).length,1);
});

test('day export follows the food log shape',()=>{
  const s=imported();
  s.foods.push(F.food({id:'bowl',name:'Rice bowl',brand:'',kind:'dish',basis:'portion',nutrients:{energy_kcal:700,protein_g:30},source:'menu',estimate:false}));
  s.foods.push(F.food({id:'honey',name:'Honey',brand:'',kind:'generic',basis:'g',nutrients:{energy_kcal:304,sugars_g:82},source:'typical',estimate:true}));
  log(s,'example-cottage-cheese',30);log(s,'bowl',1,{meal:'Lunch',time:'12:30'});log(s,'honey',10,{note:'about 10 g'});
  s.days['2026-01-20']={notes:'Rest day',activity:'Walk\nStretching'};
  const out=F.exportDay(s,'2026-01-20');
  assert.deepEqual(Object.keys(out),['date','notes','activity','targets','meals','day_total_eaten','estimated_energy_share','exported_by']);
  assert.deepEqual(plain(out.activity),['Walk','Stretching']);assert.deepEqual(plain(out.targets),{protein_g:100,fibre_g:30,saturated_fat_g_max:25,salt_g_max:6});
  const [breakfast,lunch]=out.meals,cheese=breakfast.items[0],honey=breakfast.items[1];
  assert.equal(cheese.item,'Example Dairy Cottage Cheese 1.5%');assert.equal(cheese.amount_g,30);assert.equal(cheese.nutrition.protein_g,4.2);assert.equal(cheese.nutrition.fibre_g,null);
  assert.match(cheese.source,/file revision 3/);assert.equal(honey.estimate,true);assert.equal(honey.assumption,'about 10 g');
  assert.equal(lunch.items[0].amount,'1 portion');assert.equal(lunch.items[0].source,'menu values');
  assert.equal(out.day_total_eaten.energy_kcal,Math.round((22.8+700+30.4)*10)/10);assert.ok(out.day_total_eaten.unknown_items.fibre_g>=2);
});

test('validation rejects hostile or malformed foods, entries and settings',()=>{
  const ok={id:'a',name:'A',brand:'',kind:'generic',basis:'g',nutrients:{},source:'typical'};
  F.food(ok);
  for(const bad of [{id:'a@b'},{id:'has space'},{id:''},{name:''},{name:'x'.repeat(121)},{kind:'drink'},{basis:'oz'},{source:'guess'},
    {nutrients:{protein_g:-1}},{nutrients:{protein_g:'5'}},{nutrients:{protein_g:NaN}},{nutrients:{salt_g:10001}},{micros:{'<b>':1}},{micros:{protein_g:1}},
    {portions:Array.from({length:13},(_,i)=>({label:'p'+i,amount:1}))},{portions:[{label:'a',amount:1},{label:'A',amount:2}]},{portions:[{label:'a',amount:0}]},{estimate:'yes'},{details:'text'}])
    assert.throws(()=>F.food({...ok,...bad}),undefined,JSON.stringify(bad));
  const s=imported();log(s,'example-crispbread',20);const good=plain(s);
  for(const mutate of [x=>{x.entries[0].version='missing@00000000';},x=>{x.entries[0].date='2026-02-30';},x=>{x.entries[0].time='24:00';},x=>{x.entries[0].amount=0;},
    x=>{x.entries.push({...x.entries[0]});},x=>{x.foods.push({...x.foods[0]});},x=>{x.settings.targets.push({key:'sugars_g',kind:'max',value:50});},
    x=>{x.settings.targets.push({key:'protein_g',kind:'min',value:1});},x=>{x.settings.meals=[];},x=>{x.settings.meals=['A','a'];},x=>{x.settings.dayStart='4am';},x=>{x.days['2026-13-01']={notes:'x'};}])
  {const copy=plain(good);mutate(copy);assert.throws(()=>F.state(copy));}
  assert.equal(F.state(good).entries.length,1);
});

test('the storage adapter accepts its own version, refuses newer data and enforces limits',()=>{
  const s=imported();log(s,'example-crispbread',20);
  const raw={app:'foodlog',version:1,updatedAt:5,...plain(s)};
  assert.equal(Store.prepare(raw).entries.length,1);
  assert.throws(()=>Store.prepare({...raw,version:2}),/newer Foodlog version/);
  for(const bad of [{...raw,app:'tabata'},{...raw,version:0},{...raw,updatedAt:-1}])assert.throws(()=>Store.prepare(bad),/Not a valid Foodlog backup/);
  assert.throws(()=>Store.prepare({...raw,entries:Array.from({length:F.LIMITS.entries+1},(_,i)=>({...raw.entries[0],id:'x'+i}))}),/entries count limit/);
});
