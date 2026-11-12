// node pm/run-tests.mjs [log directory]. Suites run sequentially so load benches do not skew CPU assertions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),app=path.join(root,'app');
const directory=process.argv[2];if(directory)fs.mkdirSync(directory,{recursive:true});
const results=[];
for(const suite of fs.readdirSync(path.join(app,'server')).filter(name=>name.endsWith('-test.js')).sort()){
  const result=spawnSync(process.execPath,['--import',fileURLToPath(new URL('./test-runtime.mjs',import.meta.url)),'server/'+suite],
    {cwd:app,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024});
  const output=(result.stdout??'')+(result.stderr??'')+(result.error?String(result.error):'');
  if(directory)fs.writeFileSync(path.join(directory,suite.replace('.js','.log')),output);
  results.push({suite,status:result.status===0?'PASS':'FAIL',exitCode:result.status});
  console.log(`${results.at(-1).status} ${suite}`);
  if(result.status!==0)console.log(output.slice(-2500));
}
if(directory)fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({node:process.version,results},null,2)+'\n');
console.log(`${results.filter(r=>r.status==='PASS').length}/${results.length} suites passed on ${process.version}`);
if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
