CC ?= cc
CFLAGS ?= -std=c17 -O2 -Wall -Wextra -Werror -Iinclude
BUILD := build

.PHONY: test fuzz clean

test: $(BUILD)/crsf_test $(BUILD)/crsf_smoke testdata/stream.bin
	$(BUILD)/crsf_test testdata
	$(BUILD)/crsf_smoke

$(BUILD)/crsf_smoke: src/crsf.c fuzz/crsf_fuzzer.c fuzz/driver.c include/crsf.h
	mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -o $@ src/crsf.c fuzz/crsf_fuzzer.c fuzz/driver.c

$(BUILD)/crsf_test: src/crsf.c test/crsf_test.c include/crsf.h
	mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -o $@ src/crsf.c test/crsf_test.c

testdata/stream.bin: tools/gen_vectors.py
	python3 tools/gen_vectors.py

fuzz: src/crsf.c fuzz/crsf_fuzzer.c include/crsf.h
	mkdir -p $(BUILD)
	clang -std=c17 -O1 -g -fsanitize=fuzzer,address -Iinclude -o $(BUILD)/crsf_fuzzer src/crsf.c fuzz/crsf_fuzzer.c

clean:
	rm -rf $(BUILD)
