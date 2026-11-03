CC ?= cc
BUILD := build

.PHONY: test clean

test: $(BUILD)/mesh_test
	$(BUILD)/mesh_test

$(BUILD)/mesh_test: src/mesh.c test/mesh_test.c include/mesh.h
	mkdir -p $(BUILD)
	$(CC) -std=c17 -O2 -Wall -Wextra -Werror -Iinclude -o $@ src/mesh.c test/mesh_test.c -lm
