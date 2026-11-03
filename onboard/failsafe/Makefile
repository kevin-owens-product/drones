CC ?= cc
BUILD := build

.PHONY: test clean

test: $(BUILD)/failsafe_test $(BUILD)/lostlink_test
	$(BUILD)/failsafe_test
	$(BUILD)/lostlink_test

$(BUILD)/failsafe_test: src/failsafe.c test/failsafe_test.c include/failsafe.h
	mkdir -p $(BUILD)
	$(CC) -std=c17 -O2 -Wall -Wextra -Werror -Iinclude -o $@ src/failsafe.c test/failsafe_test.c

$(BUILD)/lostlink_test: src/lostlink.c test/lostlink_test.c include/lostlink.h
	mkdir -p $(BUILD)
	$(CC) -std=c17 -O2 -Wall -Wextra -Werror -Iinclude -o $@ src/lostlink.c test/lostlink_test.c

clean:
	rm -rf $(BUILD)
