/* One CRSF push on a Cortex-M4. QEMU mps2-an386 runs this.
 * The DWT cycle counter is read and stays 0 on that machine, so the timing
 * report counts retired instructions from the QEMU exec trace instead. */
#include "crsf.h"

#include <stddef.h>
#include <stdint.h>

extern uint32_t _stack_top;
extern uint8_t _sbss;
extern uint8_t _ebss;

int main(void);

static void semi_write0(const char *text) {
    register uint32_t op __asm__("r0") = 0x04;
    register const char *arg __asm__("r1") = text;
    __asm volatile("bkpt 0xAB" : : "r"(op), "r"(arg) : "memory");
}

static void semi_exit(void) {
    register uint32_t op __asm__("r0") = 0x18;
    register uint32_t arg __asm__("r1") = 0x20026;
    __asm volatile("bkpt 0xAB" : : "r"(op), "r"(arg) : "memory");
}

void HardFault_Handler(void) {
    semi_write0("hardfault\n");
    semi_exit();
}

void Reset_Handler(void) {
    uint8_t *cursor = &_sbss;
    while (cursor < &_ebss) {
        *cursor++ = 0;
    }
    main();
    semi_exit();
}

__attribute__((section(".isr_vector"), used)) const uint32_t vectors[] = {
    (uint32_t)&_stack_top,
    (uint32_t)Reset_Handler,
    (uint32_t)HardFault_Handler,
    (uint32_t)HardFault_Handler,
};

void *memset(void *dest, int value, size_t len) {
    uint8_t *out = dest;
    while (len > 0) {
        *out++ = (uint8_t)value;
        len--;
    }
    return dest;
}

void *memcpy(void *dest, const void *src, size_t len) {
    uint8_t *out = dest;
    const uint8_t *in = src;
    while (len > 0) {
        *out++ = *in++;
        len--;
    }
    return dest;
}

static void put_u32(char *out, uint32_t value) {
    char tmp[10];
    int n = 0;
    if (value == 0) {
        out[0] = '0';
        out[1] = 0;
        return;
    }
    while (value > 0) {
        tmp[n++] = (char)('0' + (value % 10));
        value /= 10;
    }
    while (n > 0) {
        *out++ = tmp[--n];
    }
    *out = 0;
}

#define DEMCR (*(volatile uint32_t *)0xE000EDFC)
#define DWT_CTRL (*(volatile uint32_t *)0xE0001000)
#define DWT_CYCCNT (*(volatile uint32_t *)0xE0001004)

#ifndef TIMING_LOOPS
#define TIMING_LOOPS 1000
#endif

int main(void) {
    static const uint8_t stream[] = {
        0x00, 0x11, 0x22, 0xc8, 0x11, 0x02, 0x16, 0x83, 0xfe, 0x08, 0xb7, 0x08,
        0x48, 0x30, 0x00, 0x7b, 0x6b, 0x3a, 0x04, 0x65, 0x0b, 0x37,
    };
    crsf_parser parser;
    crsf_frame frames[4];
    uint32_t frames_ok = 0;
    uint32_t start;
    uint32_t elapsed;
    char line[64];
    char number[16];
    int i;
    DEMCR |= 1u << 24;
    DWT_CYCCNT = 0;
    DWT_CTRL |= 1u;
    start = DWT_CYCCNT;
    for (i = 0; i < TIMING_LOOPS; i++) {
        crsf_parser_init(&parser);
        frames_ok += (uint32_t)crsf_parser_push(&parser, stream, sizeof(stream), frames, 4);
    }
    elapsed = DWT_CYCCNT - start;
    put_u32(number, frames_ok);
    line[0] = 0;
    {
        const char *prefix = "frames ";
        char *cursor = line;
        while (*prefix) {
            *cursor++ = *prefix++;
        }
        prefix = number;
        while (*prefix) {
            *cursor++ = *prefix++;
        }
        *cursor++ = '\n';
        *cursor = 0;
    }
    semi_write0(line);
    put_u32(number, elapsed);
    {
        const char *prefix = "cycles ";
        char *cursor = line;
        while (*prefix) {
            *cursor++ = *prefix++;
        }
        prefix = number;
        while (*prefix) {
            *cursor++ = *prefix++;
        }
        *cursor++ = '\n';
        *cursor = 0;
    }
    semi_write0(line);
    put_u32(number, elapsed / TIMING_LOOPS);
    {
        const char *prefix = "cycles_per_push ";
        char *cursor = line;
        while (*prefix) {
            *cursor++ = *prefix++;
        }
        prefix = number;
        while (*prefix) {
            *cursor++ = *prefix++;
        }
        *cursor++ = '\n';
        *cursor = 0;
    }
    semi_write0(line);
    return frames_ok == TIMING_LOOPS ? 0 : 1;
}
