CC ?= cc
BUILD := build

.PHONY: test clean

test: $(BUILD)/cbba_test $(BUILD)/intent_test
	$(BUILD)/cbba_test
	$(BUILD)/intent_test

$(BUILD)/cbba_test: src/cbba.c test/cbba_test.c include/cbba.h
	mkdir -p $(BUILD)
	$(CC) -std=c17 -O2 -Wall -Wextra -Werror -Iinclude -o $@ src/cbba.c test/cbba_test.c -lm

$(BUILD)/intent_test: src/cbba.c src/intent.c test/intent_test.c include/cbba.h include/intent.h
	mkdir -p $(BUILD)
	$(CC) -std=c17 -O2 -Wall -Wextra -Werror -Iinclude -o $@ src/cbba.c src/intent.c test/intent_test.c -lm
