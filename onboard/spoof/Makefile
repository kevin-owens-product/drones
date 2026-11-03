CC ?= cc
CFLAGS ?= -std=c17 -O2 -Wall -Wextra -Werror -Iinclude -lm
BUILD := build

.PHONY: test clean

test: $(BUILD)/spoof_test $(BUILD)/fault_scenarios
	$(BUILD)/spoof_test
	$(BUILD)/fault_scenarios

$(BUILD)/spoof_test: src/spoof.c test/spoof_test.c include/spoof.h
	mkdir -p $(BUILD)
	$(CC) -std=c17 -O2 -Wall -Wextra -Werror -Iinclude -o $@ src/spoof.c test/spoof_test.c -lm

$(BUILD)/fault_scenarios: src/spoof.c src/fault.c test/scenarios.c include/spoof.h include/fault.h
	mkdir -p $(BUILD)
	$(CC) -std=c17 -O2 -Wall -Wextra -Werror -Iinclude -o $@ src/spoof.c src/fault.c test/scenarios.c -lm

clean:
	rm -rf $(BUILD)
