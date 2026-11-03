#include "flowhold.h"

#include <math.h>
#include <stdio.h>

static int fail(const char *message) {
    fprintf(stderr, "FAIL %s\n", message);
    return 1;
}

static int test_cancels_known_flow(void) {
    flow_vel v = flow_hold(0.2, -0.1, 2.0);
    printf("hold_vx %.2f hold_vy %.2f\n", v.vx, v.vy);
    if (fabs(v.vx + 0.4) > 1e-9 || fabs(v.vy - 0.2) > 1e-9) {
        return fail("flow times range was not negated");
    }
    return 0;
}

static int test_closed_loop(void) {
    double vx = 1.0;
    double x = 0;
    double range = 2.0;
    int i;
    for (i = 0; i < 40; i++) {
        double flow = vx / range;
        flow_vel cmd = flow_hold(flow, 0, range);
        vx += (cmd.vx - vx) * 0.5;
        x += vx * 0.1;
    }
    printf("hold_speed %.3f hold_drift_m %.3f\n", vx, x);
    if (fabs(vx) > 0.05) {
        return fail("lateral speed did not settle");
    }
    if (fabs(x) > 0.5) {
        return fail("position drifted more than 0.5 m");
    }
    return 0;
}

int main(void) {
    if (test_cancels_known_flow() || test_closed_loop()) {
        return 1;
    }
    printf("flowhold tests passed\n");
    return 0;
}
