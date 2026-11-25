#!/usr/bin/env node
import fs from "node:fs";

export function expectedRows(contract) {
  const rows = [];
  for (const [section, cases] of [
    ["modifier", contract.modifier_cases ?? []],
    ["semantic", contract.cases ?? []],
    ["syntax", contract.syntax_cases ?? []],
  ]) {
    cases.forEach((entry, index) => {
      rows.push({
        id: section + ":" + index,
        section,
        index,
        expected: entry.error ? "REJECT" : "ACCEPT",
        diagnostic: entry.error ?? null,
      });
    });
  }
  (contract.abi_cases ?? []).forEach((entry, index) => {
    rows.push({
      id:"abi:" + index,
      section:"abi",
      index,
      expected:entry.equal ? "ABI_EQUAL" : "ABI_DIFFERENT",
      diagnostic:null,
    });
  });
  (contract.access_cases ?? []).forEach((entry, index) => {
    rows.push({
      id:"access:" + index,
      section:"access",
      index,
      expected:entry.expect ? "ACCESS_ALLOW" : "ACCESS_DENY",
      diagnostic:null,
    });
  });
  return rows;
}

export function verifyReport(contract, report) {
  const errors = [];
  if (report?.schema !== "oreslang.explicit-exports.backend-report.v1")
    errors.push("REPORT_SCHEMA");
  if (typeof report?.backend !== "string" || report.backend.length === 0)
    errors.push("BACKEND_REQUIRED");
  if (!/^[0-9a-f]{40}$/i.test(report?.exact_head ?? ""))
    errors.push("EXACT_HEAD_REQUIRED");
  if (report?.execution?.status !== "EXECUTED")
    errors.push("EXECUTION_REQUIRED");
  if (typeof report?.execution?.run_url !== "string" || report.execution.run_url.length === 0)
    errors.push("RUN_URL_REQUIRED");

  const expected = expectedRows(contract);
  const observed = new Map();
  for (const row of report?.results ?? []) {
    if (typeof row?.id !== "string") {
      errors.push("RESULT_ID_REQUIRED");
      continue;
    }
    if (observed.has(row.id)) {
      errors.push("DUPLICATE_RESULT:" + row.id);
      continue;
    }
    observed.set(row.id, row);
  }

  for (const want of expected) {
    const got = observed.get(want.id);
    if (!got) {
      errors.push("MISSING_RESULT:" + want.id);
      continue;
    }
    if (got.status !== want.expected)
      errors.push("STATUS_MISMATCH:" + want.id + ":" + got.status + "!=" + want.expected);
    if (want.expected === "REJECT") {
      if (got.diagnostic !== want.diagnostic)
        errors.push("DIAGNOSTIC_MISMATCH:" + want.id + ":" + got.diagnostic + "!=" + want.diagnostic);
    } else if (got.diagnostic != null) {
      errors.push("NONREJECT_HAS_DIAGNOSTIC:" + want.id);
    }
  }

  for (const id of observed.keys()) {
    if (!expected.some(row => row.id === id))
      errors.push("UNKNOWN_RESULT:" + id);
  }

  if (report?.native_exposure !== "UNCHANGED")
    errors.push("NATIVE_EXPOSURE_MUST_BE_UNCHANGED");

  return errors;
}

if (import.meta.url === new URL("file://" + process.argv[1]).href) {
  const [contractPath, reportPath] = process.argv.slice(2);
  if (!contractPath || !reportPath) {
    console.error("usage: verify-explicit-export-backend-report.mjs <contract.json> <report.json>");
    process.exit(2);
  }
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const errors = verifyReport(contract, report);
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log(JSON.stringify({
    status:"PASS",
    backend:report.backend,
    exact_head:report.exact_head,
    cases:expectedRows(contract).length
  }));
}
