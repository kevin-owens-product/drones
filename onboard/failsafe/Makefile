CC ?= cc
BUILD := build

.PHONY: test clean

test: $(BUILD)/failsafe_test
	$(BUILD)/failsafe_test

$(BUILD)/failsafe_test: src/failsafe.c test/failsafe_test.c include/failsafe.h
	mkdir -p $(BUILD)
	$(CC) -std=c17 -O2 -Wall -Wextra -Werror -Iinclude -o $@ src/failsafe.c test/failsafe_test.c

clean:
	rm -rf $(BUILD)
