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
  assert.deepEqual(plain(r.targets),[{key:'protein_g',kind:'min',value:100},{key:'fibre_g',kind:'min',value:30},{key:'saturated_fat_g',kind:'max',value:25},{key:'salt_g',kind:'max',value:6},{key:'free_sugars_g',kind:'max',value:50}]);
  assert.deepEqual(plain(r.ignoredTargets),[],'the sugar limit becomes a free sugars limit');
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
  assert.deepEqual(status,{protein_g:'short',fibre_g:'short',saturated_fat_g:'under',salt_g:'over',free_sugars_g:'under'});
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
  assert.deepEqual(plain(out.activity),['Walk','Stretching']);assert.deepEqual(plain(out.targets),{protein_g:100,fibre_g:30,saturated_fat_g_max:25,salt_g_max:6,free_sugars_g_max:50});
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
  assert.equal(Store.prepare(raw).entries.length,1);assert.equal(Store.prepare(raw).version,3,'version 1 data loads as version 3');assert.equal(Store.prepare({...raw,version:2}).version,3);
  const untimed={...raw,version:2,entries:[{...raw.entries[0],time:undefined}],days:{'2026-01-20':{meals:['Snack','Breakfast']}}};
  assert.equal(Store.prepare(untimed).entries[0].time,undefined,'version 2 allows entries without a time');
  assert.deepEqual(plain(Store.prepare(untimed).days['2026-01-20'].meals),['Snack','Breakfast']);
  assert.throws(()=>Store.prepare({...raw,version:4}),/newer Foodlog version/);
  for(const bad of [{...raw,app:'tabata'},{...raw,version:0},{...raw,updatedAt:-1}])assert.throws(()=>Store.prepare(bad),/Not a valid Foodlog backup/);
  assert.throws(()=>Store.prepare({...raw,entries:Array.from({length:F.LIMITS.entries+1},(_,i)=>({...raw.entries[0],id:'x'+i}))}),/entries count limit/);
});

// A day file shaped like a typical review log: staple items without ids, typical-value items, a menu dish,
// an amount in grams for a 100 ml food, a repeated item, assistant fields to ignore and one bad item.
function reviewDay(){
  const item=(name,amount,n,extra={})=>({item:name,...amount,source:extra.source||'catalog rev 3',nutrition:n,...extra.more});
  const per=(base,factor)=>Object.fromEntries(Object.entries(base).map(([k,v])=>[k,v==null?null:Math.round(v*factor*100)/100]));
  const cheese={energy_kcal:76,protein_g:14,carbohydrate_g:2,sugars_g:2,fibre_g:null,fat_g:1.5,saturated_fat_g:1,salt_g:0.8};
  const peanut={energy_kcal:625,protein_g:26,carbohydrate_g:13,sugars_g:5,fibre_g:null,fat_g:50,saturated_fat_g:6.5,salt_g:0.7};
  const oat={energy_kcal:48,protein_g:1,carbohydrate_g:7,sugars_g:3.4,fibre_g:0.8,fat_g:1.5,saturated_fat_g:0.2,salt_g:0.1};
  const honey={energy_kcal:30.4,protein_g:0.03,carbohydrate_g:8.2,sugars_g:8.2,fibre_g:0,fat_g:0,saturated_fat_g:0,salt_g:0};
  return {date:'2026-01-21',notes:'Rough day.',activity:['Gym','Walk'],targets:{protein_g:'100 (anchor)',salt_g_max:6},
    meals:[
      {meal:'breakfast',timing:'before training',items:[
        item('Example Dairy Cottage Cheese, 30 g',{amount_g:30},per(cheese,0.3)),
        item('Peanut butter',{amount_g:15},{...per(peanut,0.15),fibre_g:1.2}),
        item('Honey',{amount_g:10},honey,{source:'typical values, estimate',more:{assumption:'about 10 g'}})]},
      {meal:'Post-workout',items:[item('Oat drink',{amount_g:125},per(oat,1.25)),{item:'Broken',amount_g:-5,nutrition:{}}]},
      {meal:'Lunch',items:[item('Teriyaki bowl',{amount:'1 portion'},{energy_kcal:726,protein_g:31.3,carbohydrate_g:112,sugars_g:42,fibre_g:4,fat_g:18.6,saturated_fat_g:4.2,salt_g:6.2},{source:'restaurant menu values'})]},
      {meal:'Bedtime',items:[item('Honey',{amount_g:7},per({energy_kcal:304,protein_g:0.3,carbohydrate_g:82,sugars_g:82,fibre_g:0,fat_g:0,saturated_fat_g:0,salt_g:0},0.07),{source:'typical values, estimate'})]}],
    day_total_eaten:{energy_kcal:1000,protein_g:50},day_summary:{salt:'over'}};
}
let ids=0;const nextId=name=>F.fold(name).replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')+'-'+(++ids);

test('a review-style day file links staples by values, adds other foods once and keeps the meal order',()=>{
  const s=imported(),p=F.planDayImport(reviewDay(),s,nextId),how=p.meals.map(m=>[m.meal,m.items.map(i=>i.how)]);
  assert.deepEqual(plain(how),[['Breakfast',['values','values','new']],['Post-workout',['values']],['Lunch',['new']],['Bedtime',['again']]]);
  assert.equal(p.meals[0].items[0].food.id,'example-cottage-cheese');assert.equal(p.meals[1].items[0].food.id,'example-oat-drink','grams count as millilitres');
  assert.deepEqual(plain(p.meals[0].items[1].filled),['fibre_g'],'the file fills the fibre the catalog lacks');
  assert.equal(p.newFoods.length,2);const [honey,bowl]=p.newFoods;
  assert.deepEqual([honey.basis,honey.source,honey.estimate,honey.nutrients.energy_kcal],['g','typical',true,304]);
  assert.deepEqual([bowl.basis,bowl.kind,bowl.source,bowl.estimate,bowl.nutrients.salt_g],['portion','dish','menu',false,6.2]);
  assert.deepEqual(plain(p.skipped.map(x=>x.item)),['Broken']);assert.deepEqual(plain(p.ignored),['targets','day_summary','timing']);
  assert.equal(p.meals[0].meal,'Breakfast','a meal name matching the list uses its spelling');
  F.applyDayImport(s,p,'replace',()=>'e'+(++ids));
  const d=F.day(s,'2026-01-21');
  assert.deepEqual(plain(d.meals.map(m=>m.meal)),['Breakfast','Post-workout','Lunch','Bedtime','Dinner','Snack']);
  assert.equal(d.total.count,6);assert.equal(d.total.unknown.fibre_g,1,'only the cottage cheese lacks fibre now');
  assert.equal(s.entries.find(e=>e.note==='about 10 g').time,undefined,'no time is invented');
  assert.equal(s.days['2026-01-21'].notes,'Rough day.');assert.equal(s.days['2026-01-21'].activity,'Gym\nWalk');
  assert.ok(F.state(plain(s)),'the result stays valid');
});

test('day imports link by food_id and name, keep differing file values, and add to or replace a day',()=>{
  const s=imported();log(s,'example-crispbread',20,{date:'2026-01-21'});
  const raw={date:'2026-01-21',meals:[{meal:'Snack',time:'15:00',items:[
    {item:'Anything',food_id:'example-oat-drink',amount_ml:200,nutrition:{energy_kcal:96,protein_g:2}},
    {item:'Example Pantry Peanut Butter Crunchy',amount_g:20,nutrition:{energy_kcal:200,protein_g:9}},
    {item:'Mystery',amount_g:10}]}]};
  const p=F.planDayImport(raw,s,nextId),[byId,byName]=p.meals[0].items;
  assert.deepEqual([byId.how,byId.differs,byName.how,byName.differs],['id',false,'name',true]);
  assert.equal(byName.version.value.nutrients.energy_kcal,1000,'the day keeps the file’s values per 100 g');
  assert.match(p.skipped[0].reason,/no nutrition values/);assert.equal(p.existing,1);
  const copy=plain(s);F.applyDayImport(copy,p,'add',()=>'a'+(++ids));assert.equal(copy.entries.filter(e=>e.date==='2026-01-21').length,3);
  F.applyDayImport(s,p,'replace',()=>'r'+(++ids));assert.equal(s.entries.filter(e=>e.date==='2026-01-21').length,2);
  assert.ok(s.entries.every(e=>e.date!=='2026-01-21'||e.time==='15:00'),'a meal time applies to its items');
  assert.equal(by(s,'example-pantry-peanut-butter'),undefined);
  for(const bad of [{},{date:'2026-02-30',meals:[]},{date:'2026-01-21'},{date:'2026-01-21',meals:Array.from({length:21},()=>({meal:'m',items:[]}))}])assert.throws(()=>F.planDayImport(bad,s,nextId));
});

test('the sample files import: the day links to the sample catalog and round-trips its totals',()=>{
  const files=F.samples('2026-01-19'),s=empty(),r=F.importCatalog(files.catalog,s);s.foods=r.foods;
  assert.equal(r.report.added.length,5);assert.deepEqual(plain(r.report.skipped),[]);
  const p=F.planDayImport(files.day,s,nextId);
  assert.deepEqual(plain(p.meals.flatMap(m=>m.items.map(i=>i.how))),['id','id','id','id','id']);assert.equal(p.newFoods.length,0);
  F.applyDayImport(s,p,'replace',()=>'s'+(++ids));
  assert.equal(JSON.stringify(F.exportDay(s,'2026-01-19').day_total_eaten),JSON.stringify(files.day.day_total_eaten),'export → import → export keeps the totals');
  const fresh=empty(),q=F.planDayImport(files.day,fresh,nextId);assert.equal(q.newFoods.length,5,'without the catalog, each item becomes a food');
});

test('free sugars follow each food’s mark, live on every day; sugar-free items count as 0',()=>{
  const s=imported();
  s.foods.push(F.food({id:'honey',name:'Honey',brand:'',kind:'generic',basis:'g',nutrients:{energy_kcal:304,sugars_g:82},source:'typical',estimate:true}));
  log(s,'honey',10);log(s,'example-oat-drink',200);log(s,'example-protein-powder',20);
  let t=F.day(s,'2026-01-20').total;
  assert.equal(t.sums.free_sugars_g,0);assert.equal(t.unknown.free_sugars_g,2,'honey and oat drink are not marked; the powder has no sugars');
  by(s,'honey').freeSugars='yes';by(s,'example-oat-drink').freeSugars='no';
  t=F.day(s,'2026-01-20').total;assert.equal(F.round(t.sums.free_sugars_g,'g'),8.2);assert.equal(t.unknown.free_sugars_g,0,'marking a food updates days already logged');
  const limit=F.day(s,'2026-01-20').targets.find(x=>x.key==='free_sugars_g');assert.deepEqual([limit.status,limit.value],['under',50]);
  assert.throws(()=>F.food({...by(s,'honey'),freeSugars:'maybe'}),/free sugars mark/);
});

test('vitamin and mineral targets count only foods that list a value',()=>{
  const s=imported();s.settings.targets.push({key:'vitamin_d_ug',kind:'min',value:10});
  log(s,'example-oat-drink',250);log(s,'example-crispbread',40);
  const target=F.day(s,'2026-01-20').targets.find(x=>x.key==='vitamin_d_ug');
  assert.deepEqual([F.round(target.current,'g'),target.missing,target.status],[2.8,1,'short']);
  const none=imported();none.settings.targets.push({key:'iron_mg',kind:'min',value:9});log(none,'example-crispbread',40);
  assert.deepEqual([F.day(none,'2026-01-20').targets.at(-1).current,F.day(none,'2026-01-20').targets.at(-1).missing],[0,1],'no item lists iron, so it is unknown');
  assert.deepEqual(plain(F.describe('vitamin_d_ug')),{label:'Vitamin D',unit:'µg'});assert.deepEqual(plain(F.describe('free_sugars_g')),{label:'Free sugars',unit:'g'});
  assert.ok(F.settings({targets:[{key:'calcium_mg',kind:'min',value:800}]}));assert.throws(()=>F.settings({targets:[{key:'sugars_g',kind:'max',value:50}]}));
});

test('favourites rank after this meal’s recent foods and travel in the catalog file',()=>{
  const s=imported();log(s,'example-crispbread',20,{meal:'Snack'});log(s,'example-crispbread',20,{meal:'Lunch'});
  by(s,'example-peanut-butter').favourite=true;
  assert.deepEqual(F.search(s,{meal:'Breakfast'}).slice(0,2).map(f=>f.id),['example-peanut-butter','example-crispbread'],'a favourite beats a more used food');
  assert.equal(F.search(s,{meal:'Snack'})[0].id,'example-crispbread','this meal’s recent food stays first');
  by(s,'example-cottage-cheese').freeSugars='no';
  const out=F.exportCatalog(s,0),pb=out.products.find(p=>p.id==='example-peanut-butter');
  assert.equal(pb.foodlog.favourite,true);assert.equal(out.products.find(p=>p.id==='example-cottage-cheese').foodlog.free_sugars,'no');
  assert.equal(out.personal_budgets_per_day.limit.sugar_g,50,'the free sugars limit keeps the file’s sugar_g name');assert.equal(out.personal_budgets_per_day.limit.free_sugars_g,undefined);
  const fresh=empty(),r=F.importCatalog(out,fresh);
  assert.equal(r.foods.find(f=>f.id==='example-peanut-butter').favourite,true);assert.equal(r.foods.find(f=>f.id==='example-cottage-cheese').freeSugars,'no');
  const plainFile=catalog(),merged=F.importCatalog(plainFile,s).foods;
  assert.equal(merged.find(f=>f.id==='example-peanut-butter').favourite,true,'a local favourite survives a file without one');
  assert.equal(merged.find(f=>f.id==='example-cottage-cheese').freeSugars,'no','a local mark survives a file without one');
});

test('copying a meal logs current catalog values, keeps amounts, and falls back to the original values',()=>{
  const s=imported();
  log(s,'example-cottage-cheese',150,{date:'2026-01-19',time:'07:10',portion:'',note:'big bowl'});log(s,'example-crispbread',24,{date:'2026-01-19',time:'07:10'});
  log(s,'example-oat-drink',200,{date:'2026-01-18',meal:'Snack'});log(s,'example-crispbread',12,{date:'2026-01-02'});
  const meals=F.recentMeals(s,'2026-01-20','Breakfast');
  assert.deepEqual(plain(meals.map(m=>m.date+' '+m.meal)),['2026-01-19 Breakfast','2026-01-18 Snack'],'same meal first, 14 days back only');
  by(s,'example-cottage-cheese').nutrients.protein_g=15;s.foods=s.foods.filter(f=>f.id!=='example-crispbread');
  const copied=F.copyMeal(s,meals[0],'2026-01-20','Breakfast',()=>'c'+(++n));
  assert.equal(copied.length,2);assert.deepEqual([copied[0].amount,copied[0].time,copied[0].note],[150,'07:10','big bowl']);
  const d=F.day(s,'2026-01-20');assert.equal(d.total.sums.protein_g,22.5+2.88,'cottage cheese at today’s 15 g; the deleted crispbread at its logged values');
  assert.ok(F.state(plain(s)));
  assert.throws(()=>F.copyMeal(s,meals[0],'2026-02-30','Breakfast',()=>'x'));
});

test('7-day trends average days with food, count days on target and compare with the week before',()=>{
  const s=imported();
  for(const [date,grams] of [['2026-01-20',500],['2026-01-18',300],['2026-01-12',100]])log(s,'example-cottage-cheese',grams,{date});
  const t=F.trends(s,'2026-01-20'),protein=t.current.rows.find(r=>r.key==='protein_g'),before=t.previous.rows.find(r=>r.key==='protein_g');
  assert.deepEqual([t.current.days,t.current.from,t.previous.days],[2,'2026-01-14',1]);
  assert.equal(protein.average,(70+42)/2);assert.equal(before.average,14);
  assert.equal(protein.onTarget,0,'neither day reached 100 g');assert.equal(t.current.rows.find(r=>r.key==='fibre_g').partial,2,'cottage cheese has no fibre value');
  assert.equal(t.current.rows[0].key,'energy_kcal');
  assert.equal(t.current.rows.find(r=>r.key==='free_sugars_g').onTarget,0,'cottage cheese sugars are unmarked, so the limit cannot be judged');
  by(s,'example-cottage-cheese').freeSugars='no';assert.equal(F.trends(s,'2026-01-20').current.rows.find(r=>r.key==='free_sugars_g').onTarget,2);
});
