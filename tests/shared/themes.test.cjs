const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const css=fs.readFileSync(path.join(root,'packages/app-ui/themes.css'),'utf8');
const list=(file,name)=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8').match(new RegExp('const '+name+'\\s*=\\s*(\\[[^\\]]*\\])'))[1].replaceAll("'",'"'));
const adaptive=list('packages/app-ui/foundation.js','adaptive').filter(id=>id!=='system');
const tokens=['bg','surface','surface-2','text','muted','border','border-strong','accent','accent-strong','on-accent','accent-soft',
  'danger','danger-strong','danger-soft','success','success-soft','either','warning','warning-soft','focus','shadow-sm','shadow-md'];

// Theme blocks inside `@media (prefers-color-scheme: dark){…}` are dark palettes.
const darkRanges=[];
for(let at=css.indexOf('@media (prefers-color-scheme: dark)');at>=0;at=css.indexOf('@media (prefers-color-scheme: dark)',at+1)){
  let depth=0,i=css.indexOf('{',at);
  for(;i<css.length;i++){if(css[i]==='{')depth++;else if(css[i]==='}'&&--depth===0)break;}
  darkRanges.push([at,i]);
}
function palette(theme,dark){
  const blocks=[...css.matchAll(new RegExp(':root\\[data-theme="'+theme+'"\\]\\{([^}]*)\\}','g'))]
    .filter(match=>darkRanges.some(([start,end])=>match.index>start&&match.index<end)===dark);
  assert.equal(blocks.length,1,theme+(dark?' dark':' light')+' block');
  return Object.fromEntries(blocks[0][1].split(';').map(part=>part.trim()).filter(Boolean).map(part=>{const i=part.indexOf(':');return [part.slice(2,i).trim(),part.slice(i+1).trim()];}));
}
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
const linear=c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;
const luminance=hex=>{const [r,g,b]=rgb(hex).map(linear);return 0.2126*r+0.7152*g+0.0722*b;};
const contrast=(a,b)=>{const [hi,lo]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (hi+0.05)/(lo+0.05);};
function lab(hex){
  const [r,g,b]=rgb(hex).map(linear),f=t=>t>0.008856?Math.cbrt(t):7.787*t+16/116;
  const x=f((0.4124*r+0.3576*g+0.1805*b)/0.95047),y=f(0.2126*r+0.7152*g+0.0722*b),z=f((0.0193*r+0.1192*g+0.9505*b)/1.08883);
  return [116*y-16,500*(x-y),200*(y-z)];
}
const distance=(a,b)=>Math.hypot(...lab(a).map((v,i)=>v-lab(b)[i]));

test('theme lists agree between the bootstrap and the shared foundation',()=>{
  for(const name of ['adaptive'])assert.deepEqual(list('packages/app-ui/theme-bootstrap.js',name),list('packages/app-ui/foundation.js',name));
  const names=list('packages/app-ui/theme-bootstrap.js','names');
  assert.deepEqual(fs.readFileSync(path.join(root,'packages/app-ui/foundation.js'),'utf8').match(/const themes = (\[[^\]]*\])/)[1],JSON.stringify(names).replaceAll('"',"'"));
  assert.ok(adaptive.length>=5&&adaptive.every(id=>names.includes(id)));
});
for(const theme of adaptive)for(const dark of [false,true]){
  const label=theme+(dark?' dark':' light');
  test(label+' sets every token, keeps text legible and status colors distinct',()=>{
    const p=palette(theme,dark);
    assert.deepEqual(tokens.filter(token=>!p[token]),[],label+' missing tokens');
    const low=[],need=(a,b,min)=>{const ratio=contrast(p[a],p[b]);if(ratio<min)low.push(a+' on '+b+' '+ratio.toFixed(2)+' < '+min);};
    for(const surface of ['bg','surface','surface-2']){
      need('text',surface,7);need('muted',surface,4.5);
      for(const color of ['accent','danger','success','warning','either'])need(color,surface,4.5);
    }
    for(const color of ['accent','danger','success','warning']){need(color,color+'-soft',4.5);need('text',color+'-soft',7);}
    for(const fill of ['accent-strong','accent','danger-strong'])need('on-accent',fill,4.5);
    for(const surface of ['bg','surface'])need('focus',surface,3);
    assert.deepEqual(low,[],label+' contrast');
    // Bike phases and Liftlog markers tell these five apart by color alone.
    const hues=['accent','danger','success','warning','either'],close=[];
    hues.forEach((a,i)=>hues.slice(i+1).forEach(b=>{const d=distance(p[a],p[b]);if(d<24)close.push(a+'/'+b+' '+d.toFixed(0));}));
    assert.deepEqual(close,[],label+' status colors too similar');
  });
}
