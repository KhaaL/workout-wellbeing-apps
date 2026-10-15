import {readFile,writeFile,mkdir,cp,readdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const selected=process.argv[2];
const read=(...parts)=>readFile(join(root,...parts),'utf8');
const concat=async(dir,names)=>(await Promise.all(names.map(name=>read(dir,name)))).join('\n');
/* Source HTML and service workers hold an empty `/* name:start *\/ … /* name:end *\/`
   pair where each shared or extracted file goes. Only dist/ receives the code,
   so source files never carry a second copy of a module. Edit the canonical
   files; open or test the built app in dist/. */
const shared={
  'app-foundation':await concat('packages/app-ui',['foundation.js','comparisons.js']),
  'app-ui-styles':await concat('packages/app-ui',['themes.css','components.css']),
  'theme-bootstrap':await read('packages/app-ui','theme-bootstrap.js'),
  'storage-engine':await concat('packages/storage-engine',['local.js','remote.js','handoff.js','undo.js']),
  'storage-ui':await concat('packages/storage-ui',['remote-tools.js','handoff.js','status.js']),
  'app-updates':await read('packages/app-ui','updates.js')
};
const updateWorker=await read('packages/app-ui','update-worker.js');
const appModules={
  'bike-cardio':[['history-schema.js','bike-history-schema'],['storage-adapter.js','bike-storage-adapter'],['controllers/storage.js','bike-cardio-storage-controller'],
    ['presets.js','bike-presets'],['targets.js','bike-targets'],['trace.js','bike-trace'],['heart-rate.js','bike-heart-rate'],['power.js','bike-power'],
    ['bluetooth.js','bike-bluetooth'],['workout-core.js','bike-workout-core'],['history.js','bike-history']
  ],
  liftlog:[['controllers/exercises.js','liftlog-exercises-controller'],['controllers/routines.js','liftlog-routines-controller'],['controllers/workout.js','liftlog-workout-controller'],['storage-adapter.js','liftlog-storage-adapter'],['screens/settings.js','liftlog-settings-screen'],['comparisons.js','liftlog-comparisons']]
};
// Exactly one empty or filled marker pair, in order, or the build stops.
function fill(text,name,content,label){
  const start='/* '+name+':start */',end='/* '+name+':end */',first=text.indexOf(start),last=text.indexOf(end);
  if(first<0||last<first||text.indexOf(start,first+start.length)>=0||text.indexOf(end,last+end.length)>=0)
    throw new Error('Missing, duplicated or reversed markers: '+label+' ('+name+')');
  return text.slice(0,first)+start+'\n'+content+'\n'+end+text.slice(last+end.length);
}
for(const app of selected?[selected]:['liftlog','bike-cardio']){
  if(!['liftlog','bike-cardio'].includes(app))throw new Error('Unknown app: '+app);
  const source=join(root,'apps',app),output=join(root,'dist',app),workerName=app==='liftlog'?'sw.js':'service-worker.js';
  let html=await readFile(join(source,'index.html'),'utf8');
  for(const [name,content] of Object.entries(shared))html=fill(html,name,content,app+'/index.html');
  for(const [file,marker] of appModules[app])html=fill(html,marker,await readFile(join(source,file),'utf8'),app+'/'+file);
  const worker=fill(await readFile(join(source,workerName),'utf8'),'app-update-worker',updateWorker,app+'/'+workerName);
  const versionMeta='<meta name="app-version" content="development">';
  if(!html.includes(versionMeta))throw new Error(app+'/index.html must contain '+versionMeta);
  // Include every runtime asset in the visible release version.
  const assets=app==='liftlog'
    ? ['index.html','manifest.webmanifest','sw.js','icons']
    : ['index.html','manifest.webmanifest','service-worker.js','icon-32.png','icon-192.png','icon-512.png','apple-touch-icon-180.png','404.html','_redirects'];
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
  const hash=text=>createHash('sha256').update(text).digest('base64');
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>"'sha256-"+hash(m[1])+"'");
  const styles=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m=>"'sha256-"+hash(m[1])+"'");
  // Endpoint is user-configured, so HTTPS destinations must be allowed. Bucket
  // authorization and CORS still govern access to private workout backups.
  const headers=`/*\n  Content-Security-Policy: default-src 'self'; script-src 'self' ${scripts.join(' ')}; style-src 'self' ${styles.join(' ')}; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  Permissions-Policy: bluetooth=(self), screen-wake-lock=(self)\n\n/${workerName}\n  Cache-Control: no-cache\n`;
  await writeFile(join(output,'_headers'),headers);
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
