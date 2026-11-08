import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const matrix=JSON.parse(readFileSync(path.join(root,
  "contracts/v1/safe-collection-access-v1/source-repo-matrix.json"),"utf8"));
const expected=["java","llvm","net","wasm","forge","rs","js","cranelift","hdl"];
test("all nine oreslang-source.* backends are represented without false parity",()=>{
  assert.equal(matrix.schema_version,1);
  assert.equal(matrix.status,"UNATTESTED_PER_BACKEND");
  assert.equal(matrix.source_fixture_cases,10);
  assert.equal(matrix.source_fixture_execution,"NOT_EXECUTED");
  assert.equal(matrix.repos.length,expected.length);
  assert.deepEqual(matrix.repos.map(x=>x.repo.split(".").at(-1)).sort(),expected.sort());
  for (const r of matrix.repos){
    assert.match(r.head_sha,/^[a-f0-9]{40}$/);
    assert.ok(r.code_path.length>3);
    assert.match(r.pr_url,/^https:\/\/github.com\/ores-truffle-oreslang\/oreslang-source\./);
    assert.equal(r.provenance.runner_admission,"RUNNER_NOT_ADMITTED");
    assert.equal(r.provenance.executed_job_steps,0);
    assert.equal(r.semantic_guest_option_verified,false);
    assert.equal(r.static_full_borrow_checker_verified,false);
    assert.equal(r.cross_backend_guest_parity_verified,false);
    assert.match(r.status,/UNATTESTED$/);
    assert.ok(r.scope.length>20);
  }
  for(const rule of ["zero_step_ci_is_not_evidence","parser_unsupported_is_not_semantic_rejection",
    "host_copy_api_is_not_guest_option","host_model_is_not_guest_borrow_checker",
    "require_all_nine_repo_heads","hdl_static_hardware_model_not_dynamic_collection_runtime"])
    assert.equal(matrix.promotion_rules[rule],true,rule);
});

test("shared compiler-backed candidate has immutable exact blob and never fakes .NET support", () => {
  const candidate=matrix.guest_compiled_first_slice;
  assert.equal(candidate.id,"copy-option-v1");
  assert.equal(candidate.status,"PROPOSED_UNATTESTED");
  assert.equal(candidate.expected_stdout,"7:42:true:true:true:true:9");
  assert.equal(candidate.expected_exit_code,0);
  const fixture=readFileSync(path.join(root,candidate.shared_fixture_path));
  const sha=createHash("sha1").update(
    Buffer.from("blob "+fixture.byteLength+"\\0", "utf8"))
      .update(fixture).digest("hex");
  assert.equal(sha,candidate.pinned_git_blob_sha1,
    "source changed without updating all three backend fixture blob hashes");
  assert.match(fixture.toString("utf8"),/get_copy\(9223372036854775807\)/);
  assert.match(fixture.toString("utf8"),/\.get_copy\(-1\)/);
  assert.equal(candidate.backend_admission.net,
    "NOT_IMPLEMENTED_PENDING_NATIVEAOT");
  assert.equal(candidate.backend_admission.java,
    "SOURCE_IMPLEMENTED_CI_NOT_EXECUTED");
  assert.equal(candidate.backend_admission.llvm,
    "SOURCE_IMPLEMENTED_CI_NOT_EXECUTED");
  assert.equal(matrix.source_fixture_execution,"NOT_EXECUTED");
});
