#include <stdint.h>
#include <inttypes.h>
#include <stdio.h>
extern int64_t oreslang_guest_main(void);
int main(void) {
  int64_t result=oreslang_guest_main();
  if (printf("%" PRId64 "\\n",result)<0) return 71;
  return 0;
}
