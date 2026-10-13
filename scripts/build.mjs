import {readFile,writeFile,mkdir,cp,readdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const selected=process.argv[2];
const engine=(await Promise.all(['local.js','remote.js','handoff.js','undo.js'].map(name=>readFile(join(root,'packages/storage-engine',name),'utf8')))).join('\n');
const presentation=(await Promise.all(['remote-tools.js','handoff.js'].map(name=>readFile(join(root,'packages/storage-ui',name),'utf8')))).join('\n');
const updates=await readFile(join(root,'packages/app-ui/updates.js'),'utf8');
const updateWorker=await readFile(join(root,'packages/app-ui/update-worker.js'),'utf8');
const foundation=(await Promise.all(['foundation.js','comparisons.js'].map(name=>readFile(join(root,'packages/app-ui',name),'utf8')))).join('\n');
const uiStyles=(await Promise.all(['themes.css','components.css'].map(name=>readFile(join(root,'packages/app-ui',name),'utf8')))).join('\n');
const start='/* storage-engine:start */',end='/* storage-engine:end */';
const appModules={
  'bike-cardio':[
    ['presets.js','bike-presets'],['targets.js','bike-targets'],['heart-rate.js','bike-heart-rate'],
    ['bluetooth.js','bike-bluetooth'],['workout-core.js','bike-workout-core']
  ],
  liftlog:[['storage-adapter.js','liftlog-storage-adapter'],['screens/settings.js','liftlog-settings-screen'],['comparisons.js','liftlog-comparisons']]
};
async function embedAppModules(html,source,app){
  for(const [file,marker]of appModules[app]){
    const start='/* '+marker+':start */',end='/* '+marker+':end */';
    const first=html.indexOf(start),last=html.indexOf(end);
    if(first<0||last<first||html.indexOf(start,first+start.length)>=0||html.indexOf(end,last+end.length)>=0)
      throw new Error('Missing, duplicated or reversed module markers: '+app+'/'+file);
    const code=await readFile(join(source,file),'utf8');
    html=html.slice(0,first)+start+'\n'+code+'\n'+end+html.slice(last+end.length);
  }
  return html;
}
for(const app of selected?[selected]:['liftlog','bike-cardio']){
  if(!['liftlog','bike-cardio'].includes(app))throw new Error('Unknown app: '+app);
  const source=join(root,'apps',app),output=join(root,'dist',app);
  let html=await readFile(join(source,'index.html'),'utf8');
  html=await embedAppModules(html,source,app);
  const foundationStart='/* app-foundation:start */',foundationEnd='/* app-foundation:end */';
  const foundationInline=foundationStart+'\n'+foundation+'\n'+foundationEnd;
  if(html.includes(foundationStart))html=html.slice(0,html.indexOf(foundationStart))+foundationInline+html.slice(html.indexOf(foundationEnd)+foundationEnd.length);
  else html=html.replace(/<script\b/,'<script>\n'+foundationInline+'\n</script>\n<script');
  const styleInline='<style id="app-ui-styles">\n'+uiStyles+'\n</style>';
  if(html.includes('<style id="app-ui-styles">'))html=html.replace(/<style id="app-ui-styles">[\s\S]*?<\/style>/,()=>styleInline);
  else html=html.replace('</head>',styleInline+'\n</head>');
  const inline=start+'\n'+engine+'\n'+end;
  if(app==='bike-cardio'){
    const history=await readFile(join(source,'history.js'),'utf8'),hStart='/* bike-history:start */',hEnd='/* bike-history:end */';
    const hInline=hStart+'\n'+history+'\n'+hEnd;
    if(html.includes(hStart))html=html.slice(0,html.indexOf(hStart))+hInline+html.slice(html.indexOf(hEnd)+hEnd.length);
    else html=html.replace('</script>\n<script>\n(() => {',hInline+'\n</script>\n<script>\n(() => {');
    const adapter=await readFile(join(source,'storage-adapter.js'),'utf8');
    const a='/* bike-storage-adapter:start */',b='/* bike-storage-adapter:end */';
    if(html.includes(a))html=html.slice(0,html.indexOf(a))+a+'\n'+adapter+'\n'+b+html.slice(html.indexOf(b)+b.length);
    else html=html.replace(/(<script(?: [^>]*)?>)/,'$1\n'+a+'\n'+adapter+'\n'+b);
  }
  if(html.includes(start))html=html.slice(0,html.indexOf(start))+inline+html.slice(html.indexOf(end)+end.length);
  else html=html.replace(/(<script(?: [^>]*)?>)/, '$1\n'+inline);
  const uiStart='/* storage-ui:start */',uiEnd='/* storage-ui:end */';
  const uiInline=uiStart+'\n'+presentation+'\n'+uiEnd;
  if(html.includes(uiStart))html=html.slice(0,html.indexOf(uiStart))+uiInline+html.slice(html.indexOf(uiEnd)+uiEnd.length);
  else html=html.replace(end,end+'\n'+uiInline);
  const uStart='/* app-updates:start */',uEnd='/* app-updates:end */',uInline=uStart+'\n'+updates+'\n'+uEnd;
  if(html.includes(uStart))html=html.slice(0,html.indexOf(uStart))+uInline+html.slice(html.indexOf(uEnd)+uEnd.length);
  else html=html.replace(uiEnd,uiEnd+'\n'+uInline);
  // Generated inline section keeps source copies directly runnable and tests
  // exercising exactly the same engine bytes that Pages will serve.
  const versionMeta='<meta name="app-version" content="development">';
  html=/<meta name="app-version"[^>]*>/.test(html)?html.replace(/<meta name="app-version"[^>]*>/,versionMeta):html.replace('<head>','<head>\n'+versionMeta);
  await writeFile(join(source,'index.html'),html);
  const workerName=app==='liftlog'?'sw.js':'service-worker.js';
  let sourceWorker=await readFile(join(source,workerName),'utf8');
  const wStart='/* app-update-worker:start */',wEnd='/* app-update-worker:end */',wInline=wStart+'\n'+updateWorker+'\n'+wEnd;
  if(sourceWorker.includes(wStart))sourceWorker=sourceWorker.slice(0,sourceWorker.indexOf(wStart))+wInline+sourceWorker.slice(sourceWorker.indexOf(wEnd)+wEnd.length);
  else sourceWorker+='\n'+wInline+'\n';
  await writeFile(join(source,workerName),sourceWorker);
  // Include every runtime asset in the visible release version.
  const assets=app==='liftlog'
    ? ['index.html','manifest.webmanifest','sw.js','icons']
    : ['index.html','manifest.webmanifest','service-worker.js','icon-32.png','icon-192.png','icon-512.png','apple-touch-icon-180.png','404.html','_redirects'];
  const releaseHash=createHash('sha256').update(html).update(sourceWorker);
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
  for(const asset of assets)await cp(join(source,asset),join(output,asset),{recursive:true});
  await writeFile(join(output,'index.html'),html);
  const hash=text=>createHash('sha256').update(text).digest('base64');
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>"'sha256-"+hash(m[1])+"'");
  const styles=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m=>"'sha256-"+hash(m[1])+"'");
  // Endpoint is user-configured, so HTTPS destinations must be allowed. Bucket
  // authorization and CORS still govern access to private workout backups.
  const headers=`/*\n  Content-Security-Policy: default-src 'self'; script-src 'self' ${scripts.join(' ')}; style-src 'self' ${styles.join(' ')}; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  Permissions-Policy: bluetooth=(self), screen-wake-lock=(self)\n\n/${app==='liftlog'?'sw.js':'service-worker.js'}\n  Cache-Control: no-cache\n`;
  await writeFile(join(output,'_headers'),headers);
  const swName=app==='liftlog'?'sw.js':'service-worker.js';
  let sw=await readFile(join(output,swName),'utf8');
  const shellHash=createHash('sha256');
  async function hashAssets(directory){
    for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const path=join(directory,entry.name);
      if(entry.isDirectory())await hashAssets(path);
      else {
        shellHash.update(path.slice(output.length));
        const bytes=await readFile(path);
        shellHash.update(entry.name===swName?bytes.toString().replace(/const CACHE = '[^']+';/,"const CACHE = 'generated';"):bytes);
      }
    }
  }
  await hashAssets(output);
  sw=sw.replace(/const CACHE = '[^']+';/,`const CACHE = '${app}-shell-${shellHash.digest('hex').slice(0,16)}';`);
  await writeFile(join(output,swName),sw);
  console.log(`Built ${app}: dist/${app}`);
}
