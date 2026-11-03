CC ?= cc
BUILD := build

.PHONY: test clean

test: $(BUILD)/separate_test
	$(BUILD)/separate_test

$(BUILD)/separate_test: src/separate.c test/separate_test.c include/separate.h
	mkdir -p $(BUILD)
	$(CC) -std=c17 -O2 -Wall -Wextra -Werror -Iinclude -o $@ src/separate.c test/separate_test.c -lm
