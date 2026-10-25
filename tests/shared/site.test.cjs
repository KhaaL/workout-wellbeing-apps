// The built single site: one home page, one folder per app, non-overlapping header rules and separate install scopes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const dist=path.resolve(__dirname,'../../dist');
const apps={liftlog:'sw.js','bike-cardio':'service-worker.js',tabata:'service-worker.js',foodlog:'service-worker.js'};
const read=file=>fs.readFileSync(path.join(dist,file),'utf8');
const rules=read('_headers').split(/\n\n+/).filter(Boolean).map(block=>{const [pattern,...lines]=block.trim().split('\n');return {pattern,headers:lines.map(line=>line.trim())};});
// The host applies every matching rule; `*` matches anything, including nothing.
const matching=pathname=>rules.filter(({pattern})=>pattern.endsWith('*')?pathname.startsWith(pattern.slice(0,-1)):pathname===pattern);
const csp=pathname=>matching(pathname).flatMap(rule=>rule.headers).filter(h=>h.startsWith('Content-Security-Policy: '));

test('every page gets exactly one security policy',()=>{
  const paths=['/','/index.html',...Object.entries(apps).flatMap(([app,worker])=>['/'+app+'/','/'+app+'/index.html','/'+app+'/'+worker,'/'+app+'/manifest.webmanifest'])];
  for(const pathname of paths)assert.equal(csp(pathname).length,1,pathname);
  assert.equal(rules.some(rule=>rule.pattern==='/*'),false,'no rule covers the whole site');
  assert.match(csp('/')[0],/default-src 'none'/);assert.doesNotMatch(csp('/')[0],/script-src/,'the home page runs no scripts');
});
test('each app policy allows exactly its own inline scripts and styles',()=>{
  const hash=text=>"'sha256-"+createHash('sha256').update(text).digest('base64')+"'";
  for(const app of Object.keys(apps)){
    const html=read(app+'/index.html'),policy=csp('/'+app+'/')[0];
    for(const [tag,directive] of [['script','script-src'],['style','style-src']]){
      const expected=[...html.matchAll(new RegExp('<'+tag+'\\b[^>]*>([\\s\\S]*?)</'+tag+'>','g'))].map(m=>hash(m[1]));
      assert.deepEqual(policy.match(new RegExp(directive+" 'self' ([^;]*)"))[1].split(' '),expected,app+' '+directive);
    }
    assert.deepEqual(matching('/'+app+'/'+apps[app]).flatMap(r=>r.headers).filter(h=>h.startsWith('Cache-Control')),['Cache-Control: no-cache'],app+' worker revalidates');
  }
});
test('apps install separately inside their own folders',()=>{
  const ids=new Set();
  for(const [app,worker] of Object.entries(apps)){
    const base='https://apps.example/'+app+'/',manifest=JSON.parse(read(app+'/manifest.webmanifest')),url=new URL('manifest.webmanifest',base);
    const start=new URL(manifest.start_url,url).href,scope=new URL(manifest.scope,url).href,id=new URL(manifest.id,start).href;
    assert.deepEqual([start,scope,id],[base,base,base],app+' manifest');ids.add(id);
    for(const icon of manifest.icons)assert.ok(fs.existsSync(path.join(dist,app,new URL(icon.src,url).pathname.slice(app.length+2))),app+' icon '+icon.src);
    assert.match(read(app+'/index.html'),/<link rel="manifest" href="(\.\/)?manifest\.webmanifest">/,app+' links its manifest relatively');
    assert.ok(fs.existsSync(path.join(dist,app,worker)));
    for(const file of ['_headers','_redirects','404.html'])assert.equal(fs.existsSync(path.join(dist,app,file)),false,app+' has no '+file+' of its own');
  }
  assert.equal(ids.size,Object.keys(apps).length);
});
test('the home page links every app and installs nothing itself',()=>{
  const home=read('index.html');
  for(const app of Object.keys(apps))assert.match(home,new RegExp('href="'+app+'/"'),app+' link');
  for(const src of home.match(/src="[^"]+"/g))assert.ok(fs.existsSync(path.join(dist,src.slice(5,-1))),src);
  assert.doesNotMatch(home,/rel="manifest"|serviceWorker|<script/);
  assert.match(read('404.html'),/Content-Security-Policy" content="default-src 'none'/);
  assert.deepEqual(read('_redirects').trim().split('\n'),Object.keys(apps).map(app=>`/${app} /${app}/ 301`));
});
