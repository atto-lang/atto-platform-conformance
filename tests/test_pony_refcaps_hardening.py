"""Pony-inspired AttoLang safety differential + adversarial bounded model tests.

IMPORTANT: Tests are source-free, never a claim about compiled .atto behavior.
"""
import json
from pathlib import Path
import random
import unittest

from pony_graph_safety import Broker, Denied, Token

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads((ROOT / "contracts/pony-reference-capabilities-atto-v1.json").read_text())

def actor_graph(capacity=2, tenant="a", other_tenant=None, edges=None, external=False):
    b = Broker()
    a = b.actor(tenant, "sender", capacity)
    receiver = b.actor(other_tenant or tenant, "recipient", capacity)
    owner = b.create_graph(a, {0:11, 1:22}, edges=edges, external_mutable_alias=external)
    return b, a, receiver, owner

class PonyCapabilityMatrixTests(unittest.TestCase):
    def test_exact_six_capabilities_without_new_language_keywords(self):
        self.assertEqual(CONTRACT["capabilities"], ["iso", "trn", "ref", "val", "box", "tag"])
        self.assertEqual(CONTRACT["status"],
                         "REFERENCE_MODEL_AND_CONTRACT_ONLY_NO_BACKEND_FULL_IMPLEMENTATION")
        self.assertIn("AttoLang-native syntax", CONTRACT["scope"])

    def test_exact_pony_viewpoint_table(self):
        rows = CONTRACT["viewpoint_adaptation"]["rows"]
        self.assertEqual(rows, {
            "iso": ["iso","tag","tag","val","tag","tag"],
            "trn": ["iso","box","box","val","box","tag"],
            "ref": ["iso","trn","ref","val","box","tag"],
            "val": ["val","val","val","val","val","tag"],
            "box": ["tag","box","box","val","box","tag"],
            "tag": [None,None,None,None,None,None],
        })

    def test_only_three_capabilities_sendable(self):
        self.assertEqual(CONTRACT["sendable_to_other_actor"], ["iso_consumed","val","tag"])
        self.assertTrue({"trn","ref","box","borrow_mut","raw_pointer"}.issubset(
            CONTRACT["not_sendable_to_other_actor"]))

    def test_field_writes_use_exact_patched_capability_matrix(self):
        self.assertEqual(CONTRACT["field_write_whitelist"], {
            "iso":["iso","val","tag"],
            "trn":["iso","trn","val","tag"],
            "ref":["iso","trn","ref","val","box","tag"],
            "val":[], "box":[], "tag":[]
        })

    def test_mapping_distinguishes_borrow_from_irreversible_share(self):
        mapping = CONTRACT["mapping"]
        self.assertIn("permanent freeze", mapping["val"])
        self.assertIn("local loan", mapping["box"])
        self.assertIn("entire exclusive object graph", mapping["iso"])
        self.assertIn("no direct send", mapping["trn"])
        self.assertIn("separate authorization", mapping["tag"])

    def test_contract_denies_unearned_backend_release(self):
        self.assertIn("NO_PRODUCTION_PONY_STYLE", CONTRACT["release_gate"])
        self.assertTrue(all("NOT_EXECUTED" in v for v in CONTRACT["backend_evidence"].values()))

class PonyGraphOwnershipTests(unittest.TestCase):
    def test_same_tenant_transfer_revokes_original_owner(self):
        b, a, dest, owner = actor_graph()
        self.assertEqual(b.transfer(owner, dest), "Ok")
        with self.assertRaises(Denied): b.read(owner)
        incoming = b.receive(dest)
        self.assertEqual(b.read(incoming, 1), 22)
        b.write(incoming, 1, 33)
        self.assertEqual(b.read(incoming, 1), 33)

    def test_failed_full_mailbox_preserves_graph_version_and_original_owner(self):
        b, a, dest, owner = actor_graph(capacity=1)
        other = b.create_graph(a, {0:99})
        self.assertEqual(b.transfer(other, dest), "Ok")
        graph = b._graph_owner(owner)
        v = graph.version
        before = len(b.graphs)
        self.assertEqual(b.transfer(owner, dest), "MailboxFull")
        self.assertEqual(graph.version, v)
        self.assertEqual(len(b.graphs), before)
        self.assertEqual(b.read(owner, 0), 11)
        self.assertEqual(b.mailbox_depth(dest), 1)
        b.receive(dest)
        self.assertEqual(b.transfer(owner, dest), "Ok")

    def test_failed_ownership_transfer_does_not_change_source_loan_state(self):
        b, a, dest, owner = actor_graph()
        loan = b.borrow(owner)
        with self.assertRaises(Denied):
            b.transfer(owner, dest)
        self.assertEqual(b.read(loan), 11)
        b.release(loan)
        self.assertEqual(b.transfer(owner, dest), "Ok")

    def test_borrowed_read_blocks_writes_and_freezing(self):
        b, a, dest, owner = actor_graph()
        loan = b.borrow(owner)
        with self.assertRaises(Denied): b.write(owner, 0, 99)
        with self.assertRaises(Denied): b.share_immutable(owner)
        self.assertEqual(b.read(loan), 11)
        b.release(loan)
        b.write(owner, 0, 17)
        self.assertEqual(b.read(owner), 17)

    def test_exclusive_borrow_prevents_competing_loans(self):
        b, a, dest, owner = actor_graph()
        loan = b.borrow(owner, mutable=True)
        with self.assertRaises(Denied): b.borrow(owner)
        with self.assertRaises(Denied): b.borrow(owner, mutable=True)
        with self.assertRaises(Denied): b.write(owner, 0, 40)
        b.write(loan, 0, 40)
        b.release(loan)
        self.assertEqual(b.read(owner), 40)

    def test_multiple_read_borrows_and_release(self):
        b, a, dest, owner = actor_graph()
        r1, r2 = b.borrow(owner), b.borrow(owner)
        self.assertEqual(b.read(r1), 11)
        self.assertEqual(b.read(r2), 11)
        with self.assertRaises(Denied): b.borrow(owner, mutable=True)
        b.release(r1); b.release(r2)
        b.borrow(owner, mutable=True)

    def test_double_release_is_denied(self):
        b, a, dest, owner = actor_graph()
        l = b.borrow(owner)
        b.release(l)
        with self.assertRaises(Denied): b.release(l)

    def test_mutable_loan_cannot_suspend(self):
        b, a, dest, owner = actor_graph()
        l = b.borrow(owner, mutable=True)
        with self.assertRaises(Denied): b.borrow_across_suspend(l)

    def test_read_loan_cannot_suspend(self):
        b, a, dest, owner = actor_graph()
        l = b.borrow(owner)
        with self.assertRaises(Denied): b.borrow_across_suspend(l)

    def test_readonly_loan_is_not_sendable_or_freeze_authority(self):
        b, a, dest, owner = actor_graph()
        l = b.borrow(owner)
        with self.assertRaises(Denied): b.transfer(l, dest)
        with self.assertRaises(Denied): b.share_immutable(l)
        with self.assertRaises(Denied): b.send_immutable(l, dest)

    def test_cycle_in_exclusive_graph_can_be_deep_frozen(self):
        b, a, dest, owner = actor_graph(edges={
            0:[("local",1)],1:[("local",0)]
        })
        immutable = b.share_immutable(owner)
        self.assertEqual(b.read(immutable, 1), 22)
        with self.assertRaises(Denied): b.write(immutable, 0, 17)
        with self.assertRaises(Denied): b.read(owner)
        self.assertEqual(b.send_immutable(immutable, dest), "Ok")
        self.assertEqual(b.read(b.receive(dest)), 11)

    def test_deep_freeze_is_irreversible_after_all_views_go_away(self):
        b, a, dest, owner = actor_graph()
        immutable = b.share_immutable(owner)
        b.send_immutable(immutable, dest)
        recv = b.receive(dest)
        self.assertEqual(b.read(immutable), b.read(recv))
        with self.assertRaises(Denied): b.write(recv, 0, 300)
        with self.assertRaises(Denied): b.write(immutable, 0, 300)
        with self.assertRaises(Denied): b.transfer(immutable, dest)

    def test_transitive_mutable_external_edge_denies_freeze_and_take(self):
        b, a, dest, owner = actor_graph(edges={
            0:[("local",1)],1:[("external_mutable","foreign-actor-heap")]
        })
        with self.assertRaises(Denied): b.share_immutable(owner)
        with self.assertRaises(Denied): b.transfer(owner,dest)
        self.assertEqual(b.read(owner),11)
        self.assertEqual(b.mailbox_depth(dest),0)

    def test_unreachable_mutable_external_edge_still_denied(self):
        b, a, dest, owner = actor_graph(edges={
            1:[("external_mutable","unused-but-allocated")]
        })
        with self.assertRaises(Denied): b.share_immutable(owner)
        self.assertEqual(b.read(owner,1),22)

    def test_external_mutable_alias_metadata_denies_both_share_and_move(self):
        b, a, dest, owner = actor_graph(external=True)
        with self.assertRaises(Denied): b.share_immutable(owner)
        with self.assertRaises(Denied): b.transfer(owner,dest)

    def test_immutable_embedded_edge_preserves_minted_token_identity(self):
        b, a, dest, owner = actor_graph()
        val = b.share_immutable(owner)
        other = b.create_graph(a,{0:1},edges={0:[("val",val)]})
        self.assertEqual(b.transfer(other,dest),"Ok")
        self.assertEqual(b.read(b.receive(dest)),1)

    def test_embedded_actor_tag_preserves_minted_identity(self):
        b, a, dest, owner = actor_graph()
        tag=b.actor_tag(dest)
        other=b.create_graph(a,{0:2},edges={0:[("tag",tag)]})
        self.assertEqual(b.transfer(other,dest),"Ok")
        self.assertEqual(b.read(b.receive(dest)),2)

    def test_cross_tenant_mutable_move_requires_broker_authorization(self):
        b,a,dest,owner=actor_graph(other_tenant="different")
        with self.assertRaises(Denied): b.transfer(owner,dest)
        self.assertEqual(b.read(owner),11)
        self.assertEqual(b.mailbox_depth(dest),0)

    def test_cross_tenant_authorized_move_deep_copies_graph(self):
        b,a,dest,owner=actor_graph(other_tenant="different",edges={
            0:[("local",1)],1:[("local",0)]
        })
        old=b._graph_owner(owner)
        b.grant_copy("a","different")
        self.assertEqual(b.transfer(owner,dest),"Ok")
        recv=b.receive(dest)
        new=b._graph_owner(recv)
        self.assertIsNot(old,new)
        self.assertIsNot(old.nodes,new.nodes)
        self.assertIsNot(old.edges,new.edges)
        with self.assertRaises(Denied): b.read(owner)
        b.write(recv,1,57)
        self.assertEqual(b.read(recv,1),57)
        self.assertTrue(old.destroyed)

    def test_cross_tenant_copy_denies_opaque_nested_capabilities(self):
        b,a,dest,owner=actor_graph(other_tenant="different")
        tag=b.actor_tag(dest)
        nested=b.create_graph(a,{0:2},edges={0:[("tag",tag)]})
        b.grant_copy("a","different")
        with self.assertRaises(Denied): b.transfer(nested,dest)
        self.assertEqual(b.read(nested),2)

    def test_cross_tenant_frozen_copy_requires_broker_authorization(self):
        b,a,dest,owner=actor_graph(other_tenant="different")
        val=b.share_immutable(owner)
        with self.assertRaises(Denied): b.send_immutable(val,dest)
        self.assertEqual(b.read(val),11)

    def test_cross_tenant_frozen_copy_does_not_share_allocation(self):
        b,a,dest,owner=actor_graph(other_tenant="different")
        val=b.share_immutable(owner)
        source_graph=b._use(val,"val")
        b.grant_copy("a","different")
        self.assertEqual(b.send_immutable(val,dest),"Ok")
        recv=b.receive(dest)
        target_graph=b._use(recv,"val")
        self.assertIsNot(source_graph,target_graph)
        self.assertIsNot(source_graph.nodes,target_graph.nodes)
        self.assertEqual(b.read(recv),11)
        self.assertEqual(b.read(val),11)

    def test_same_tenant_frozen_share_can_send_without_copy(self):
        b,a,dest,owner=actor_graph()
        val=b.share_immutable(owner)
        before=len(b.graphs)
        self.assertEqual(b.send_immutable(val,dest),"Ok")
        recv=b.receive(dest)
        self.assertIs(b._use(val,"val"),b._use(recv,"val"))
        self.assertEqual(len(b.graphs),before)

    def test_forged_owner_authority_is_denied(self):
        b,a,dest,owner=actor_graph()
        with self.assertRaises(Denied): b.transfer(Token(),dest)
        with self.assertRaises(Denied): b.read(Token())
        self.assertEqual(b.read(owner),11)

    def test_wrong_kind_authority_is_denied(self):
        b,a,dest,owner=actor_graph()
        with self.assertRaises(Denied): b.read(a)
        with self.assertRaises(Denied): b.transfer(a,dest)
        with self.assertRaises(Denied): b.send_using_tag(owner,a)

    def test_malformed_authority_type_is_denied(self):
        b,a,dest,owner=actor_graph()
        for malformed in ("a","sender",[],{},None,0):
            with self.subTest(token=repr(malformed)),self.assertRaises(Denied):
                b.read(malformed)
        self.assertEqual(b.read(owner),11)

    def test_retired_sender_cannot_transfer_again(self):
        b,a,dest,owner=actor_graph()
        b.retire(a)
        with self.assertRaises(Denied): b.transfer(owner,dest)

    def test_actor_incarnation_fences_prior_tag(self):
        b,a,dest,owner=actor_graph()
        old=b.actor_tag(dest)
        b.retire(dest)
        renewed=b.actor("a","recipient")
        with self.assertRaises(Denied): b.send_using_tag(old,a)
        tag=b.actor_tag(renewed)
        self.assertEqual(b.send_using_tag(tag,a),("recipient",2))

    def test_tags_permit_identity_not_state_access(self):
        b,a,dest,owner=actor_graph()
        tag=b.actor_tag(dest)
        self.assertEqual(b.send_using_tag(tag,a),("recipient",1))
        with self.assertRaises(Denied): b.read_using_tag(tag)
        with self.assertRaises(Denied): b.read(tag)

    def test_tag_is_not_implicit_foreign_tenant_authority(self):
        b,a,dest,owner=actor_graph(other_tenant="different")
        tag=b.actor_tag(dest)
        with self.assertRaises(Denied): b.send_using_tag(tag,a)

    def test_actor_retirement_invalidates_queued_transfer(self):
        b,a,dest,owner=actor_graph()
        self.assertEqual(b.transfer(owner,dest),"Ok")
        pending=b._actor(dest).queue[0]
        b.retire(dest)
        with self.assertRaises(Denied): b.read(pending)
        self.assertEqual(b._actors[("a","recipient")].abandoned,1)

    def test_recover_allows_only_minted_val_and_actor_tag(self):
        b,a,dest,owner=actor_graph()
        val=b.share_immutable(owner)
        tag=b.actor_tag(dest)
        self.assertTrue(b.recover_captures([val,tag]))

    def test_recover_rejects_outer_mutable_owner(self):
        b,a,dest,owner=actor_graph()
        with self.assertRaises(Denied): b.recover_captures([owner])

    def test_recover_rejects_outer_readonly_loan(self):
        b,a,dest,owner=actor_graph()
        loan=b.borrow(owner)
        with self.assertRaises(Denied): b.recover_captures([loan])

    def test_recover_rejects_forged_opaque_token(self):
        b,a,dest,owner=actor_graph()
        with self.assertRaises(Denied): b.recover_captures([Token()])

    def test_invalid_local_graph_edge_denied(self):
        b,a,dest,owner=actor_graph()
        with self.assertRaises(Denied):
            b.create_graph(a,{0:1},edges={0:[("local",77)]})

    def test_invalid_edge_kind_denied(self):
        b,a,dest,owner=actor_graph()
        with self.assertRaises(Denied):
            b.create_graph(a,{0:1},edges={0:[("unsafe_ptr",0)]})

    def test_bounded_graph_nodes_denied(self):
        b,a,dest,owner=actor_graph()
        with self.assertRaises(Denied):
            b.create_graph(a,{i:0 for i in range(b.MAX_NODES+1)})

    def test_graph_values_are_exact_i64_not_boolean_or_unbounded(self):
        b,a,dest,owner=actor_graph()
        for v in (True, 2**63, -(2**63)-1):
            with self.subTest(value=v),self.assertRaises(Denied):
                b.create_graph(a,{0:v})

    def test_randomized_512_transfer_atomicity_and_frozen_graphs(self):
        rand=random.Random(20261107)
        for case in range(512):
            capacity=rand.randrange(1,9)
            b,a,dest,owner=actor_graph(capacity=capacity,edges={
                0:[("local",1)],1:[("local",rand.randrange(2))]
            })
            if rand.randrange(2):
                frozen=b.share_immutable(owner)
                for i in range(capacity):
                    self.assertEqual(b.send_immutable(frozen,dest),"Ok",case)
                self.assertEqual(b.send_immutable(frozen,dest),"MailboxFull",case)
                self.assertEqual(b.read(frozen),11,case)
                for _ in range(capacity):
                    rec=b.receive(dest)
                    self.assertEqual(b.read(rec),11,case)
                    with self.assertRaises(Denied): b.write(rec,0,77)
            else:
                for i in range(capacity):
                    dummy=b.create_graph(a,{0:i})
                    self.assertEqual(b.transfer(dummy,dest),"Ok",case)
                graph=b._graph_owner(owner)
                generation=graph.version
                self.assertEqual(b.transfer(owner,dest),"MailboxFull",case)
                self.assertEqual(graph.version,generation,case)
                self.assertEqual(b.read(owner),11,case)
                for _ in range(capacity): b.receive(dest)
                self.assertEqual(b.transfer(owner,dest),"Ok",case)
                with self.assertRaises(Denied): b.read(owner)
                incoming=b.receive(dest)
                self.assertEqual(b.read(incoming),11,case)

if __name__ == "__main__":
    unittest.main()
