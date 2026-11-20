import assert from "node:assert/strict";
import fs from "node:fs";
import { expectedRows, verifyReport } from "../tools/verify-explicit-export-backend-report.mjs";

const contract = JSON.parse(fs.readFileSync(
  new URL("../contracts/explicit-exports-v1.json", import.meta.url), "utf8"));

const rows = expectedRows(contract);
assert.equal(rows.length,
  contract.modifier_cases.length + contract.cases.length + contract.syntax_cases.length +
  contract.abi_cases.length + contract.access_cases.length);
assert.equal(contract.syntax_cases.length, 32);
assert.equal(contract.cases.length, 46);
assert.equal(contract.abi_cases.length, 7);
assert.equal(contract.access_cases.length, 7);
assert.equal(rows.length, 97);

const good = {
  schema:"oreslang.explicit-exports.backend-report.v1",
  backend:"synthetic-reference",
  exact_head:"0123456789abcdef0123456789abcdef01234567",
  execution:{
    status:"EXECUTED",
    run_url:"https://example.invalid/run/1"
  },
  native_exposure:"UNCHANGED",
  results:rows.map(row => ({
    id:row.id,
    status:row.expected,
    diagnostic:row.diagnostic
  }))
};
assert.deepEqual(verifyReport(contract, good), []);

const unexecuted = structuredClone(good);
unexecuted.execution.status = "NOT_EXECUTED";
assert(verifyReport(contract, unexecuted).includes("EXECUTION_REQUIRED"));

const wrongDiagnostic = structuredClone(good);
const rejected = rows.find(row => row.expected === "REJECT");
wrongDiagnostic.results.find(row => row.id === rejected.id).diagnostic = "GENERIC_PARSE_ERROR";
assert(verifyReport(contract, wrongDiagnostic)
  .some(error => error.startsWith("DIAGNOSTIC_MISMATCH:")));

const wrongAbi = structuredClone(good);
const abi = rows.find(row => row.section === "abi");
wrongAbi.results.find(row => row.id === abi.id).status =
  abi.expected === "ABI_EQUAL" ? "ABI_DIFFERENT" : "ABI_EQUAL";
assert(verifyReport(contract, wrongAbi)
  .some(error => error.startsWith("STATUS_MISMATCH:abi:")));

const wrongAccess = structuredClone(good);
const access = rows.find(row => row.section === "access");
wrongAccess.results.find(row => row.id === access.id).status =
  access.expected === "ACCESS_ALLOW" ? "ACCESS_DENY" : "ACCESS_ALLOW";
assert(verifyReport(contract, wrongAccess)
  .some(error => error.startsWith("STATUS_MISMATCH:access:")));

const missing = structuredClone(good);
missing.results.pop();
assert(verifyReport(contract, missing).some(error => error.startsWith("MISSING_RESULT:")));

const nativeLeak = structuredClone(good);
nativeLeak.native_exposure = "EXPOSED";
assert(verifyReport(contract, nativeLeak).includes("NATIVE_EXPOSURE_MUST_BE_UNCHANGED"));

console.log(JSON.stringify({
  status:"PASS",
  protocol:"oreslang.explicit-exports.backend-report.v1",
  required_cases:rows.length,
  syntax_cases:contract.syntax_cases.length,
  semantic_cases:contract.cases.length,
  modifier_cases:contract.modifier_cases.length,
  abi_cases:contract.abi_cases.length,
  access_cases:contract.access_cases.length
}));
