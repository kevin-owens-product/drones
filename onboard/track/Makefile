CC ?= cc
BUILD := build

.PHONY: test clean

test: $(BUILD)/track_test
	$(BUILD)/track_test

$(BUILD)/track_test: src/track.c test/track_test.c include/track.h
	mkdir -p $(BUILD)
	$(CC) -std=c17 -O2 -Wall -Wextra -Werror -Iinclude -o $@ src/track.c test/track_test.c -lm
