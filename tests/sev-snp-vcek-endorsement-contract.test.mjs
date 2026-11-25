import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract=JSON.parse(readFileSync(
  new URL('../contracts/sev-snp-vcek-endorsement-v1.json',import.meta.url),'utf8'));

test('offline VCEK endorsements cannot authorize a tenant or secret release', () => {
  assert.equal(contract.schema,'atto.sev-snp-vcek-endorsement.v1');
  assert.equal(contract.offline_verifier.may_authorize_tenant,false);
  assert.equal(contract.offline_verifier.may_release_secrets,false);
  assert.equal(contract.offline_verifier.returns_crypto_valid_not_hardware_attested,true);
  assert.ok(contract.unsupported.includes('VLEK'));
  assert.ok(contract.unsupported.includes('Turin structVersion1'));
  assert.ok(contract.trusted_input_rule.includes('authenticated operator policy'));
  assert.equal(contract.evidence.hardware_positive,'NOT_EXECUTED');
});

test('SNP certificate component OIDs and signed chip_id range are recorded', () => {
  const x=contract.offline_verifier.extensions;
  for(const [key,oid] of Object.entries({
    structVersion:'1.3.6.1.4.1.3704.1.1',
    blSPL:'1.3.6.1.4.1.3704.1.3.1',
    teeSPL:'1.3.6.1.4.1.3704.1.3.2',
    snpSPL:'1.3.6.1.4.1.3704.1.3.3',
    ucodeSPL:'1.3.6.1.4.1.3704.1.3.8',
    hwID:'1.3.6.1.4.1.3704.1.4'
  })) assert.ok(x[key].startsWith(oid),key);
  assert.ok(x.hwID.includes('0x1a0..0x1df'));
  assert.ok(x.snpSPL.includes('0x186'));
});

test('negative cases are uniquely named and do not claim simulated execution', () => {
  const cases=contract.negative_cases;
  assert.ok(cases.length>=15);
  const ids=new Set();
  for (const c of cases) {
    assert.ok(!ids.has(c.id),c.id);
    assert.ok(typeof c.outcome==='string' && c.outcome!=='HARDWARE_ATTESTED');
    ids.add(c.id);
  }
  for(const id of ['missing-pinned-root','invalid-pinned-root-der',
      'missing-issuer-crl','expired-issuer-crl','vlek-in-vcek-only-path',
      'chip-id-mismatch','revoked-vcek','cross-tenant-key-replay'])
    assert.ok(ids.has(id),id);
  assert.equal(contract.evidence.local_negative_only,'NOT_EXECUTED_EXACT_HEAD');
});
