//! Source-free, Rust-only reference oracle for AttoLang I/O effect admission.
//! NOT a compiler/typechecker execution receipt and NOT backend runtime parity.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode { Direct, Nonblocking, TryImmediate }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OutcomeShape { Completed, Future, ImmediateReadiness }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Denied { PureIo, IoPermission, NeedsSuspends, NoAsyncAdmission, NoTryAdmission }

#[derive(Debug, Clone, Copy)]
struct Callable { pure: bool, io: bool, suspends: bool }
#[derive(Debug, Clone, Copy)]
struct Capability {
    /// A direct call may suspend even if this particular invocation is ready.
    potentially_suspends: bool,
    /// Async registration cannot block/park the current caller.
    async_registration: bool,
    /// Immediate try must not register a pending I/O operation.
    immediate_probe: bool,
}
fn admit(fn_effects: Callable, op: Capability, mode: Mode) -> Result<OutcomeShape, Denied> {
    if fn_effects.pure { return Err(Denied::PureIo); }
    if !fn_effects.io { return Err(Denied::IoPermission); }
    match mode {
        Mode::Direct => {
            if op.potentially_suspends && !fn_effects.suspends {
                return Err(Denied::NeedsSuspends);
            }
            Ok(OutcomeShape::Completed)
        }
        Mode::Nonblocking => {
            if !op.async_registration { return Err(Denied::NoAsyncAdmission); }
            Ok(OutcomeShape::Future)
        }
        Mode::TryImmediate => {
            if !op.immediate_probe { return Err(Denied::NoTryAdmission); }
            Ok(OutcomeShape::ImmediateReadiness)
        }
    }
}
const SUSPENDING_STREAM: Capability = Capability {
    potentially_suspends: true, async_registration: true, immediate_probe: true,
};
const MEMORY_BUFFER: Capability = Capability {
    potentially_suspends: false, async_registration: false, immediate_probe: true,
};
const BLOCKING_OS_STREAM: Capability = Capability {
    potentially_suspends: true, async_registration: false, immediate_probe: false,
};
const IO_ONLY: Callable = Callable { pure: false, io: true, suspends: false };
const IO_SUSPENDS: Callable = Callable { pure: false, io: true, suspends: true };
const PURE: Callable = Callable { pure: true, io: false, suspends: false };

#[test]
fn ordinary_read_requires_suspends_if_capability_can_suspend() {
    assert_eq!(admit(IO_ONLY,SUSPENDING_STREAM,Mode::Direct),Err(Denied::NeedsSuspends));
    assert_eq!(admit(IO_SUSPENDS,SUSPENDING_STREAM,Mode::Direct),Ok(OutcomeShape::Completed));
}
#[test]
fn ordinary_write_may_be_statically_immediate_without_suspends() {
    assert_eq!(admit(IO_ONLY,MEMORY_BUFFER,Mode::Direct),Ok(OutcomeShape::Completed));
    assert_eq!(admit(IO_SUSPENDS,MEMORY_BUFFER,Mode::Direct),Ok(OutcomeShape::Completed));
}
#[test]
fn nonblocking_read_is_future_returning_without_caller_suspension() {
    assert_eq!(admit(IO_ONLY,SUSPENDING_STREAM,Mode::Nonblocking),Ok(OutcomeShape::Future));
    assert_eq!(admit(IO_SUSPENDS,SUSPENDING_STREAM,Mode::Nonblocking),Ok(OutcomeShape::Future));
}
#[test]
fn nonblocking_write_is_also_future_returning_without_caller_suspension() {
    let channel = SUSPENDING_STREAM;
    assert_eq!(admit(IO_ONLY,channel,Mode::Nonblocking),Ok(OutcomeShape::Future));
}
#[test]
fn try_read_and_try_write_do_not_wait_or_yield() {
    assert_eq!(admit(IO_ONLY,SUSPENDING_STREAM,Mode::TryImmediate),Ok(OutcomeShape::ImmediateReadiness));
    assert_eq!(admit(IO_ONLY,MEMORY_BUFFER,Mode::TryImmediate),Ok(OutcomeShape::ImmediateReadiness));
}
#[test]
fn unavailable_nonparking_or_try_adapter_must_fail_closed() {
    assert_eq!(admit(IO_ONLY,BLOCKING_OS_STREAM,Mode::Nonblocking),Err(Denied::NoAsyncAdmission));
    assert_eq!(admit(IO_ONLY,BLOCKING_OS_STREAM,Mode::TryImmediate),Err(Denied::NoTryAdmission));
}
#[test]
fn pure_forbids_all_io_even_when_it_never_suspends() {
    for m in [Mode::Direct,Mode::Nonblocking,Mode::TryImmediate] {
        assert_eq!(admit(PURE,MEMORY_BUFFER,m),Err(Denied::PureIo));
        assert_eq!(admit(PURE,SUSPENDING_STREAM,m),Err(Denied::PureIo));
    }
}
#[test]
fn io_permission_required_in_all_modes_even_with_suspends() {
    let no_io=Callable { pure:false, io:false, suspends:true };
    for m in [Mode::Direct,Mode::Nonblocking,Mode::TryImmediate] {
        assert_eq!(admit(no_io,SUSPENDING_STREAM,m),Err(Denied::IoPermission));
    }
}
#[test]
fn static_effect_is_not_a_runtime_readiness_guess() {
    // A pending or already-ready op has the SAME static admission decision.
    // Readiness is intentionally not a parameter of this model.
    for _ready_at_call in [false,true] {
        assert_eq!(admit(IO_ONLY,SUSPENDING_STREAM,Mode::Direct),Err(Denied::NeedsSuspends));
    }
}
#[test]
fn marking_a_function_suspends_does_not_make_nb_registration_blocking() {
    let result=admit(IO_SUSPENDS,SUSPENDING_STREAM,Mode::Nonblocking).unwrap();
    assert_eq!(result,OutcomeShape::Future);
    assert_ne!(result,OutcomeShape::Completed);
}

// Stdio output has no channel-slot backpressure; OS drain/flush is a
// *different* effectful operation. These are Rust host reference tests,
// not evidence of an Atto compiler's effect checker or a real pipe.
const STDIO_ADMISSION: Capability = Capability {
    potentially_suspends: false, async_registration: true, immediate_probe: true,
};
const STDIO_FLUSH: Capability = Capability {
    potentially_suspends: true, async_registration: true, immediate_probe: false,
};

#[test]
fn stdio_admission_never_needs_suspends_but_still_requires_io_permission() {
    assert_eq!(admit(IO_ONLY, STDIO_ADMISSION, Mode::Direct),
        Ok(OutcomeShape::Completed));
    assert_eq!(admit(IO_SUSPENDS, STDIO_ADMISSION, Mode::Direct),
        Ok(OutcomeShape::Completed));
    assert_eq!(admit(PURE, STDIO_ADMISSION, Mode::Direct),
        Err(Denied::PureIo));
    assert_eq!(admit(Callable { pure: false, io: false, suspends: false },
                     STDIO_ADMISSION, Mode::Direct), Err(Denied::IoPermission));
}

#[test]
fn flushing_is_separate_potentially_suspending_effect() {
    assert_eq!(admit(IO_ONLY, STDIO_FLUSH, Mode::Direct), Err(Denied::NeedsSuspends));
    assert_eq!(admit(IO_SUSPENDS, STDIO_FLUSH, Mode::Direct),
        Ok(OutcomeShape::Completed));
}

#[test]
fn stdout_nonblocking_registration_retains_future_result_contract() {
    assert_eq!(admit(IO_ONLY, STDIO_ADMISSION, Mode::Nonblocking),
        Ok(OutcomeShape::Future));
    assert_eq!(admit(IO_ONLY, STDIO_ADMISSION, Mode::TryImmediate),
        Ok(OutcomeShape::ImmediateReadiness));
}
