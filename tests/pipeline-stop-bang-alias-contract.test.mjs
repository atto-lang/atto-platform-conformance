// Reference source/fixture integrity only; NEVER a compiler or guest PASS.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const base = new URL('../', import.meta.url);
const data = JSON.parse(readFileSync(
    new URL('contracts/pipeline-stop-bang-alias-v1.json', base), 'utf8'));
const read = path => readFileSync(new URL(path, base), 'utf8');
const gitBlob = s => {
    const bytes = Buffer.from(s, 'utf8');
    return createHash('sha1').update('blob ' + bytes.length + '\\0').update(bytes).digest('hex');
};

test('aliases retain one direction, one graceful stop and no backend PASS claims', () => {
    assert.equal(data.schema_version, 1);
    assert.equal(data.status, 'SOURCE_ONLY_NOT_EXECUTED');
    assert.equal(data.no_claim_of_cross_backend_parity, true);
    assert.equal(data.cases.length, 8);
    assert.equal(data.backend_evidence.length, 11);
    for (const receipt of data.backend_evidence) {
        assert.equal(receipt.source_compiled_guest_status, 'NOT_EXECUTED');
        assert.match(receipt.repo, /^atto-lang\/atto-source\.[a-z]+$/);
    }
    assert.match(data.meaning['pipe!'], /left-to-right/);
    assert.match(data.meaning['rpipe!'], /right-to-left/);
    assert.match(data.meaning['stop!'], /never forced termination/);
    assert.ok(data.requirements.includes('no_cross_tenant_capability_bypass'));
});

test('each source fixture is exact-blob locked and direction-aware', () => {
    const ids = new Set();
    const edges = new Map();
    for (const c of data.cases) {
        assert.ok(!ids.has(c.id), 'duplicate fixture');
        ids.add(c.id);
        assert.equal(c.path, 'fixtures/pipeline-stop-bang-v1/' + c.id + '.atto');
        assert.match(c.source_git_blob_sha, /^[a-f0-9]{40}$/);
        const s = read(c.path);
        assert.equal(gitBlob(s), c.source_git_blob_sha, c.id);
        assert.ok(s.length < 65536);
        assert.equal(c.evidence_status, 'NOT_EXECUTED');
        if (c.direction === 'forward') {
            assert.match(s, /\bpipe!/);
            assert.equal(c.expected, 'typecheck_graph');
            edges.set(c.id, c.observed_dataflow);
        }
        if (c.direction === 'reverse') {
            assert.match(s, /\brpipe!/);
            assert.equal(c.expected, 'typecheck_graph');
            edges.set(c.id, c.observed_dataflow);
        }
        if (c.direction === 'stop') assert.match(s, /stop!/);
        if (c.direction === 'invalid') assert.match(c.expected, /^reject_/);
    }
    assert.equal(edges.get('forward-bang'), edges.get('reverse-bang'));
    assert.equal(edges.get('forward-same-direction-mix'),
                 edges.get('reverse-same-direction-mix'));
    assert.equal(data.cases.find(x=>x.id==='mixed-direction-bang-reject').expected,
                 'reject_E_PIPE_DIRECTION');
    assert.equal(data.cases.find(x=>x.id==='stop-bang-member-stopped-port').expected,
                 'reject_stopped_port_no_DATA_publication');
});
