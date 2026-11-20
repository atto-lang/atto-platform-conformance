//! SOURCE-FREE Rust model of proposed Pointer<T> local-place read leases.
//! NOT an AttoLang lexer, compiler, runtime, memory allocator, or guest proof.
//! Exercises target state invariants independently of source fixture parsing.
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Fault {
    Stale, Foreign, BorrowConflict, Uninitialized, WrongAuthority, Leaked, Exhausted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Token {
    id: u64,
    generation: u64,
    actor: u64,
    tenant: u64,
}

#[derive(Clone, Copy, Debug)]
enum Spelling { Rt, Bang }

struct Local {
    value: Option<i64>,
    alive: bool,
    generation: u64,
    actor: u64,
    tenant: u64,
    next_id: u64,
    readers: BTreeSet<u64>,
}
impl Local {
    fn new(value: Option<i64>, actor: u64, tenant: u64) -> Self {
        Self { value, alive: true, generation: 1, actor, tenant,
               next_id: 1, readers: BTreeSet::new() }
    }
    fn mint(&mut self, _spelling: Spelling) -> Result<Token, Fault> {
        if !self.alive { return Err(Fault::Stale); }
        let id = self.next_id;
        if self.readers.contains(&id) { return Err(Fault::Exhausted); }
        let next = self.next_id.checked_add(1).ok_or(Fault::Exhausted)?;
        self.next_id = next;
        self.readers.insert(id);
        Ok(Token { id, generation: self.generation, actor: self.actor, tenant: self.tenant })
    }
    fn validate(&self, token: Token, actor: u64, tenant: u64) -> Result<(), Fault> {
        if token.actor != actor || token.tenant != tenant
            || actor != self.actor || tenant != self.tenant {
            return Err(Fault::Foreign);
        }
        if !self.alive || token.generation != self.generation
            || !self.readers.contains(&token.id) {
            return Err(Fault::Stale);
        }
        Ok(())
    }
    fn read(&self, token: Token, _spelling: Spelling) -> Result<i64, Fault> {
        self.validate(token, self.actor, self.tenant)?;
        self.value.ok_or(Fault::Uninitialized)
    }
    fn release(&mut self, token: Token, _spelling: Spelling) -> Result<(), Fault> {
        self.validate(token, self.actor, self.tenant)?;
        if !self.readers.remove(&token.id) { return Err(Fault::Stale); }
        Ok(())
    }
    fn write_local(&mut self, value: i64) -> Result<(), Fault> {
        if !self.alive { return Err(Fault::Stale); }
        if !self.readers.is_empty() { return Err(Fault::BorrowConflict); }
        self.value = Some(value);
        Ok(())
    }
    fn drop_local(&mut self) -> Result<(), Fault> {
        if !self.alive { return Err(Fault::Stale); }
        if !self.readers.is_empty() { return Err(Fault::BorrowConflict); }
        let next = self.generation.checked_add(1).ok_or(Fault::Exhausted)?;
        self.generation = next;
        self.alive = false;
        self.value = None;
        Ok(())
    }
    fn restart(&mut self, initial: Option<i64>) -> Result<(), Fault> {
        if self.alive || !self.readers.is_empty() { return Err(Fault::BorrowConflict); }
        self.alive = true;
        self.value = initial;
        Ok(())
    }
    fn close_borrowed(&self, token: Token) -> Result<(), Fault> {
        self.validate(token, self.actor, self.tenant)?;
        Err(Fault::WrongAuthority)
    }
    fn write_through_readonly(&self, token: Token, _value: i64) -> Result<(), Fault> {
        self.validate(token, self.actor, self.tenant)?;
        Err(Fault::WrongAuthority)
    }
    fn exit(&self) -> Result<(), Fault> {
        if self.readers.is_empty() { Ok(()) } else { Err(Fault::Leaked) }
    }
}

#[test]
fn rt_and_bang_spellings_have_identical_nonallocating_lifecycle_results() {
    for mint in [Spelling::Rt, Spelling::Bang] {
        for read in [Spelling::Rt, Spelling::Bang] {
            for release in [Spelling::Rt, Spelling::Bang] {
                let mut local = Local::new(Some(42), 7, 11);
                let handle = local.mint(mint).unwrap();
                let answer = local.read(handle, read).unwrap();
                local.release(handle, release).unwrap();
                assert_eq!(local.exit(), Ok(()));
                assert_eq!(answer, 42);
                assert_eq!(local.value, Some(42));
            }
        }
    }
}
#[test]
fn separate_readers_are_permitted_but_each_prevents_write_and_drop() {
    let mut local = Local::new(Some(42), 3, 5);
    let a = local.mint(Spelling::Rt).unwrap();
    let b = local.mint(Spelling::Bang).unwrap();
    assert_ne!(a.id, b.id);
    assert_eq!(local.read(a, Spelling::Rt), Ok(42));
    assert_eq!(local.read(b, Spelling::Bang), Ok(42));
    assert_eq!(local.write_local(9), Err(Fault::BorrowConflict));
    assert_eq!(local.drop_local(), Err(Fault::BorrowConflict));
    local.release(a, Spelling::Bang).unwrap();
    assert_eq!(local.write_local(9), Err(Fault::BorrowConflict));
    local.release(b, Spelling::Rt).unwrap();
    assert_eq!(local.write_local(43), Ok(()));
    assert_eq!(local.value, Some(43));
}
#[test]
fn double_unref_and_deref_after_unref_reject() {
    let mut local = Local::new(Some(42), 3, 5);
    let handle = local.mint(Spelling::Rt).unwrap();
    local.release(handle, Spelling::Rt).unwrap();
    assert_eq!(local.release(handle, Spelling::Bang), Err(Fault::Stale));
    assert_eq!(local.read(handle, Spelling::Bang), Err(Fault::Stale));
    assert_eq!(local.exit(), Ok(()));
}
#[test]
fn forged_and_foreign_actor_or_tenant_tokens_reject() {
    let mut local = Local::new(Some(42), 3, 5);
    let h = local.mint(Spelling::Bang).unwrap();
    assert_eq!(local.validate(h, 4, 5), Err(Fault::Foreign));
    assert_eq!(local.validate(h, 3, 6), Err(Fault::Foreign));
    assert_eq!(local.read(Token { actor: 4, ..h }, Spelling::Rt), Err(Fault::Foreign));
    assert_eq!(local.read(Token { tenant: 6, ..h }, Spelling::Rt), Err(Fault::Foreign));
    assert_eq!(local.read(Token { id: 999, ..h }, Spelling::Rt), Err(Fault::Stale));
    assert_eq!(local.read(Token { generation: 999, ..h }, Spelling::Rt), Err(Fault::Stale));
    local.release(h, Spelling::Bang).unwrap();
}
#[test]
fn stale_generation_stays_revoked_after_place_reuse() {
    let mut local = Local::new(Some(42), 3, 5);
    let old = local.mint(Spelling::Rt).unwrap();
    local.release(old, Spelling::Rt).unwrap();
    local.drop_local().unwrap();
    local.restart(Some(42)).unwrap();
    let fresh = local.mint(Spelling::Bang).unwrap();
    assert_ne!(old.generation, fresh.generation);
    assert_eq!(local.read(old, Spelling::Rt), Err(Fault::Stale));
    assert_eq!(local.read(fresh, Spelling::Rt), Ok(42));
    local.release(fresh, Spelling::Rt).unwrap();
}
#[test]
fn uninitialized_place_read_and_mint_id_overflow_fail_closed() {
    let mut local = Local::new(None, 3, 5);
    let h = local.mint(Spelling::Rt).unwrap();
    assert_eq!(local.read(h, Spelling::Bang), Err(Fault::Uninitialized));
    local.release(h, Spelling::Bang).unwrap();
    local.next_id = u64::MAX;
    assert_eq!(local.mint(Spelling::Rt), Err(Fault::Exhausted));
}
#[test]
fn local_readonly_handle_can_neither_close_original_nor_write_through() {
    let mut local = Local::new(Some(42), 3, 5);
    let h = local.mint(Spelling::Rt).unwrap();
    assert_eq!(local.close_borrowed(h), Err(Fault::WrongAuthority));
    assert_eq!(local.write_through_readonly(h, 99), Err(Fault::WrongAuthority));
    assert_eq!(local.value, Some(42));
    local.release(h, Spelling::Rt).unwrap();
}
#[test]
fn all_paths_require_unreffed_handles_before_exit() {
    for early in [false, true] {
        let mut local = Local::new(Some(42), 3, 5);
        let h = local.mint(Spelling::Rt).unwrap();
        if !early { local.release(h, Spelling::Bang).unwrap(); }
        assert_eq!(local.exit(), if early { Err(Fault::Leaked) } else { Ok(()) });
    }
}

#[test]
fn duplicate_token_id_rejects_without_panicking_or_overwriting_live_lease() {
    let mut local = Local::new(Some(42), 3, 5);
    let existing = local.mint(Spelling::Rt).unwrap();
    local.next_id = existing.id; // inject a malicious allocator collision
    assert_eq!(local.mint(Spelling::Bang), Err(Fault::Exhausted));
    assert_eq!(local.read(existing, Spelling::Rt), Ok(42));
    local.release(existing, Spelling::Bang).unwrap();
    assert_eq!(local.exit(), Ok(()));
}
