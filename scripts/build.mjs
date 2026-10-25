import {readFile,writeFile,mkdir,cp,readdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const read=(...parts)=>readFile(join(root,...parts),'utf8');
const concat=async(dir,names)=>(await Promise.all(names.map(name=>read(dir,name)))).join('\n');
/* One site: the home page at /, each app in its own folder (/liftlog/,
   /bike-cardio/, /tabata/) with its own manifest scope and service worker.
   The host reads the root _headers and _redirects, so per-app policies are
   written there as path rules that never overlap.
   Source HTML and service workers hold an empty `/* name:start *\/ … /* name:end *\/`
   pair where each shared or extracted file goes. Only dist/ receives the code,
   so source files never carry a second copy of a module. Edit the canonical
   files; open or test the built app in dist/. */
const shared={
  'app-foundation':await concat('packages/app-ui',['foundation.js','comparisons.js','markdown.js']),
  'app-ui-styles':await concat('packages/app-ui',['themes.css','components.css']),
  'theme-bootstrap':await read('packages/app-ui','theme-bootstrap.js'),
  'storage-engine':await concat('packages/storage-engine',['local.js','remote.js','handoff.js','undo.js']),
  'storage-ui':await concat('packages/storage-ui',['remote-tools.js','handoff.js','status.js']),
  'app-updates':await read('packages/app-ui','updates.js')
};
const updateWorker=await read('packages/app-ui','update-worker.js');
const appModules={
  'bike-cardio':[['history-schema.js','bike-history-schema'],['storage-adapter.js','bike-storage-adapter'],['controllers/storage.js','bike-cardio-storage-controller'],
    ['presets.js','bike-presets'],['plan-ui.js','bike-plan-ui'],['targets.js','bike-targets'],['trace.js','bike-trace'],['heart-rate.js','bike-heart-rate'],['power.js','bike-power'],
    ['bluetooth.js','bike-bluetooth'],['plans.js','bike-plans'],['workout-core.js','bike-workout-core'],['history.js','bike-history']
  ],
  liftlog:[['controllers/exercises.js','liftlog-exercises-controller'],['controllers/routines.js','liftlog-routines-controller'],['controllers/workout.js','liftlog-workout-controller'],['storage-adapter.js','liftlog-storage-adapter'],['screens/settings.js','liftlog-settings-screen'],['comparisons.js','liftlog-comparisons']],
  tabata:[['bell-audio.js','tabata-bell-audio'],['timer-core.js','tabata-timer-core'],['storage-adapter.js','tabata-storage-adapter'],['app.js','tabata-app']],
  foodlog:[['food-core.js','foodlog-core'],['storage-adapter.js','foodlog-storage-adapter'],['app.js','foodlog-app']]
};
// Exactly one empty or filled marker pair, in order, or the build stops.
function fill(text,name,content,label){
  const start='/* '+name+':start */',end='/* '+name+':end */',first=text.indexOf(start),last=text.indexOf(end);
  if(first<0||last<first||text.indexOf(start,first+start.length)>=0||text.indexOf(end,last+end.length)>=0)
    throw new Error('Missing, duplicated or reversed markers: '+label+' ('+name+')');
  return text.slice(0,first)+start+'\n'+content+'\n'+end+text.slice(last+end.length);
}
const apps=['liftlog','bike-cardio','tabata','foodlog'],headerRules=[];
const hash=text=>createHash('sha256').update(text).digest('base64');
const hashes=(html,tag)=>[...html.matchAll(new RegExp('<'+tag+'\\b[^>]*>([\\s\\S]*?)<\\/'+tag+'>','g'))].map(m=>"'sha256-"+hash(m[1])+"'");
const security='  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n';
for(const app of apps){
  const source=join(root,'apps',app),output=join(root,'dist',app),workerName=app==='liftlog'?'sw.js':'service-worker.js';
  let html=await readFile(join(source,'index.html'),'utf8');
  for(const [name,content] of Object.entries(shared)){
    // Retain the existing apps' first-paint behavior; Tabata and Foodlog own their theme keys.
    const injected=(app==='tabata'||app==='foodlog')&&name==='theme-bootstrap'?content.replaceAll('bike-cardio.ui.theme',app+'.ui.theme'):content;
    html=fill(html,name,injected,app+'/index.html');
  }
  for(const [file,marker] of appModules[app])html=fill(html,marker,await readFile(join(source,file),'utf8'),app+'/'+file);
  if(app==='tabata'){
    // Direct source previews reference canonical files; releases embed them once.
    html=html.replace(' data-source-preview','')
      .replace(/<link\b[^>]*\bdata-source-only\b[^>]*>\s*/g,'')
      .replace(/<script\b[^>]*\bdata-source-only\b[^>]*>[\s\S]*?<\/script>\s*/g,'');
  }
  const worker=fill(await readFile(join(source,workerName),'utf8'),'app-update-worker',updateWorker,app+'/'+workerName);
  const versionMeta='<meta name="app-version" content="development">';
  if(!html.includes(versionMeta))throw new Error(app+'/index.html must contain '+versionMeta);
  // Include every runtime asset in the visible release version.
  const assets=app==='liftlog'
    ? ['index.html','manifest.webmanifest','sw.js','icons']
    : app==='tabata'?['index.html','manifest.webmanifest','service-worker.js','icon.svg','icon-180.png','icon-192.png','icon-512.png']
    : app==='foodlog'?['index.html','manifest.webmanifest','service-worker.js','icon.svg','icon-180.png','icon-192.png','icon-512.png','icon-maskable-512.png']
    : ['index.html','manifest.webmanifest','service-worker.js','icon-32.png','icon-192.png','icon-512.png','apple-touch-icon-180.png'];
  const releaseHash=createHash('sha256').update(html).update(worker);
  async function hashReleaseAsset(relative){
    if(relative==='index.html'||relative===workerName)return;
    const path=join(source,relative);
    const entries=await readdir(path,{withFileTypes:true}).catch(()=>null);
    if(entries){for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name)))await hashReleaseAsset(join(relative,entry.name));}
    else releaseHash.update(relative).update(await readFile(path));
  }
  for(const asset of assets)await hashReleaseAsset(asset);
  const version=releaseHash.digest('hex').slice(0,16);
  html=html.replace(versionMeta,'<meta name="app-version" content="'+version+'">');
  // Rebuild from an explicit runtime list so removed files cannot linger.
  await rm(output,{recursive:true,force:true});
  await mkdir(output,{recursive:true});
  for(const asset of assets)if(asset!=='index.html'&&asset!==workerName)await cp(join(source,asset),join(output,asset),{recursive:true});
  await writeFile(join(output,'index.html'),html);
  // Endpoint is user-configured, so HTTPS destinations must be allowed. Bucket
  // authorization and CORS still govern access to private workout backups.
  headerRules.push(`/${app}/*\n  Content-Security-Policy: default-src 'self'; script-src 'self' ${hashes(html,'script').join(' ')}; style-src 'self' ${hashes(html,'style').join(' ')}; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'\n${security}  Permissions-Policy: bluetooth=(self), screen-wake-lock=(self)\n\n/${app}/${workerName}\n  Cache-Control: no-cache\n`);
  const shellHash=createHash('sha256');
  async function hashAssets(directory){
    for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const path=join(directory,entry.name);
      if(entry.isDirectory())await hashAssets(path);
      else if(entry.name!==workerName){shellHash.update(path.slice(output.length));shellHash.update(await readFile(path));}
    }
  }
  await hashAssets(output);
  shellHash.update('/'+workerName).update(worker.replace(/const CACHE = '[^']+';/,"const CACHE = 'generated';"));
  await writeFile(join(output,workerName),worker.replace(/const CACHE = '[^']+';/,`const CACHE = '${app}-shell-${shellHash.digest('hex').slice(0,16)}';`));
  console.log(`Built ${app}: dist/${app}`);
}
// The home page and the site-wide files. `/` is an exact rule: a `/*` rule
// would also match every app and the host would join both policies.
const site=join(root,'dist');
const home=fill(await read('site','index.html'),'app-ui-themes',await read('packages/app-ui','themes.css'),'site/index.html');
await writeFile(join(site,'index.html'),home);
await cp(join(root,'site','404.html'),join(site,'404.html'));
const homeRule=`  Content-Security-Policy: default-src 'none'; style-src ${hashes(home,'style').join(' ')}; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'\n${security}  Permissions-Policy: bluetooth=(), screen-wake-lock=()\n`;
await writeFile(join(site,'_headers'),['/\n'+homeRule,'/index.html\n'+homeRule,...headerRules].join('\n'));
// Relative app URLs need the trailing slash.
await writeFile(join(site,'_redirects'),apps.map(app=>`/${app} /${app}/ 301`).join('\n')+'\n');
console.log('Built site: dist/ (home page, _headers, _redirects, 404.html)');
