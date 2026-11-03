#include "failsafe.h"

#include <stdio.h>

static int fail(const char *message) {
    fprintf(stderr, "FAIL %s\n", message);
    return 1;
}

static fs_input in(int link, int ret, int land, double dt) {
    fs_input x;
    x.link_up = link;
    x.operator_return = ret;
    x.operator_land = land;
    x.dt_s = dt;
    return x;
}

static int test_link_ladder(void) {
    fs_machine m;
    fs_init(&m);
    if (fs_step(&m, in(0, 0, 0, 1.9)) != FS_CONTINUE) {
        return fail("grace period should stay continue");
    }
    if (fs_step(&m, in(0, 0, 0, 0.2)) != FS_LOITER) {
        return fail("link loss should loiter after 2s");
    }
    if (fs_step(&m, in(0, 0, 0, 9.9)) != FS_LOITER) {
        return fail("loiter holds until 10s");
    }
    if (fs_step(&m, in(0, 0, 0, 0.2)) != FS_RETURN) {
        return fail("loiter should become return");
    }
    if (fs_step(&m, in(0, 0, 0, 29.9)) != FS_RETURN) {
        return fail("return holds until 30s");
    }
    if (fs_step(&m, in(0, 0, 0, 0.2)) != FS_LAND) {
        return fail("return should become land");
    }
    if (fs_step(&m, in(1, 0, 0, 5)) != FS_LAND) {
        return fail("land is terminal");
    }
    printf("link_ladder continue->loiter->return->land\n");
    return 0;
}

static int test_restore(void) {
    fs_machine m;
    fs_init(&m);
    fs_step(&m, in(0, 0, 0, 2.0));
    if (m.state != FS_LOITER) {
        return fail("expected loiter");
    }
    if (fs_step(&m, in(1, 0, 0, 0.1)) != FS_CONTINUE) {
        return fail("link restore from loiter should continue");
    }
    fs_step(&m, in(0, 0, 0, 2.0));
    fs_step(&m, in(0, 0, 0, 10.0));
    if (m.state != FS_RETURN) {
        return fail("expected return");
    }
    if (fs_step(&m, in(1, 0, 0, 0.1)) != FS_CONTINUE) {
        return fail("link restore from return should continue");
    }
    printf("restore loiter->continue and return->continue\n");
    return 0;
}

static int test_operator(void) {
    fs_machine m;
    fs_init(&m);
    if (fs_step(&m, in(1, 1, 0, 0.1)) != FS_RETURN) {
        return fail("operator return");
    }
    if (fs_step(&m, in(1, 0, 1, 0.1)) != FS_LAND) {
        return fail("operator land overrides return");
    }
    fs_init(&m);
    if (fs_step(&m, in(1, 0, 1, 0.1)) != FS_LAND) {
        return fail("operator land from continue");
    }
    printf("operator return and land\n");
    return 0;
}

static int test_store(void) {
    sf_buf b;
    unsigned char out[SF_LEN];
    unsigned char payload[4];
    int i;
    int n;
    sf_init(&b);
    for (i = 0; i < 10; i++) {
        payload[0] = (unsigned char)i;
        if (sf_push(&b, payload, 1) != 0) {
            return fail("push");
        }
    }
    for (i = 0; i < 10; i++) {
        n = sf_pop(&b, out, SF_LEN);
        if (n != 1 || out[0] != (unsigned char)i) {
            return fail("order");
        }
    }
    if (sf_pop(&b, out, SF_LEN) != 0) {
        return fail("empty");
    }
    for (i = 0; i < SF_CAP + 3; i++) {
        payload[0] = (unsigned char)i;
        sf_push(&b, payload, 1);
    }
    if (b.dropped != 3) {
        return fail("overflow drops");
    }
    n = sf_pop(&b, out, SF_LEN);
    if (n != 1 || out[0] != 3) {
        return fail("oldest dropped");
    }
    printf("store_and_forward 10 ordered, overflow_dropped 3\n");
    return 0;
}

int main(void) {
    if (test_link_ladder() || test_restore() || test_operator() || test_store()) {
        return 1;
    }
    printf("failsafe tests passed\n");
    return 0;
}
