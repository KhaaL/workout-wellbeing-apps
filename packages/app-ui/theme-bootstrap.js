/* Paint the saved appearance before the installed app's first frame. */
(()=>{
  if(typeof getComputedStyle!=='function'||!document.currentScript)return;
  const app=document.currentScript.dataset.app,root=document.documentElement;
  const names=['system','light','dark','contrast','lamplight','forest','blossom','ink','iron','dracula','gruvbox','nord','solarized','monokai'];
  const adaptive=['system','contrast','lamplight','forest','blossom','ink','iron'];
  let theme='system';
  try{
    const raw=localStorage.getItem(app==='liftlog'?'liftlog.v1':'bike-cardio.ui.theme');
    const value=app==='liftlog'?(raw?JSON.parse(raw)?.settings?.theme:null):raw;
    if(names.includes(value))theme=value;
  }catch(error){}
  if(theme==='system')root.removeAttribute('data-theme');else root.dataset.theme=theme;
  root.style.colorScheme=adaptive.includes(theme)?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):theme==='light'?'light':'dark';
  const css=getComputedStyle(root);
  root.style.backgroundColor=css.getPropertyValue('--bg').trim();
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.content=css.getPropertyValue('--surface').trim();
})();
