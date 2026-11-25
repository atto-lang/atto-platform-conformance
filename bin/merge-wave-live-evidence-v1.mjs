#!/usr/bin/env node
// Authenticated HTTPS GET-only evidence collection, without merge/write endpoints.
import https from 'node:https';
import {TextDecoder} from 'node:util';
import {collectLiveEvidence,collectWaveEvidence} from '../tools/merge-wave-live-evidence-v1.mjs';
const MAX_BYTES = 2 * 1024 * 1024;
function readGithubJson(path, token) {
  return new Promise((resolve,reject) => {
    if (!/^\/repos\/ores-truffle-oreslang\/[a-z0-9._-]+\//.test(path) ||
        /(?:\.\.|\/\/|[\r\n@#])/u.test(path) || path.length > 600) return reject(Error('UNSAFE_API_PATH'));
    const req = https.request({protocol:'https:',hostname:'api.github.com',port:443,
      path,method:'GET',timeout:15000,
      headers:{Authorization:`Bearer ${token}`,'User-Agent':'atto-merge-wave-read-only-v1',
        Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}}, res => {
      if (res.statusCode !== 200) {
        res.resume();const err=Error('GITHUB_GET_FAILED');err.status=res.statusCode;reject(err);return;
      }
      let length=0,parts=[];
      res.on('data',chunk=>{
        length+=chunk.length;
        if (length>MAX_BYTES) {req.destroy(Error('GITHUB_JSON_TOO_LARGE'));return;}
        parts.push(chunk);
      });
      res.on('end',()=>{
        try {
          const raw=Buffer.concat(parts);
          const value=new TextDecoder('utf-8',{fatal:true}).decode(raw);
          resolve(JSON.parse(value));
        } catch { reject(Error('INVALID_GITHUB_JSON')); }
      });
      res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(Error('GITHUB_GET_TIMEOUT')));
    req.on('error',reject);req.end();
  });
}
const argv=process.argv.slice(2);
const usage='Usage: GH_TOKEN=... node bin/merge-wave-live-evidence-v1.mjs ORG/REPO PR_NUMBER\n       GH_TOKEN=... node bin/merge-wave-live-evidence-v1.mjs --wave ORG/REPO#NUMBER ORG/REPO#NUMBER ORG/REPO#NUMBER ORG/REPO#NUMBER ORG/REPO#NUMBER';
const validNumber=x=>/^[1-9][0-9]{0,6}$/.test(x);
const single=argv.length===2 && validNumber(argv[1]);
const wave=argv.length===6 && argv[0]==='--wave';
const waveTargets=wave?argv.slice(1).map(item=>{
  const m=/^([^#]+)#([1-9][0-9]{0,6})$/.exec(item);
  return m?{repo:m[1],number:Number(m[2])}:null;
}):null;
if ((!single && !wave) || (wave && waveTargets.some(x=>!x))) {
  console.error(usage);
  process.exitCode=2;
} else if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  console.error('GH_TOKEN or GITHUB_TOKEN required (read-only repo metadata and Actions permissions)');
  process.exitCode=2;
} else {
  const token=process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  try {
    const get=path=>readGithubJson(path,token);
    const result=wave?await collectWaveEvidence({targets:waveTargets,get}):
      await collectLiveEvidence({repo:argv[0],number:Number(argv[1]),get});
    console.log(JSON.stringify(result,null,2));
    // A snapshot can never return shell-success: usable for audit, not gate green-light.
    process.exitCode=1;
  } catch(e) {
    console.error('COLLECTOR_FAIL_CLOSED:',e.message);
    process.exitCode=2;
  }
}
