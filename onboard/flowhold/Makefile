CC ?= cc
BUILD := build

.PHONY: test clean

test: $(BUILD)/flowhold_test
	$(BUILD)/flowhold_test

$(BUILD)/flowhold_test: src/flowhold.c test/flowhold_test.c include/flowhold.h
	mkdir -p $(BUILD)
	$(CC) -std=c17 -O2 -Wall -Wextra -Werror -Iinclude -o $@ src/flowhold.c test/flowhold_test.c -lm
