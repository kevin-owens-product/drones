CC ?= cc
BUILD := build

.PHONY: test clean

test: $(BUILD)/link_test
	$(BUILD)/link_test

$(BUILD)/link_test: src/link.c test/link_test.c include/link.h
	mkdir -p $(BUILD)
	$(CC) -std=c17 -O2 -Wall -Wextra -Werror -Iinclude -o $@ src/link.c test/link_test.c -lm
