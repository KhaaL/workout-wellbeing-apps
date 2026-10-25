// Reads an app's Content-Security-Policy from the built site's root _headers.
const fs=require('node:fs');
const path=require('node:path');
const file=path.resolve(__dirname,'../../dist/_headers');
function csp(app){
  const block=fs.readFileSync(file,'utf8').split(/\n\n+/).find(rule=>rule.startsWith('/'+app+'/*\n'));
  if(!block)throw new Error('No header rule for /'+app+'/* in dist/_headers');
  return block.match(/Content-Security-Policy: (.*)/)[1];
}
module.exports={csp};
