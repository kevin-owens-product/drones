#include "separate.h"

#include <stdio.h>

static int fail(const char *message) {
    fprintf(stderr, "FAIL %s\n", message);
    return 1;
}

static int test_head_on(void) {
    sep_body guided[2] = {
        {0, 0, 5, 0},
        {20, 0, -5, 0},
    };
    double bare_x = 0;
    double bare_o = 20;
    double bare_min = 20;
    double min_d = 1e300;
    int i;
    for (i = 0; i < 80; i++) {
        double d;
        double gap;
        bare_x += 5 * 0.05;
        bare_o += -5 * 0.05;
        gap = bare_o - bare_x;
        if (gap < 0) {
            gap = -gap;
        }
        if (gap < bare_min) {
            bare_min = gap;
        }
        sep_step(guided, 2, 6.0, 0.05);
        d = sep_min_distance(guided, 2);
        if (d < min_d) {
            min_d = d;
        }
    }
    printf("unguided_min_m %.2f guided_min_m %.2f\n", bare_min, min_d);
    if (bare_min > 1.0) {
        return fail("unguided pair did not meet");
    }
    if (min_d < 4.0) {
        return fail("guided pair closed inside 4 m");
    }
    return 0;
}

static int test_parallel_holds_course(void) {
    sep_body bodies[2] = {
        {0, 0, 5, 0},
        {0, 30, 5, 0},
    };
    int i;
    for (i = 0; i < 40; i++) {
        sep_step(bodies, 2, 6.0, 0.05);
    }
    if (bodies[0].y > 1.0 || bodies[1].y < 29.0) {
        return fail("far pair was pushed off course");
    }
    printf("parallel_y %.2f %.2f\n", bodies[0].y, bodies[1].y);
    return 0;
}

int main(void) {
    if (test_head_on() || test_parallel_holds_course()) {
        return 1;
    }
    printf("separation tests passed\n");
    return 0;
}
