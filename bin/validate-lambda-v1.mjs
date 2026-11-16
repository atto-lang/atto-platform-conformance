import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const defaultManifestPath = fileURLToPath(new URL('../fixtures/lambda-v1/manifest.json', import.meta.url));

// Fixture integrity validation ONLY. Not real compiler or guest-execution evidence.
export function validateLambdaManifest(path = defaultManifestPath) {
  const manifestPath = resolve(path);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schema !== 'atto.lambda.v1' || manifest.status !== 'TARGET-NOT-EXECUTED') {
    throw Error('lambda manifest must be explicitly TARGET-NOT-EXECUTED');
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length < 2) {
    throw Error('lambda manifest must have cases');
  }
  const ids = new Set();
  let positives = 0;
  let negatives = 0;
  for (const item of manifest.cases) {
    if (!/^[a-z][a-z0-9_]*$/.test(item.id ?? '') || ids.has(item.id)) {
      throw Error('duplicate or invalid case id: ' + item.id);
    }
    ids.add(item.id);
    if (!/^[a-z][a-z0-9_]*\.atto$/.test(item.source ?? '') || basename(item.source) !== item.source) {
      throw Error('invalid fixture filename: ' + item.source);
    }
    const fixturePath = join(dirname(manifestPath), item.source);
    const stat = lstatSync(fixturePath);
    if (!stat.isFile() || stat.nlink !== 1) throw Error('unsafe fixture: ' + item.source);
    const bytes = readFileSync(fixturePath);
    if (bytes.length === 0 || bytes.length > 65536) throw Error('invalid fixture size: ' + item.source);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== item.sha256) throw Error('fixture SHA-256 mismatch: ' + item.source);
    if (item.expect === 'accept' && Number.isInteger(item.exit_code) && item.exit_code >= 0 && item.exit_code <= 255) {
      positives += 1;
    } else if (item.expect === 'reject' && ['parse', 'typecheck', 'borrowcheck', 'effects'].includes(item.phase)) {
      negatives += 1;
    } else {
      throw Error('invalid expected outcome: ' + item.id);
    }
  }
  if (!positives || !negatives) throw Error('must cover both acceptance and rejection');
  return { cases: manifest.cases.length, positives, negatives, status: 'FIXTURE_INTEGRITY_ONLY_NOT_GUEST_EXECUTION' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(validateLambdaManifest(process.argv[2])));
  } catch (err) {
    console.error('FAIL CLOSED: ' + err.message);
    process.exitCode = 1;
  }
}
