// Serves dist/ from one local origin the way the static host does: root _headers rules
// (every matching rule applies; repeated names are joined), _redirects and 404.html.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const dist=path.resolve(__dirname,'../../dist');
const types={'.html':'text/html','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
async function start(){
  const rules=fs.readFileSync(path.join(dist,'_headers'),'utf8').split(/\n\n+/).filter(Boolean).map(block=>{
    const [pattern,...lines]=block.trim().split('\n');return {pattern,headers:lines.map(line=>{const i=line.indexOf(':');return [line.slice(0,i).trim(),line.slice(i+1).trim()];})};
  });
  const redirects=new Map(fs.readFileSync(path.join(dist,'_redirects'),'utf8').trim().split('\n').map(line=>line.split(' ')));
  const server=http.createServer((req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(redirects.has(pathname)){res.writeHead(301,{Location:redirects.get(pathname)}).end();return;}
    let file=path.join(dist,pathname.endsWith('/')?pathname+'index.html':pathname),status=200;
    if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){file=path.join(dist,'404.html');status=404;}
    const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream'};
    for(const rule of rules)if(rule.pattern.endsWith('*')?pathname.startsWith(rule.pattern.slice(0,-1)):pathname===rule.pattern)
      for(const [name,value] of rule.headers)headers[name]=headers[name]?headers[name]+', '+value:value;
    res.writeHead(status,headers).end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {origin:'http://localhost:'+server.address().port,close:()=>server.close()};
}
module.exports={start,dist};
