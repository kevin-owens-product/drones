# CRSF telemetry parser

ExpressLRS and TBS Crossfire put GPS, battery, link, attitude, and flight-mode frames on a UART. The parser in `firmware/crsf` is C17, uses no heap, and is the piece that will later sit on a companion computer or a flight-controller build.

## Approach

A byte stream is synced on the CRSF device addresses (`0xC8`, `0xEA`, `0xEC`, `0xEE`, `0x00`). The length byte is the count of type, payload, and CRC. The CRC is CRC8 with the DVB-S2 polynomial `0xD5`, over type and payload only, which is the layout Betaflight's telemetry test documents. A bad CRC drops one byte and hunts again, so a following good frame is not lost. Multi-byte fields are big-endian.

## Numbers

On this laptop the unit test parsed about 11.5 million frames per second. The regression floor in the test is 200,000 frames per second, which still leaves headroom on a Raspberry Pi 5. The parser does a fixed amount of work per byte and allocates nothing.

## What failed

`make -C firmware/crsf fuzz` does not link on this machine. Apple's Command Line Tools clang does not ship `libclang_rt.fuzzer_osx.a`. The libFuzzer entry point is `firmware/crsf/fuzz/crsf_fuzzer.c`. On a host with a full LLVM it is:

```bash
clang -std=c17 -O1 -g -fsanitize=fuzzer,address -Iinclude \
  -o build/crsf_fuzzer src/crsf.c fuzz/crsf_fuzzer.c
./build/crsf_fuzzer -runs=100000
```

Until that runtime is present, `make test` runs the same entry point on 100,000 deterministic inputs.

## Cortex-M4 size

`deploy/crsf-m4` runs Bazel 7.4.1, which calls `arm-none-eabi-gcc` 13.2.1 for `-mcpu=cortex-m4 -mthumb` and links with newlib nosys. `docker run --rm a2e-crsf-m4:7.4.1` printed:

| Artifact | text | data | bss |
| --- | --- | --- | --- |
| Linked elf, parser plus a main and newlib stubs | 2126 | 12 | 748 |
| Parser object only | 802 | 0 | 0 |

There is no cycle count. This image does not run the parser on an STM32 or in QEMU. The 802-byte text size is the parser itself. The elf is larger because the C library stubs are linked in.
