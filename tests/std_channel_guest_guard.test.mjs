// Source-only guard for candidate Atto channel fixtures.
// This test cannot establish compiler execution or backend parity.
import {readFile, realpath, lstat} from 'node:fs/promises';
import {relative, resolve, isAbsolute, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const manifest = JSON.parse(await readFile(
  new URL('../contracts/std-channel-v1.json', import.meta.url), 'utf8'
));
const backendNames = ['java', 'llvm', 'net', 'rs', 'wasm', 'forge',
  'cranelift', 'js', 'hdl'].sort();
const candidates = {
  bounded_fifo_drain: /channel\.send<int>\(ch, 20\)[\s\S]*channel\.send<int>\(ch, 22\)[\s\S]*channel\.close<int>\(ch\)[\s\S]*channel\.receive<int>\(ch\)/,
  rendezvous_pending: /channel\.rendezvous<int>\(\)[\s\S]*channel\.send_pending<int>\(ch, 42\)[\s\S]*channel\.receive_pending<int>\(ch\)/,
  rendezvous_direct_read: /channel\.rendezvous<int>\(\)[\s\S]*channel\.send_pending<int>\(ch, 42\)[\s\S]*channel\.receive<int>\(ch\)/,
  try_read_empty_ready: /channel\.try_receive<int>\(ch\)[\s\S]*on None[\s\S]*on Some\(value\)/,
  closed_move_recovery: /channel\.try_send<Array<int>>\(ch, rt take owned\)[\s\S]*on Closed\(value\)/,
  negative_capacity: /channel\.bounded<int>\(-1\)/
};

function inside(directory, path) {
  const part = relative(directory, path);
  return part !== '' && part !== '..' && !part.startsWith('..' + sep)
    && !isAbsolute(part);
}
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\r\n]*/g, '');
}

test('channel contract fixtures are exact, in-tree Atto sources, not evidence of PASS', async () => {
  assert.equal(manifest.status, 'TARGET_ONLY_NOT_EXECUTED');
  assert.equal(manifest.evidence_rule.includes('actual compiled/executed guest'), true);
  assert.deepEqual(manifest.cases.map(c => c.id).sort(),
    Object.keys(candidates).sort(), 'unexpected/duplicated/omitted fixture ID');
  const rootReal = await realpath(root);
  for (const c of manifest.cases) {
    const group = c.kind === 'pass' ? 'pass' : 'fail';
    assert.ok(c.kind === 'pass' || c.kind === 'runtime_reject', c.id);
    assert.equal(c.path, `fixtures/std-channel/${group}/${c.id}.atto`);
    assert.deepEqual(Object.keys(c.backend_status).sort(), backendNames);
    for (const [backend, status] of Object.entries(c.backend_status)) {
      assert.equal(status, 'NOT_EXECUTED', `${c.id}:${backend} needs actual guest evidence`);
    }
    const file = resolve(root, c.path);
    assert.ok(inside(root, file), `path escape: ${c.id}`);
    assert.ok(!(await lstat(file)).isSymbolicLink(), `symlink guest: ${c.id}`);
    assert.ok(inside(rootReal, await realpath(file)), `symlinked ancestor: ${c.id}`);
    const source = await readFile(file, 'utf8');
    const executable = withoutComments(source);
    assert.match(executable, /import module channel from "std\/channel";/, c.id);
    assert.match(executable, /\broutine main\(\): void/, c.id);
    assert.match(executable, candidates[c.id], `comment-only or missing behavior: ${c.id}`);
    assert.doesNotMatch(executable, /\b(?:require|eval)\s*\(/, c.id);
    if (c.kind === 'pass') {
      assert.equal(typeof c.expected_stdout, 'string');
      const declared = source.match(/^\/\/ (?:expect|target)-stdout: ([^\r\n]+)$/m);
      assert.equal(declared?.[1], c.expected_stdout, `stdout header mismatch: ${c.id}`);
    } else {
      assert.equal(typeof c.expected_error_contains, 'string');
      assert.doesNotMatch(source, /^\/\/ (?:expect|target)-stdout:/m,
        `reject case must not claim stdout: ${c.id}`);
    }
  }
});

test('commented-out Atto behavior is never accepted as executable behavior', () => {
  const commented = '// channel.bounded<int>(-1)\n/* channel.bounded<int>(-1) */';
  assert.doesNotMatch(withoutComments(commented), candidates.negative_capacity);
});
