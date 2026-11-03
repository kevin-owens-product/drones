#!/bin/sh
# Retired-instruction count for one parser push on qemu-system-arm -M mps2-an386.
# The DWT cycle counter stays at 0 on that machine, so this does not print a cycle count.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
SYS=""
for dir in /usr/include/newlib /usr/lib/arm-none-eabi/include; do
    if [ -f "$dir/string.h" ]; then
        SYS="$SYS -isystem $dir"
    fi
done
build() {
    arm-none-eabi-gcc -std=c17 -Os -mcpu=cortex-m4 -mthumb -ffreestanding -nostdlib \
        -Wall -Wextra -Werror -ffunction-sections -fdata-sections -Wl,--gc-sections \
        -DTIMING_LOOPS="$1" -T "$ROOT/firmware/crsf/m4/mps2.ld" $SYS \
        -I "$ROOT/firmware/crsf/include" \
        "$ROOT/firmware/crsf/src/crsf.c" "$ROOT/firmware/crsf/m4/time.c" \
        -o "/tmp/crsf_time_$1.elf"
}
build 1
build 2
for n in 1 2; do
    timeout 20 qemu-system-arm -M mps2-an386 -cpu cortex-m4 -nographic \
        -semihosting-config enable=on,target=native -kernel "/tmp/crsf_time_$n.elf" \
        -d exec,nochain -D "/tmp/crsf_trace_$n" >/tmp/crsf_semi_$n 2>&1
done
one=$(awk '/^Trace / { n++ } END { print n + 0 }' /tmp/crsf_trace_1)
two=$(awk '/^Trace / { n++ } END { print n + 0 }' /tmp/crsf_trace_2)
push=$(awk '/^Trace / && /crsf_parser_push$/ { n++ } END { print n + 0 }' /tmp/crsf_trace_1)
crc=$(awk '/^Trace / && /crsf_crc8$/ { n++ } END { print n + 0 }' /tmp/crsf_trace_1)
echo "push_iteration_insns $((two - one))"
echo "crsf_parser_push_insns $push"
echo "crsf_crc8_insns $crc"
echo "dwt_cycles 0"
cat /tmp/crsf_semi_1
