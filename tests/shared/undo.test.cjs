const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {webcrypto}=require('node:crypto');
function setup(){
 const map=new Map(),messages=[],state={a:{value:1},b:{value:2}};
 const storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
 const ctx=vm.createContext({localStorage:storage,crypto:webcrypto,console,TextEncoder,setTimeout,clearTimeout});
 for(const file of ['local','undo'])vm.runInContext(fs.readFileSync('packages/storage-engine/'+file+'.js','utf8'),ctx);
 const opts={key:'recent',read:t=>state[t.id]||null,apply:(t,v)=>{if(v)state[t.id]=v;else delete state[t.id];return true;},notify:m=>messages.push(m)};
 return {map,state,storage,messages,opts,j:ctx.WorkoutStorage.createUndo(opts),create:()=>ctx.WorkoutStorage.createUndo(opts)};
}
test('undo survives reload and preserves unrelated records; newer edits block restoration',()=>{
 const d=setup();d.state.a={value:3};const entry=d.j.record({target:{id:'a'},before:{value:1},after:{value:3},label:'Edit'});
 d.state.b={value:9};d.create().undo(entry.id);assert.equal(d.state.a.value,1);assert.equal(d.state.b.value,9);
 d.state.a={value:4};const newer=d.j.record({target:{id:'a'},before:{value:1},after:{value:4},label:'Edit'});d.state.a.value=5;
 assert.throws(()=>d.j.undo(newer.id),/changed/);assert.equal(d.state.a.value,5);assert.equal(d.j.list().length,1);
});
test('deleted record recovery refuses duplicate identity and retains entry on failed save',()=>{
 const d=setup();delete d.state.a;const entry=d.j.record({target:{id:'a'},before:{value:1},after:null,label:'Deleted',deleted:true});
 d.opts.apply=()=>false;assert.throws(()=>d.create().undo(entry.id),/could not be saved/);assert.equal(d.j.list().length,1);
 d.opts.apply=(t,v)=>{d.state[t.id]=v;return true;};d.create().undo(entry.id);assert.equal(d.state.a.value,1);
 const duplicate=d.j.record({target:{id:'a'},before:{value:7},after:null,label:'Deleted',deleted:true});assert.throws(()=>d.j.undo(duplicate.id),/changed/);
});
test('journal is bounded, coalesces typing, and preserves corrupt recovery bytes',()=>{
 const d=setup();for(let i=0;i<40;i++)d.j.record({target:{id:'a'},before:{value:i},after:{value:i+1},label:'Edit'});assert.equal(d.j.list().length,30);
 d.map.clear();d.j.record({target:{id:'a'},before:{value:1},after:{value:2},label:'Typing',coalesce:true});d.j.record({target:{id:'a'},before:{value:2},after:{value:3},label:'Typing',coalesce:true});assert.equal(d.j.list().length,1);assert.equal(d.j.list()[0].before.value,1);
 d.map.set('recent','{broken');assert.equal(d.j.record({target:{id:'a'},before:1,after:2,label:'Edit'}),null);assert.equal(d.map.get('recent'),'{broken');assert(d.messages.length);
});
test('quota failure does not claim Undo is available; handoff blocks restoration',()=>{
 const d=setup();d.storage.setItem=()=>{throw Error('quota');};assert.equal(d.j.record({target:{id:'a'},before:1,after:2,label:'Edit'}),null);assert.equal(d.j.list().length,0);assert.match(d.messages[0],/Undo could not/);
 d.opts.blocked=()=>true;assert.throws(()=>d.create().undo('any'),/handoff/);
});

test('deletion stages recovery first and cancels when recovery storage is unavailable',()=>{
 const d=setup();let commits=0;const change={target:{id:'a'},before:{value:1},after:null,label:'Deleted',deleted:true};
 d.storage.setItem=()=>{throw Error('quota');};assert.throws(()=>d.j.protect(change,()=>{commits++;return true;}),/Nothing deleted/);assert.equal(commits,0);assert.equal(d.state.a.value,1);
 d.storage.setItem=(k,v)=>d.map.set(k,v);d.storage.removeItem=k=>d.map.delete(k);
 assert.throws(()=>d.j.protect(change,()=>false),/could not be saved/);assert.equal(d.j.list().length,0);
 d.j.protect(change,()=>{assert.equal(d.j.list()[0].before.value,1);delete d.state.a;return true;});d.j.undo(d.j.list()[0].id);assert.equal(d.state.a.value,1);
});
