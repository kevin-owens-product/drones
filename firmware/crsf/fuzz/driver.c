/* Runs the libFuzzer entry on a fixed LCG stream when the fuzzer runtime is absent. */
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);

int main(void) {
    uint8_t buf[128];
    uint32_t state = 0xA2E0C5F1u;
    int i;
    for (i = 0; i < 100000; i++) {
        size_t n = (state >> 8) & 127u;
        size_t j;
        for (j = 0; j < n; j++) {
            state = state * 1664525u + 1013904223u;
            buf[j] = (uint8_t)(state >> 24);
        }
        LLVMFuzzerTestOneInput(buf, n);
    }
    printf("crsf fuzz smoke 100000 inputs\n");
    return 0;
}
