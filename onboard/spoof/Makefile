CC ?= cc
CFLAGS ?= -std=c17 -O2 -Wall -Wextra -Werror -Iinclude -lm
BUILD := build

.PHONY: test clean

test: $(BUILD)/spoof_test
	$(BUILD)/spoof_test

$(BUILD)/spoof_test: src/spoof.c test/spoof_test.c include/spoof.h
	mkdir -p $(BUILD)
	$(CC) -std=c17 -O2 -Wall -Wextra -Werror -Iinclude -o $@ src/spoof.c test/spoof_test.c -lm

clean:
	rm -rf $(BUILD)
