import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGithubIdentity, readGithubJson, fetchDopGithubRun, parseStrictGithubJson, requireCanonicalDopSourceRepo} from '../verification/dop-github-api-v1.mjs';

function reply(obj, {status=200, type='application/json', length, chunks, encoding=null}={}) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const size = length === null ? null : length ?? String(bytes.length);
  return {
    ok: status === 200, status,
    headers: {get(k) {return ({'content-type':type,'content-length':size,'content-encoding':encoding})[k];}},
    body: new ReadableStream({start(c) {
      for (const chunk of (chunks || [bytes])) c.enqueue(chunk);
      c.close();
    }})
  };
}
const expectFailure = async (fn, message) => {
  await assert.rejects(fn, error => error?.message === message);
};

test('only strict owner/repository and safe run IDs are admitted', () => {
  assert.deepEqual(validateGithubIdentity('ores-truffle-oreslang/oreslang-source.llvm', 42261359052),
    {repository:'ores-truffle-oreslang/oreslang-source.llvm',id:'42261359052'});
  for (const repository of ['owner/repo/other','owner/../repo','owner/.','owner/a.git','owner/repo?x=y','owner/%2e%2e', 'owner/repo\n']) {
    assert.throws(() => validateGithubIdentity(repository, 4), /invalid-repository/);
  }
  for (const id of [0, -1, '1/../2', '1?x=y', Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(() => validateGithubIdentity('owner/repo', id), /invalid-run-id/);
  }
});
test('the exact two canonical read-only API routes are used', async () => {
  const urls = [], settings = [];
  const fetchFn = async (url, opts) => {
    urls.push(url); settings.push(opts);
    return reply(url.includes('/jobs?') ? {total_count:1,jobs:[]} : {id:42});
  };
  const result = await fetchDopGithubRun({repository:'org/repo',runId:42,token:'secret',fetchFn});
  assert.equal(result.run.id,42);
  assert.deepEqual(urls,[
    'https://api.github.com/repos/org/repo/actions/runs/42',
    'https://api.github.com/repos/org/repo/actions/runs/42/jobs?per_page=100'
  ]);
  assert.ok(settings.every(v=>v.method==='GET' && v.redirect==='manual' &&
    v.cache==='no-store' && v.headers.authorization==='Bearer secret'));
});
test('missing or header-injected credentials are rejected before network', async () => {
  const fetchFn = () => {throw Error('network-called');};
  for (const token of ['', '\n', 'bad\rvalue']) {
    await expectFailure(() => fetchDopGithubRun({repository:'o/r',runId:1,token,fetchFn}), 'missing-github-token');
  }
});
test('HTTP errors and redirect are not followed', async () => {
  await expectFailure(() => readGithubJson(reply({}, {status:302})), 'github-http-not-200');
  await expectFailure(() => readGithubJson(reply({}, {status:401})), 'github-http-not-200');
});
test('unexpected media types, invalid lengths and incomplete bodies are rejected', async () => {
  await expectFailure(() => readGithubJson(reply({}, {type:'text/html'})), 'github-not-json');
  await expectFailure(() => readGithubJson(reply({}, {length:'abc'})), 'github-invalid-length');
  await expectFailure(() => readGithubJson(reply({}, {length:'999999999'})), 'github-invalid-length');
  await expectFailure(() => readGithubJson(reply({}, {length:'4'})), 'github-length-mismatch');
});
test('stream size cap applies to received bytes and not only Content-Length', async () => {
  const data = new Uint8Array(1024 * 1024 + 1).fill(0x61);
  await expectFailure(() => readGithubJson(reply({}, {length:null, chunks:[data]})), 'github-oversize-response');
});
test('malformed JSON, invalid UTF-8, and scalar JSON are rejected', async () => {
  const encoded = value => new TextEncoder().encode(value);
  await expectFailure(() => readGithubJson(reply({}, {length:'1',chunks:[encoded('{')]})), 'github-malformed-json');
  await expectFailure(() => readGithubJson(reply({}, {length:'2',chunks:[new Uint8Array([0xc3,0x28])]})), 'github-malformed-json');
  await expectFailure(() => readGithubJson(reply({}, {length:'1',chunks:[encoded('1')]})), 'github-not-object');
});
test('valid split JSON payload is reassembled into a parsed object', async () => {
  const json = new TextEncoder().encode('{"jobs":[]}');
  const result = await readGithubJson(reply({}, {length:String(json.length),chunks:[json.slice(0,4),json.slice(4)]}));
  assert.deepEqual(result,{jobs:[]});
});

test('duplicate REST authority keys and escaped key aliases fail closed', () => {
  for (const input of ['{"id":1,"id":2}', '{"runner_id":1,"\\u0072unner_id":2}',
    '{"jobs":[{"name":"x","name":"y"}]}']) {
    assert.throws(() => parseStrictGithubJson(input), /github-duplicate-json-key/);
  }
});
test('nested distinct objects may reuse ordinary field names', () => {
  assert.deepEqual(parseStrictGithubJson('{"jobs":[{"id":1},{"id":2}]}'),
    {jobs:[{id:1},{id:2}]});
  assert.deepEqual(parseStrictGithubJson(JSON.stringify({msg:'curly { " braces',id:1})),
    {msg:'curly { " braces',id:1});
});
test('over-nested API objects are refused before native parse', () => {
  const evil = '['.repeat(81) + '0' + ']'.repeat(81);
  assert.throws(() => parseStrictGithubJson(evil), /github-over-nested-json/);
});
test('duplicate keys are rejected through the actual streamed reader', async () => {
  const encoded = new TextEncoder().encode('{"runner_id":10,"runner_id":0}');
  await expectFailure(() => readGithubJson(reply({},
    {length:String(encoded.length),chunks:[encoded]})), 'github-duplicate-json-key');
});

test('DOP source run identity is bound to the five canonical backend repositories', () => {
  for (const [backend, repository] of Object.entries({
    java:'ores-truffle-oreslang/oreslang-source.java',
    llvm:'ores-truffle-oreslang/oreslang-source.llvm',
    wasm:'ores-truffle-oreslang/oreslang-source.wasm',
    forge:'ores-truffle-oreslang/oreslang-source.forge',
    net:'ores-truffle-oreslang/oreslang-source.net'
  })) assert.equal(requireCanonicalDopSourceRepo(backend, repository), repository);
  for (const [backend, repository] of [['llvm', 'unrelated/llvm'],
    ['java', 'ores-truffle-oreslang/oreslang-source.llvm'],
    ['unknown', 'ores-truffle-oreslang/oreslang-source.java']]) {
    assert.throws(() => requireCanonicalDopSourceRepo(backend, repository),
      /backend-repository-mismatch/);
  }
});

test('strict media type and unsupported compression are rejected before parsing', async () => {
  await expectFailure(() => readGithubJson(reply({}, {type:'text/plain; application/json'})), 'github-not-json');
  await expectFailure(() => readGithubJson(reply({}, {type:'application/json, text/plain'})), 'github-not-json');
  await expectFailure(() => readGithubJson(reply({}, {encoding:'gzip'})), 'github-encoded-response');
  assert.deepEqual(await readGithubJson(reply({ok:true}, {type:'application/json; charset=utf-8'})), {ok:true});
});
