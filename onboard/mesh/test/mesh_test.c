#include "mesh.h"

#include <stdio.h>

static int fail(const char *message) {
    fprintf(stderr, "FAIL %s\n", message);
    return 1;
}

static int test_relay(void) {
    mesh_node nodes[3] = {
        {0, 0, 1},
        {9, 0, 1},
        {18, 0, 1},
    };
    int hops[4];
    int n;
    n = mesh_route(nodes, 3, 0, 2, 10, hops, 4);
    printf("relay_hops %d path %d-%d-%d\n", n, hops[0], hops[1], hops[2]);
    if (n != 2 || hops[0] != 0 || hops[1] != 1 || hops[2] != 2) {
        return fail("relay path was not ground-relay-vehicle");
    }
    nodes[1].alive = 0;
    if (mesh_route(nodes, 3, 0, 2, 10, hops, 4) != -1) {
        return fail("dead relay still carried the packet");
    }
    nodes[1].alive = 1;
    if (mesh_route(nodes, 3, 0, 2, 8, hops, 4) != -1) {
        return fail("short range should not bridge 9 m gaps");
    }
    printf("mesh tests passed\n");
    return 0;
}

int main(void) {
    return test_relay();
}
