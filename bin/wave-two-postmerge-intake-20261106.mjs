#!/usr/bin/env node
// Authenticated source-FREE GET-only metadata: never export, approve, or merge.
import https from 'node:https';
import {TextDecoder} from 'node:util';
import {auditLive} from '../tools/wave-two-postmerge-intake-20261106.mjs';
const token=process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const api=path=>new Promise((resolve,reject)=>{
  if(!/^\/repos\/ores-truffle-oreslang\/[a-z0-9._-]+\//.test(path) ||
     /(?:\.\.|[\r\n#@]|\/\/)/.test(path) || path.length>500)return reject(Error('INVALID_PATH'));
  const req=https.request({protocol:'https:',hostname:'api.github.com',port:443,path,method:'GET',timeout:15000,
    headers:{Authorization:`Bearer ${token}`,'User-Agent':'atto-postmerge-source-free-intake',
      Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}},res=>{
      if(res.statusCode!==200){res.resume();return reject(Error(`GITHUB_HTTP_${res.statusCode}`));}
      const chunks=[];let count=0;
      res.on('data',chunk=>{count+=chunk.length;if(count>2097152)return req.destroy(Error('OVERSIZE_RESPONSE'));chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>{try{resolve(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));}
        catch{reject(Error('INVALID_RESPONSE'));}});
    });
  req.on('timeout',()=>req.destroy(Error('TIMEOUT')));req.on('error',reject);req.end();
});
if(process.argv.length!==2 || !token){
  console.error('Usage: GH_TOKEN=<read-only-github-token> node bin/wave-two-postmerge-intake-20261106.mjs');
  process.exitCode=2;
}else{
  try{const report=await auditLive(api);process.stdout.write(JSON.stringify(report,null,2)+'\n');
    process.exitCode=1; // Intentionally no success exit: offline/metadata cannot certify release.
  }catch{console.error('POSTMERGE_INTAKE_UNAVAILABLE');process.exitCode=2;}
}
