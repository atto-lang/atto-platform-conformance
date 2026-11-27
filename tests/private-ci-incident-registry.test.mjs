import {test} from "node:test";
import assert from "node:assert/strict";
import {existsSync, readFileSync} from "node:fs";
import {requirePrivateMirror} from "../bin/require-private-mirror.mjs";
import {publishPrivateMirror} from "../bin/private-mirror-publish.mjs";

// These are observed GitHub issue identities, not closure or transfer approval.
// Changing this fixed baseline requires an independently reviewed security PR.
const REQUIRED = new Map([
  [22, 5832921751], [77, 5904679716], [127, 5935338521],
  [171, 6042555082], [172, 6042602777], [198, 6070465058],
  [200, 6071264936], [212, 6087989978], [252, 6129229261]
]);
const DENIED = "PRIVATE_SOURCE_PUBLISH_DISABLED_PENDING_PROTECTED_MAIN_APPROVAL";
const registry = JSON.parse(readFileSync(new URL(
  "../docs/security/private-ci-incident-disposition-review-v1.json", import.meta.url), "utf8"));

function validateHold(record) {
  assert.equal(record.schema, "oreslang-private-ci-incident-disposition-review-v1");
  assert.equal(record.status, "NON_AUTHORIZING_REVIEW_ONLY");
  assert.equal(record.source_transfer_authorized, false);
  assert.equal(record.incident_repository, "ores-truffle-oreslang/oreslang-platform-conformance");
  assert.equal(record.incident_repository_id, 1413795502);
  // ORESoftware may coordinate disposition but is explicitly excluded from
  // independent authorization reviews, as is the source PR author.
  assert.deepEqual(record.independent_review_policy.excluded_operator_user_ids,
    [2148448,11139560]);
  assert.equal(record.independent_reviewer.status,
    "UNASSIGNED_PENDING_EXTERNAL_SECURITY_REVIEW");
  assert.equal(record.independent_reviewer.login,null);
  assert.equal(record.independent_reviewer.user_id,null);
  assert.equal(record.disposition_contact.login,"ORESoftware");
  assert.equal(record.disposition_contact.user_id,11139560);
  assert.equal(record.disposition_contact.qualifies_as_independent_authorization_reviewer,false);
  assert.equal(record.independent_review_policy.protected_source_main_required,true);
  assert.equal(record.independent_review_policy.exact_authorization_head_approval_required,true);
  assert.equal(record.independent_review_policy.disposition_issue_closure_alone_never_authorizes_export,true);
  assert.equal(record.closure_contract.disposition_contact_not_authorization_approver,true);
  assert.equal(record.closure_contract.closed_by_user_id,record.disposition_contact.user_id);
  assert.equal(record.incidents.length, REQUIRED.size, "no incident may be dropped");
  assert.equal(new Set(record.incidents.map(i => i.number)).size, REQUIRED.size,
    "duplicate incident cannot conceal a missing hold");
  for (const item of record.incidents) {
    assert.equal(item.issue_id, REQUIRED.get(item.number),
      "missing, substituted, or wrong GitHub issue identity: " + item.number);
    assert.equal(item.status, "hold", "issue #" + item.number + " is not cleared");
    assert.match(item.packet, /^docs\/security\/[A-Za-z0-9_./-]+\.md$/);
    assert.ok(!item.packet.includes(".."), "incident packet path must not escape repository");
    assert.ok(existsSync(new URL("../" + item.packet, import.meta.url)),
      "missing incident review packet: " + item.packet);
  }
  assert.equal(record.closure_contract.issue_state, "closed");
  assert.equal(record.closure_contract.state_reason, "completed");
  assert.equal(record.closure_contract.pinned_exact_resolution_comment_required, true);
  assert.equal(record.closure_contract.registry_must_be_updated_on_protected_source_main, true);
}

test("all nine known unresolved incident holds are registered, non-authorizing, and have packets", () => {
  validateHold(registry);
});

test("registry tampering cannot silently omit or resolve a security incident", () => {
  const mutate = [
    x => { x.status = "APPROVED"; },
    x => { x.source_transfer_authorized = true; },
    x => { x.independent_reviewer.status = "APPROVED"; },
    x => { x.independent_reviewer.user_id = 11139560; },
    x => { x.independent_reviewer.login = "ORESoftware"; },
    x => { x.disposition_contact.qualifies_as_independent_authorization_reviewer = true; },
    x => { x.independent_review_policy.excluded_operator_user_ids = []; },
    x => { x.independent_review_policy.exact_authorization_head_approval_required = false; },
    x => { x.independent_review_policy.protected_source_main_required = false; },
    x => { x.independent_review_policy.disposition_issue_closure_alone_never_authorizes_export = false; },
    x => { x.closure_contract.disposition_contact_not_authorization_approver = false; },
    x => { x.incidents.pop(); },
    x => { x.incidents[0] = {...x.incidents[1]}; },
    x => { x.incidents[0].issue_id = 0; },
    x => { x.incidents[0].number = 999; },
    x => { x.incidents[0].status = "completed"; },
    x => { x.incidents[0].packet = "../../unreviewed.md"; },
    x => { x.incidents[0].packet = "docs/security/missing-review-packet.md"; },
    x => { x.closure_contract.pinned_exact_resolution_comment_required = false; },
    x => { x.closure_contract.registry_must_be_updated_on_protected_source_main = false; }
  ];
  for (const change of mutate) {
    const candidate = structuredClone(registry);
    change(candidate);
    assert.throws(() => validateHold(candidate), "registry tampering must fail closed");
  }
});

for (const [number] of REQUIRED) {
  test("incident #" + number + ": both source-transfer APIs deny without option reads or network calls", async () => {
    let touched = 0;
    const hostile = new Proxy({}, {
      get() { touched++; throw Error("SOURCE_READ_ATTEMPT"); },
      ownKeys() { touched++; throw Error("SOURCE_ENUMERATION_ATTEMPT"); },
      getOwnPropertyDescriptor() { touched++; throw Error("SOURCE_DESCRIPTOR_ATTEMPT"); }
    });
    for (const fn of [requirePrivateMirror, publishPrivateMirror]) {
      await assert.rejects(fn(hostile),
        err => err instanceof Error && err.message === DENIED);
      await assert.rejects(fn({incident:number, fetchImpl:async()=>{
        touched++; throw Error("NETWORK_ATTEMPT");
      }}), err => err instanceof Error && err.message === DENIED);
    }
    assert.equal(touched, 0, "authorization failure must have zero source reads or writes");
  });
}
