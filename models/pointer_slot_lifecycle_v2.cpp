// Source-free reference model: NOT an Atto compiler or runtime.
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <stdexcept>

struct Reject : std::logic_error { using std::logic_error::logic_error; };
void require(bool ok) { if (!ok) throw Reject("invalid lifecycle"); }
struct Storage {
    explicit Storage(unsigned domain) : domain(domain) {}
    Storage(const Storage&) = delete;
    Storage& operator=(const Storage&) = delete;
    const unsigned domain;
    std::uint64_t generation = 0;
    unsigned leases = 0;
    bool allocated = true, live = false;
    int value = 0;
    void construct(int v, bool fail = false) {
        require(allocated && !live && !leases && generation != std::numeric_limits<std::uint64_t>::max());
        if (fail) throw Reject("constructor failed before publication");
        ++generation; value = v; live = true;
    }
    void destroy() { require(allocated && live && !leases); live = false; }
    void free() { require(allocated && !live && !leases); allocated = false; }
    void write(int v) { require(allocated && live && !leases); value = v; }
};
struct Slot {
    explicit Slot(unsigned domain) : domain(domain) {}
    Slot(const Slot&) = delete;
    Slot& operator=(const Slot&) = delete;
    const unsigned domain;
    Storage* target = nullptr;
    std::uint64_t generation = 0;
    unsigned views = 0;
    void bind(Storage& s) {
        require(!target && s.allocated && s.live && s.domain == domain && s.leases != std::numeric_limits<unsigned>::max());
        ++s.leases; target = &s; generation = s.generation;
    }
    void valid() const { require(target && target->allocated && target->live && target->domain == domain && target->generation == generation && target->leases); }
    int read() const { valid(); return target->value; }
    void begin_view() { valid(); require(views != std::numeric_limits<unsigned>::max()); ++views; }
    void end_view() { valid(); require(views); --views; }
    void unref() { valid(); require(!views); --target->leases; target = nullptr; generation = 0; }
};
unsigned passed = 0;
void check(bool b) { if (!b) std::abort(); ++passed; }
template<class F> void rejects(F f) { try { f(); } catch (const Reject&) { ++passed; return; } std::abort(); }
int main() {
    Storage a(1), b(1), other(2); Slot p(1), q(1);
    check(!p.target && !a.live && a.generation == 0);
    rejects([&]{ p.read(); });
    rejects([&]{ p.unref(); });
    rejects([&]{ p.bind(a); });
    a.construct(42); b.construct(7); other.construct(8);
    p.bind(a); check(p.read() == 42 && a.leases == 1);
    rejects([&]{ p.bind(b); });
    check(p.read() == 42 && b.leases == 0);
    rejects([&]{ a.destroy(); });
    rejects([&]{ a.write(5); });
    rejects([&]{ a.free(); });
    p.begin_view(); rejects([&]{ p.unref(); }); p.end_view();
    q.bind(a); p.unref(); check(a.live && a.leases == 1 && q.read() == 42);
    rejects([&]{ a.destroy(); });
    q.unref(); check(a.live && a.leases == 0 && a.value == 42);
    rejects([&]{ p.unref(); });
    rejects([&]{ p.bind(other); });
    check(!p.target && other.leases == 0);
    p.bind(b); check(p.read() == 7); p.unref();
    auto old = a.generation; a.destroy();
    rejects([&]{ a.construct(9, true); });
    check(!a.live && a.allocated && a.generation == old);
    a.construct(99); check(a.generation == old + 1 && a.value == 99);
    rejects([&]{ a.construct(5); });
    p.bind(a); p.generation = old; // simulated forged/stale handle
    rejects([&]{ p.read(); }); p.generation = a.generation; p.unref();
    a.destroy(); rejects([&]{ a.destroy(); }); a.free();
    rejects([&]{ a.free(); }); rejects([&]{ a.construct(1); });
    b.destroy(); b.generation = std::numeric_limits<std::uint64_t>::max();
    rejects([&]{ b.construct(1); }); b.free(); other.destroy(); other.free();
    std::cout << passed << " lifecycle checks passed\n";
}
