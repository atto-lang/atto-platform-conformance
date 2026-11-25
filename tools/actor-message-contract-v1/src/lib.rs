//! Abstract stage-1 typed-actor message oracle.
//! This does not compile or run AttoLang or prove a real supervisor control path.

#[cfg(test)]
mod tests {
    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum Payload {
        Text,
        Int,
        Control,
    }

    #[derive(Clone, Copy)]
    struct Actor {
        receives: &'static [Payload],
        sends_declared: bool,
        control_only: bool,
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum Decision {
        Accepted,
        PayloadMismatch,
        SendsUnverified,
        ControlRouteRequired,
        UnauthorizedSupervisor,
    }

    fn actor(receives: &'static [Payload]) -> Actor {
        Actor {
            receives,
            sends_declared: false,
            control_only: false,
        }
    }

    fn send_application(from: Actor, to: Actor, payload: Payload) -> Decision {
        if from.sends_declared {
            return Decision::SendsUnverified;
        }
        if to.control_only || payload == Payload::Control {
            return Decision::ControlRouteRequired;
        }
        if !to.receives.contains(&payload) {
            return Decision::PayloadMismatch;
        }
        Decision::Accepted
    }

    fn notify_supervisor(authenticated_parent: u64, target_parent: u64) -> Decision {
        if authenticated_parent != target_parent {
            Decision::UnauthorizedSupervisor
        } else {
            Decision::Accepted
        }
    }

    #[test]
    fn fanout_to_many_independently_typed_recipients_is_valid() {
        let sender = actor(&[]);
        let text_one = actor(&[Payload::Text]);
        let text_two = actor(&[Payload::Text]);
        let number = actor(&[Payload::Int]);
        assert_eq!(send_application(sender, text_one, Payload::Text), Decision::Accepted);
        assert_eq!(send_application(sender, text_two, Payload::Text), Decision::Accepted);
        assert_eq!(send_application(sender, number, Payload::Int), Decision::Accepted);
    }

    #[test]
    fn permissive_recipient_does_not_widen_another_recipient() {
        let sender = actor(&[]);
        let text = actor(&[Payload::Text]);
        let number = actor(&[Payload::Int]);
        assert_eq!(send_application(sender, text, Payload::Text), Decision::Accepted);
        assert_eq!(
            send_application(sender, number, Payload::Text),
            Decision::PayloadMismatch
        );
    }

    #[test]
    fn explicit_sends_fails_closed_until_transitive_effects_exist() {
        let sender = Actor {
            sends_declared: true,
            ..actor(&[Payload::Text])
        };
        let receiver = actor(&[Payload::Int]);
        assert_eq!(
            send_application(sender, receiver, Payload::Int),
            Decision::SendsUnverified
        );
    }

    #[test]
    fn union_receives_is_not_a_destination_count() {
        let sender = actor(&[]);
        let receiver = actor(&[Payload::Text, Payload::Int]);
        assert_eq!(send_application(sender, receiver, Payload::Text), Decision::Accepted);
        assert_eq!(send_application(sender, receiver, Payload::Int), Decision::Accepted);
    }

    #[test]
    fn control_notices_never_enter_application_mailbox() {
        let sender = actor(&[]);
        let receiver = actor(&[Payload::Control]);
        assert_eq!(
            send_application(sender, receiver, Payload::Control),
            Decision::ControlRouteRequired
        );
        assert_eq!(notify_supervisor(17, 17), Decision::Accepted);
        assert_eq!(
            notify_supervisor(17, 18),
            Decision::UnauthorizedSupervisor
        );
    }

    #[test]
    fn control_only_mailboxes_are_unavailable_in_stage_one() {
        let sender = actor(&[]);
        let receiver = Actor {
            control_only: true,
            ..actor(&[])
        };
        assert_eq!(
            send_application(sender, receiver, Payload::Text),
            Decision::ControlRouteRequired
        );
    }

    #[test]
    fn portable_atto_fixture_set_is_pinned_at_compile_time() {
        let positive = include_str!("../../../contracts/actor-message-v1/positive-multiple-recipients.atto");
        let mismatch = include_str!("../../../contracts/actor-message-v1/negative-wrong-downstream-payload.atto");
        let outbound = include_str!("../../../contracts/actor-message-v1/negative-unverified-sends.atto");
        let control = include_str!("../../../contracts/actor-message-v1/negative-receives-never.atto");
        assert_eq!(positive.matches("spawn TextSink()").count(), 2);
        assert!(positive.contains("spawn NumberSink()"));
        assert!(mismatch.contains("count_sink.send(\"wrong type\")"));
        assert!(outbound.contains("sends int"));
        assert!(control.contains("receives never"));
    }
}
