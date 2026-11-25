import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, rm, readFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {
  BACKENDS, loadCorpus, materializeCorpus, validateCorpus
} from "../src/implicit-val-initialize-v1.mjs";

test("12 fixture groups, consistent source, five-backend coverage and fail-closed status", async () => {
  const corpus = await loadCorpus();
  assert.equal(corpus.groups.length, 12);
  assert.deepEqual(corpus.backends, BACKENDS);
  assert.equal(corpus.status, "candidate-unattested");
  assert.ok(corpus.groups.some(x => x.id === "initialize-four-bodies" && x.cases.length === 4));
  assert.ok(corpus.groups.some(x => x.id === "self-escape"));
  assert.ok(corpus.groups.some(x => x.id === "actor-ownership-and-format"));
  assert.ok(corpus.groups.flatMap(x => x.cases).length >= 24);
  assert.ok(corpus.groups.flatMap(x => x.cases).every(x => x.evidence === "NOT_EXECUTED"));
});

test("manifest refuses case duplication, forged execution claims and missing negatives", async () => {
  const base = await loadCorpus();
  const clone = () => structuredClone(base);
  let bad = clone();
  bad.groups[1].cases[0].id = bad.groups[0].cases[0].id;
  assert.throws(() => validateCorpus(bad));
  bad = clone();
  bad.groups[0].cases[0].evidence = "VERIFIED";
  assert.throws(() => validateCorpus(bad));
  bad = clone();
  for (const group of bad.groups)
    group.cases = group.cases.filter(c => c.expected.outcome === "accept");
  assert.throws(() => validateCorpus(bad));
  bad = clone();
  bad.backends.pop();
  assert.throws(() => validateCorpus(bad));
});

test("materialization binds exact source bytes and cannot certify execution", async () => {
  const corpus = await loadCorpus();
  for (const backend of BACKENDS) {
    const dir = await mkdtemp(join(tmpdir(), "ores-corpus-test-"));
    try {
      const proof = await materializeCorpus(corpus,backend,dir);
      assert.equal(proof.executionEvidence,"NOT_EXECUTED");
      assert.equal(proof.verificationScope,"fixture-materialization-only");
      const count = corpus.groups.reduce((n,g)=>n+g.cases.length,0);
      assert.equal(proof.materialized,count);
      for (const item of proof.results) {
        const bytes = await readFile(item.path);
        assert.equal(createHash("sha256").update(bytes).digest("hex"),item.sha256);
      }
      await assert.rejects(materializeCorpus(corpus,backend,dir));
    } finally {
      await rm(dir,{recursive:true,force:true});
    }
  }
});
