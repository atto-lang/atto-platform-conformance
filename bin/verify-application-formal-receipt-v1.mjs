#!/usr/bin/env node
// Shape and semantic-consistency validation ONLY. Does not authenticate Actions,
// compiler binaries, private source transfers, product traces or reviewers.
import {lstatSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const BACKENDS = ['java', 'llvm', 'net', 'wasm', 'forge'];
const CLAIMS = ['model-only','compiler-guest','production-refined','five-backend'];
const expectKeys = (x, keys, label, errors) => {
  if(!x || typeof x!=='object' || Array.isArray(x) ||
     Object.keys(x).length!==keys.length || keys.some(k=>!Object.hasOwn(x,k))) {
    errors.push(label+' must have exact keys: '+keys.join(','));
    return false;
  }
  return true;
};
const checkPositive = (n,label,errors) => {
  if(!Number.isSafeInteger(n) || n<=0) errors.push(label+' must be a positive safe integer');
};
const checkSha = (value,pattern,label,errors) => {
  if(typeof value!=='string' || !pattern.test(value)) errors.push(label+' must be lowercase hex digest');
};
const checkRepo = (s,label,errors) => {
  if(typeof s!=='string' || !REPO.test(s) || s.split('/').some(v=>v==='.'||v==='..'))
    errors.push(label+' must be a canonical owner/repository');
};
const checkRun = (run, repo, head, label, errors) => {
  if(!expectKeys(run,['repository','head','runId','attempt','jobId','executedSteps','status','conclusion'],label,errors)) return;
  checkRepo(run.repository,label+'.repository',errors);
  checkSha(run.head,SHA1,label+'.head',errors);
  if(run.repository!==repo || run.head!==head)
    errors.push(label+' must bind the exact repository and commit');
  for(const k of ['runId','attempt','jobId','executedSteps']) checkPositive(run[k],label+'.'+k,errors);
  if(run.status!=='completed' || run.conclusion!=='success')
    errors.push(label+' must have a completed successful workflow');
};
const checkGuest = (g, source, errors) => {
  if(!expectKeys(g,['backend','compilerRepository','compilerCommit','compilerBinarySha256',
    'inputBlobSha1','stdoutSha256','negativeCases','executed','run'], 'guest',errors)) return;
  if(!BACKENDS.includes(g.backend)) errors.push('unrecognized compiler backend');
  const expectedRepo = 'ores-truffle-oreslang/oreslang-source.'+g.backend;
  if(g.compilerRepository!==expectedRepo)
    errors.push('guest compiler repository does not match backend');
  checkSha(g.compilerCommit,SHA1,'guest.compilerCommit',errors);
  checkSha(g.compilerBinarySha256,SHA256,'guest.compilerBinarySha256',errors);
  checkSha(g.stdoutSha256,SHA256,'guest.stdoutSha256',errors);
  if(g.inputBlobSha1!==source.gitBlobSha1)
    errors.push('guest source blob does not match canonical .atto input');
  checkPositive(g.negativeCases,'guest.negativeCases',errors);
  if(g.executed!==true) errors.push('guest must report actual execution');
  checkRun(g.run,g.compilerRepository,g.compilerCommit,'guest.run',errors);
};

export function verifyApplicationFormalReceipt(receipt) {
  const errors=[];
  if(!expectKeys(receipt,['schema','claim','source','model','guests','production'], 'receipt',errors))
    return {ok:false,errors};
  if(receipt.schema!=='attolang.application-formal/1') errors.push('unsupported schema');
  if(!CLAIMS.includes(receipt.claim)) errors.push('unsupported promotion claim');
  const source=receipt.source;
  if(!expectKeys(source,['repository','commit','path','gitBlobSha1'],'source',errors))
    return {ok:false,errors};
  checkRepo(source.repository,'source.repository',errors);
  checkSha(source.commit,SHA1,'source.commit',errors);
  checkSha(source.gitBlobSha1,SHA1,'source.gitBlobSha1',errors);
  if(typeof source.path!=='string' || !source.path.endsWith('.atto') ||
     source.path.startsWith('/') || source.path.includes('\\') ||
     source.path.split('/').some(s=>!s || s==='.' || s==='..'))
    errors.push('source.path must be a canonical relative .atto path');
  const model=receipt.model;
  if(!expectKeys(model,['repository','commit','inputBlobSha1','states','edges',
    'mutationsRejected','run'], 'model',errors)) return {ok:false,errors};
  if(model.repository!==source.repository || model.commit!==source.commit)
    errors.push('model must bind its own source repository and exact head');
  if(model.inputBlobSha1!==source.gitBlobSha1)
    errors.push('model must bind the exact canonical .atto blob');
  for(const key of ['states','edges','mutationsRejected'])
    checkPositive(model[key],'model.'+key,errors);
  checkRun(model.run,model.repository,model.commit,'model.run',errors);
  if(!Array.isArray(receipt.guests) || receipt.guests.length>BACKENDS.length) {
    errors.push('guests must be a bounded array of up to five backend receipts');
  } else {
    const seen = new Set();
    for(const g of receipt.guests) {
      checkGuest(g,source,errors);
      if(seen.has(g?.backend)) errors.push('duplicate backend receipt');
      seen.add(g?.backend);
    }
    if(receipt.claim==='model-only' && receipt.guests.length!==0)
      errors.push('model-only claim cannot contain guest receipts');
    if(['compiler-guest','production-refined'].includes(receipt.claim) && !receipt.guests.length)
      errors.push('claim requires executed compiler guest');
    if(receipt.claim==='five-backend' &&
       (receipt.guests.length!==BACKENDS.length || BACKENDS.some(b=>!seen.has(b))))
      errors.push('five-backend claim requires five distinct compiled guests');
  }
  const product=receipt.production;
  if(product!==null) {
    if(expectKeys(product,['repository','commit','inputBlobSha1','tracesReplayed',
      'mismatches','run'],'production',errors)) {
      checkRepo(product.repository,'production.repository',errors);
      checkSha(product.commit,SHA1,'production.commit',errors);
      if(product.inputBlobSha1!==source.gitBlobSha1)
        errors.push('product trace input must bind the canonical .atto blob');
      checkPositive(product.tracesReplayed,'production.tracesReplayed',errors);
      if(product.mismatches!==0) errors.push('product must have zero trace mismatches');
      checkRun(product.run,product.repository,product.commit,'production.run',errors);
    }
  }
  if(receipt.claim==='production-refined' && product===null)
    errors.push('production-refined requires independent product trace receipt');
  if(['model-only','compiler-guest'].includes(receipt.claim) && product!==null)
    errors.push('model-only/compiler-guest claim cannot imply production refinement');
  return {ok:errors.length===0,errors};
}

export function verifyApplicationFormalReceiptFile(filename) {
  const stat=lstatSync(filename);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.size>65536 || stat.size===0)
    throw Error('receipt must be a nonempty regular nonsymlink file <= 64KiB');
  const raw=readFileSync(filename,'utf8');
  const parsed=JSON.parse(raw);
  // Exact JSON serialization rejects duplicate keys or invisible claims.
  if(raw!==JSON.stringify(parsed,null,2)+'\n') throw Error('noncanonical/duplicate-key receipt');
  return verifyApplicationFormalReceipt(parsed);
}

if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const filename=process.argv[2];
  if(!filename) {console.error('usage: verify-application-formal-receipt-v1.mjs RECEIPT.json');process.exitCode=64;}
  else try {
    const result=verifyApplicationFormalReceiptFile(filename);
    if(!result.ok) {for(const error of result.errors)console.error('formal receipt: '+error);process.exitCode=1;}
    else console.log('APPLICATION_FORMAL_RECEIPT_SHAPE_PASS provenance=UNAUTHENTICATED guest=NOT_INDEPENDENTLY_ATTESTED');
  }catch(error){console.error('formal receipt: '+error.message);process.exitCode=1;}
}
