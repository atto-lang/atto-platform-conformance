// SOURCE-FREE C++20 MODEL ONLY: not an AttoLang guest or backend.
// Exercises generation-checked, actor-scoped pointer capabilities without UB.
#include <array>
#include <cassert>
#include <cstdint>
#include <iostream>
#include <limits>
#include <optional>
#include <type_traits>

class Handle {
  friend class Arena;
  std::uint32_t slot_, generation_, tenant_, actor_;
  Handle(std::uint32_t slot, std::uint32_t generation,
         std::uint32_t tenant, std::uint32_t actor) noexcept
      : slot_(slot), generation_(generation), tenant_(tenant), actor_(actor) {}
public:
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  Handle(Handle&& other) noexcept
      : slot_(other.slot_), generation_(other.generation_),
        tenant_(other.tenant_), actor_(other.actor_) { other.generation_ = 0; }
  Handle& operator=(Handle&&) = delete;
};
static_assert(!std::is_copy_constructible_v<Handle>);
static_assert(!std::is_constructible_v<Handle, std::uint32_t, std::uint32_t,
                                      std::uint32_t, std::uint32_t>);
struct Region {
  std::array<std::int64_t, 16> data{};
  std::array<bool, 16> initialized{}; // zeroed bytes are not initialized language values
  std::uint32_t generation = 1, tenant = 0, actor = 0, count = 0;
  std::uint32_t readers = 0, shares = 0;
  bool live = false, writer = false, frozen = false, retired = false;
};
class Arena {
  std::array<Region, 2> regions{};
  Region* valid(const Handle& h) {
    if (h.slot_ >= regions.size()) return nullptr;
    auto& r = regions[h.slot_];
    if (!r.live || r.generation != h.generation_ ||
        r.tenant != h.tenant_ || r.actor != h.actor_) return nullptr;
    return &r;
  }
public:
  std::optional<Handle> allocate(std::uint64_t count, std::uint32_t tenant, std::uint32_t actor) {
    if (count > 16 || count > std::numeric_limits<std::uint32_t>::max() / sizeof(std::int64_t))
      return std::nullopt; // multiply bounds BEFORE size conversion/addition
    for (std::uint32_t i = 0; i < regions.size(); ++i) {
      auto& r = regions[i];
      if (!r.live && !r.retired) {
        r.live = true; r.tenant = tenant; r.actor = actor;
        r.count = static_cast<std::uint32_t>(count);
        r.readers = 0; r.shares = 0; r.writer = false; r.frozen = false;
        r.data.fill(0); r.initialized.fill(false);
        return Handle{i, r.generation, tenant, actor};
      }
    }
    return std::nullopt;
  }
  std::optional<std::int64_t> read(const Handle& h, std::uint64_t index) {
    auto* r = valid(h);
    if (!r || r->writer || index >= r->count ||
        !r->initialized[static_cast<std::size_t>(index)]) return std::nullopt;
    return r->data[static_cast<std::size_t>(index)];
  }
  bool write(const Handle& h, std::uint64_t index, std::int64_t value) {
    auto* r = valid(h);
    if (!r || r->writer || r->readers || r->frozen || index >= r->count) return false;
    r->data[static_cast<std::size_t>(index)] = value;
    r->initialized[static_cast<std::size_t>(index)] = true;
    return true;
  }
  bool read_loan(const Handle& h) {
    auto* r = valid(h);
    if (!r || r->writer || r->readers == std::numeric_limits<std::uint32_t>::max()) return false;
    ++r->readers; return true;
  }
  bool end_read_loan(const Handle& h) {
    auto* r = valid(h);
    if (!r || !r->readers) return false;
    --r->readers; return true;
  }
  bool write_loan(const Handle& h) {
    auto* r = valid(h);
    if (!r || r->writer || r->readers || r->frozen) return false;
    r->writer = true; return true;
  }
  bool end_write_loan(const Handle& h) {
    auto* r = valid(h);
    if (!r || !r->writer) return false;
    r->writer = false; return true;
  }
  bool freeze(const Handle& h) {
    auto* r = valid(h);
    if (!r || r->readers || r->writer) return false;
    r->frozen = true; return true;
  }
  // Model a scoped immutable share. No guest token or real thread scheduling
  // is implemented here; the runtime must prove loan identity separately.
  bool share_loan(const Handle& h) {
    auto* r = valid(h);
    if (!r || !r->frozen || r->writer || r->shares == std::numeric_limits<std::uint32_t>::max())
      return false;
    ++r->shares; return true;
  }
  bool end_share_loan(const Handle& h) {
    auto* r = valid(h);
    if (!r || !r->shares) return false;
    --r->shares; return true;
  }
  std::optional<Handle> move(const Handle& h, std::uint32_t tenant, std::uint32_t actor, bool admitted) {
    auto* r = valid(h);
    if (!r || !admitted || r->readers || r->shares || r->writer || r->tenant != tenant ||
        r->generation == std::numeric_limits<std::uint32_t>::max()) return std::nullopt;
    ++r->generation; r->actor = actor;
    return Handle{h.slot_, r->generation, tenant, actor};
  }
  bool close(const Handle& h) {
    auto* r = valid(h);
    if (!r || r->readers || r->shares || r->writer) return false;
    r->live = false;
    if (r->generation == std::numeric_limits<std::uint32_t>::max()) r->retired = true;
    else ++r->generation;
    return true;
  }
};
int main() {
  Arena a;
  auto h = a.allocate(3, 7, 41); assert(h);
  assert(!a.read(*h, 0));                           // uninitialized read denied
  assert(!a.read(*h, 2));                           // distinct uninitialized element denied
  assert(a.write(*h, 1, 0));                         // an initialized zero is a valid value
  assert(a.read(*h, 1) == 0);
  assert(a.write(*h, 0, 42));                        // 1: valid write
  assert(a.read(*h, 0) == 42);                       // 2: valid read
  assert(!a.read(*h, 3));                           // 3: one past end
  assert(!a.write(*h, UINT64_MAX, 5));              // 4: checked overflow input
  assert(a.read_loan(*h));                          // 5: shared read loan
  assert(a.read_loan(*h));                          // 6: concurrent readers
  assert(!a.write(*h, 1, 9));                       // 7: no write under readers
  assert(!a.write_loan(*h));                        // 8: no exclusive loan under readers
  assert(a.end_read_loan(*h) && a.end_read_loan(*h));
  assert(a.write_loan(*h));                         // 9: exclusive loan
  assert(!a.read(*h, 0));                           // 10: no competing read
  assert(a.end_write_loan(*h));
  assert(!a.move(*h, 7, 42, false));                 // 11: failed admission preserves owner
  assert(a.read(*h, 0) == 42);
  assert(!a.move(*h, 8, 42, true));                  // 12: cross-tenant move denied
  auto next = a.move(*h, 7, 42, true); assert(next);// 13: successful move revokes old generation
  assert(!a.read(*h, 0));
  assert(a.read(*next, 0) == 42);
  assert(a.freeze(*next));                          // 14: immutable share disallows writes
  assert(!a.write(*next, 0, 1));
  assert(!a.read(*next, 2));                        // freeze must not initialize memory
  assert(a.share_loan(*next));
  assert(a.share_loan(*next));
  assert(!a.close(*next));                          // no free while shares still live
  assert(!a.move(*next, 7, 43, true));              // no actor transfer with live shares
  assert(a.end_share_loan(*next));
  assert(!a.close(*next));                          // second share still pins region
  assert(a.end_share_loan(*next));
  assert(!a.end_share_loan(*next));                  // cannot underflow share accounting
  assert(!a.share_loan(*h));                        // revoked owner cannot resurrect share
  assert(a.close(*next));                           // 15: close revokes and invalidates
  assert(!a.close(*next) && !a.read(*next, 0));
  assert(!a.allocate(UINT64_MAX, 7, 41));           // 16: no allocation arithmetic wrap
  auto zero = a.allocate(0, 7, 44); assert(zero);
  assert(!a.read(*zero, 0));                        // 17: zero length invalid access
  assert(a.close(*zero));
  std::cout << "pointer capability SOURCE-FREE model assertions passed\n";
}
