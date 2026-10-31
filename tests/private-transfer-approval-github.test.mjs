import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requireIndependentSourceExportApproval} from '../bin/require-private-transfer-approval.mjs';

const source='example/private-source', destination='example/private-carrier';
const sourceCommit='a'.repeat(40), sourceTree='b'.repeat(40);
const authority='ores-truffle-oreslang/oreslang-platform-conformance';
const path='security/private-ci-source-export-approvals.v1.json';
const token='test-opaque-token-never-printed';
const opts={source,destination,sourceCommit,sourceTree,token};
const validRecord=()=>({
  schema:'ores.private-ci.source-export/v1',source,destination,
  sourceCommit,sourceTree,destinationId:123456,requestedBy:'requester',
  approvedBy:['reviewer-one','reviewer-two'],
  incident22Approval:{incident:22,status:'INDEPENDENTLY_CLEARED',reviewer:'reviewer-one'},
  incident77Approval:{incident:77,status:'INDEPENDENTLY_CLEARED',reviewer:'reviewer-two'},
  createdAtMs:Date.now()-60000,expiresAtMs:Date.now()+60000,
  maxArtifactRetentionDays:1,status:'APPROVED_FOR_EXACT_SOURCE_ONLY'
});
function fixture(overrides={}) {
  const calls=[];
  const fetchImpl=async(url,request)=>{
    assert.equal(request.method,'GET');
    assert.equal(request.redirect,'error');
    assert.equal(request.headers.Authorization,'Bearer '+token);
    assert.ok(url.startsWith('https://api.github.com/repos/'));
    const endpoint=url.slice('https://api.github.com/repos/'.length);
    calls.push(endpoint);
    let payload;
    switch(endpoint) {
      case authority+'/branches/main':
        payload=overrides.branch??{name:'main',protected:true};break;
      case authority+'/branches/main/protection':
        payload=overrides.protection??{
          required_pull_request_reviews:{required_approving_review_count:2,
            dismiss_stale_reviews:true,require_code_owner_reviews:true},
          enforce_admins:{enabled:true}
        };break;
      case authority+'/issues/22':
        payload=overrides.issue22??{number:22,state:'closed'};break;
      case authority+'/issues/77':
        payload=overrides.issue77??{number:77,state:'closed'};break;
      case destination:
        payload=overrides.destination??{full_name:destination,private:true,
          visibility:'private',archived:false,permissions:{push:true},id:123456};break;
      case authority+'/contents/'+path+'?ref=main': {
        const record={...validRecord(),...(overrides.record??{})};
        const ledger=overrides.ledger??{schema:'ores.private-ci.source-export-ledger/v1',approvals:[record]};
        const contents=overrides.rawLedger??JSON.stringify(ledger)+'\n';
        payload={path,encoding:'base64',content:Buffer.from(contents).toString('base64')};
        break;
      }
      default:throw Error('unexpected GitHub endpoint: '+endpoint);
    }
    if(overrides.failEndpoint===endpoint)throw Error('Bearer '+token);
    return {status:overrides.deniedEndpoint===endpoint?403:200,json:async()=>payload};
  };
  return {calls,fetchImpl};
}
const check=(overrides={},argumentsOverride={})=>{
  const mock=fixture(overrides);
  return {...mock,request:requireIndependentSourceExportApproval({...opts,...argumentsOverride,
    fetchImpl:mock.fetchImpl})};
};

test('protected main, two cleared incidents, exact ledger and private numeric ID admit synthetic metadata only',async()=>{
  const {request,calls}=check();
  const verdict=await request;
  assert.equal(verdict.status,'INDEPENDENT_EXACT_SOURCE_TRANSFER_REVIEWED');
  assert.equal(verdict.destinationId,123456);
  assert.deepEqual(calls,[authority+'/branches/main',authority+'/branches/main/protection',
    authority+'/issues/22',authority+'/issues/77',destination,
    authority+'/contents/'+path+'?ref=main']);
  assert.ok(calls.every(p=>!p.includes('/git/')),'approval itself cannot fetch blobs');
});

test('GitHub-derived trust failures refuse metadata admission without any source blob read',async()=>{
  const bad=[
    {branch:{name:'main',protected:false}},
    {protection:{}},
    {protection:{required_pull_request_reviews:{required_approving_review_count:1,
      dismiss_stale_reviews:true,require_code_owner_reviews:true},enforce_admins:{enabled:true}}},
    {protection:{required_pull_request_reviews:{required_approving_review_count:2,
      dismiss_stale_reviews:true,require_code_owner_reviews:true},enforce_admins:{enabled:false}}},
    {issue22:{number:22,state:'open'}},
    {issue77:{number:77,state:'open'}},
    {destination:{full_name:destination,private:false,visibility:'public',id:123456,
      permissions:{push:true}}},
    {destination:{full_name:destination,private:true,visibility:'private',id:123457,
      permissions:{push:true}}},
    {record:{sourceCommit:'c'.repeat(40)}},
    {record:{sourceTree:'c'.repeat(40)}},
    {record:{approvedBy:['requester','reviewer-two']}},
    {record:{expiresAtMs:1}},
    {record:{maxArtifactRetentionDays:7}},
    {ledger:{schema:'ores.private-ci.source-export-ledger/v1',approvals:[]}},
    {rawLedger:'{"schema":"ores.private-ci.source-export-ledger/v1","approvals":[],"approvals":[]}\n'},
    {deniedEndpoint:authority+'/branches/main/protection'},
    {deniedEndpoint:authority+'/contents/'+path+'?ref=main'},
    {failEndpoint:authority+'/issues/77'},
  ];
  for(const [i,override] of bad.entries()){
    const {request,calls}=check(override);
    await assert.rejects(request,/SOURCE_EXPORT_NOT_INDEPENDENTLY_AUTHORIZED/,String(i));
    assert.ok(calls.every(p=>!p.includes('/git/')),String(i));
  }
});

test('caller cannot supply another source, destination, SHA, or invalid credentials to bypass the ledger',async()=>{
  for(const bad of [
    {source:'example/unapproved-source'},
    {destination:'example/other-private-carrier'},
    {sourceCommit:'c'.repeat(40)},
    {sourceTree:'d'.repeat(40)},
    {token:''},
    {sourceCommit:'INVALID'},
  ]){
    const {request,calls}=check({},bad);
    await assert.rejects(request,/SOURCE_EXPORT_NOT_INDEPENDENTLY_AUTHORIZED/);
    assert.ok(calls.every(p=>!p.includes('/git/')));
  }
});
