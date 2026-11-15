// SOURCE-FREE C++20 MODEL ONLY: not an AttoLang guest or backend.
// Tests bounded, generation-checked, actor-scoped pointer capabilities without UB.
#include <array>
#include <cassert>
#include <cstdint>
#include <iostream>
#include <limits>
#include <optional>

struct Handle {
  std::uint32_t slot, generation, tenant, actor;
};
struct Region {
  std::array<std::int64_t, 16> data{};
  std::uint32_t generation = 1, tenant = 0, actor = 0, count = 0;
  std::uint32_t readers = 0;
  bool live = false, writer = false, frozen = false, retired = false;
};
class Arena {
  std::array<Region, 2> regions{};
  Region* valid(Handle h) {
    if (h.slot >= regions.size()) return nullptr;
    auto& r = regions[h.slot];
    if (!r.live || r.generation != h.generation ||
        r.tenant != h.tenant || r.actor != h.actor) return nullptr;
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
        r.readers = 0; r.writer = false; r.frozen = false;
        r.data.fill(0);
        return Handle{i, r.generation, tenant, actor};
      }
    }
    return std::nullopt;
  }
  std::optional<std::int64_t> read(Handle h, std::uint64_t index) {
    auto* r = valid(h);
    if (!r || r->writer || index >= r->count) return std::nullopt;
    return r->data[static_cast<std::size_t>(index)];
  }
  bool write(Handle h, std::uint64_t index, std::int64_t value) {
    auto* r = valid(h);
    if (!r || r->writer || r->readers || r->frozen || index >= r->count) return false;
    r->data[static_cast<std::size_t>(index)] = value;
    return true;
  }
  bool read_loan(Handle h) {
    auto* r = valid(h);
    if (!r || r->writer || r->readers == std::numeric_limits<std::uint32_t>::max()) return false;
    ++r->readers; return true;
  }
  bool end_read_loan(Handle h) {
    auto* r = valid(h);
    if (!r || !r->readers) return false;
    --r->readers; return true;
  }
  bool write_loan(Handle h) {
    auto* r = valid(h);
    if (!r || r->writer || r->readers || r->frozen) return false;
    r->writer = true; return true;
  }
  bool end_write_loan(Handle h) {
    auto* r = valid(h);
    if (!r || !r->writer) return false;
    r->writer = false; return true;
  }
  bool freeze(Handle h) {
    auto* r = valid(h);
    if (!r || r->readers || r->writer) return false;
    r->frozen = true; return true;
  }
  std::optional<Handle> move(Handle h, std::uint32_t tenant, std::uint32_t actor, bool admitted) {
    auto* r = valid(h);
    if (!r || !admitted || r->readers || r->writer || r->tenant != tenant ||
        r->generation == std::numeric_limits<std::uint32_t>::max()) return std::nullopt;
    ++r->generation; r->actor = actor;
    return Handle{h.slot, r->generation, tenant, actor};
  }
  bool close(Handle h) {
    auto* r = valid(h);
    if (!r || r->readers || r->writer) return false;
    r->live = false;
    if (r->generation == std::numeric_limits<std::uint32_t>::max()) r->retired = true;
    else ++r->generation;
    return true;
  }
};
int main() {
  Arena a;
  auto h = a.allocate(3, 7, 41); assert(h);
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
  assert(a.close(*next));                           // 15: close revokes and invalidates
  assert(!a.close(*next) && !a.read(*next, 0));
  assert(!a.allocate(UINT64_MAX, 7, 41));           // 16: no allocation arithmetic wrap
  auto zero = a.allocate(0, 7, 44); assert(zero);
  assert(!a.read(*zero, 0));                        // 17: zero length invalid access
  assert(a.close(*zero));
  std::cout << "17/17 pointer capability SOURCE-FREE model assertions passed\n";
}
