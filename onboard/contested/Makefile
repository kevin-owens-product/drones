CC ?= cc
BUILD := build
INC := -I../alloc/include -I../link/include -I../mesh/include -I../failsafe/include -I../separate/include
FLEET_SRC := ../alloc/src/cbba.c ../link/src/link.c ../mesh/src/mesh.c ../failsafe/src/failsafe.c ../failsafe/src/lostlink.c

.PHONY: test clean

test: $(BUILD)/fleet_test $(BUILD)/dense_test
	$(BUILD)/fleet_test
	$(BUILD)/dense_test

$(BUILD)/fleet_test: test/fleet_test.c $(FLEET_SRC)
	mkdir -p $(BUILD)
	$(CC) -std=c17 -O2 -Wall -Wextra -Werror $(INC) -o $@ test/fleet_test.c $(FLEET_SRC) -lm

$(BUILD)/dense_test: test/dense_test.c ../separate/src/separate.c
	mkdir -p $(BUILD)
	$(CC) -std=c17 -O2 -Wall -Wextra -Werror $(INC) -o $@ test/dense_test.c ../separate/src/separate.c -lm

clean:
	rm -rf $(BUILD)
