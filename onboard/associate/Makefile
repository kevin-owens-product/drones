CC ?= cc
BUILD := build

.PHONY: test clean

test: $(BUILD)/associate_test
	$(BUILD)/associate_test

$(BUILD)/associate_test: src/associate.c test/associate_test.c include/associate.h
	mkdir -p $(BUILD)
	$(CC) -std=c17 -O2 -Wall -Wextra -Werror -Iinclude -o $@ src/associate.c test/associate_test.c -lm
