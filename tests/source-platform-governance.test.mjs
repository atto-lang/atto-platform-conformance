import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateSourcePlatformGovernance} from "../src/source-platform-governance.mjs";
const registry = JSON.parse(readFileSync(new URL("../integration/repositories.json", import.meta.url), "utf8"));
const capabilities = JSON.parse(readFileSync(new URL("../contracts/platform-capabilities-v1.json", import.meta.url), "utf8"));
const clone = obj => structuredClone(obj);
const audit = (r=registry, c=capabilities) => validateSourcePlatformGovernance(r,c);

test("all nine source backends and six platform targets are governed, not certified", () => {
  assert.deepEqual(audit(), {
    schemaVersion: 1,
    kind: "oreslang-source-platform-governance-audit",
    evidence: "metadata-only",
    sourceRepositories: 9,
    platformRepositories: 6,
    inventoryRepositories: 54,
    verifiedBackendParity: false,
    verifiedTargetExecution: false,
    verifiedPhysicalHardware: false
  });
});

test("reject unregistered Rust and Cranelift backends", () => {
  for (const name of ["oreslang-source.rs", "oreslang-source.cranelift"]) {
    const changed = clone(registry);
    changed.repositories = changed.repositories.filter(row => row.name !== name);
    assert.throws(() => audit(changed), /source family drift/);
  }
});

test("reject source/platform additions without explicit governance review", () => {
  for (const [name,role] of [["oreslang-source.other","compiler"],["oreslang-platform.other","host"]]) {
    const changed = clone(registry);
    changed.repositories.push({name,role,upstreams:["oreslang-target-profiles"],evidence:"not-attested"});
    assert.throws(() => audit(changed), /family drift/);
  }
});

test("reject role or profile coordination drift", () => {
  let changed = clone(registry);
  changed.repositories.find(row => row.name === "oreslang-source.rs").role = "host";
  assert.throws(() => audit(changed), /compiler role/);
  changed = clone(registry);
  changed.repositories.find(row => row.name === "oreslang-platform.asic").role = "compiler";
  assert.throws(() => audit(changed), /host role/);
  changed = clone(registry);
  changed.repositories.find(row => row.name === "oreslang-source.rs").upstreams = ["oreslang-common-source"];
  assert.throws(() => audit(changed), /target-profile coordination/);
});

test("reject forged parity promotion through an ecosystem member", () => {
  const changed = clone(registry);
  changed.repositories.find(row => row.name === "oreslang-source.rs").evidence = "verified";
  assert.throws(() => audit(changed), /unsupported evidence/);
});

test("reject platform capability registry substitution and stage weakening", () => {
  let changed = clone(capabilities);
  changed.platforms.fpga.repository = "ores-truffle-oreslang/oreslang-platform.asic";
  assert.throws(() => audit(registry,changed), /identity drift/);
  changed = clone(capabilities);
  delete changed.platforms.embedded;
  assert.throws(() => audit(registry,changed), /registry names drift/);
  changed = clone(capabilities);
  changed.stageOrder.splice(2,1);
  assert.throws(() => audit(registry,changed), /stage order drift/);
  changed = clone(capabilities);
  changed.promotionRules.all = ["exact-head"];
  assert.throws(() => audit(registry,changed), /promotion requirements drift/);
  changed = clone(capabilities);
  changed.nonEvidence.pop();
  assert.throws(() => audit(registry,changed), /non-evidence exclusions drift/);
});
