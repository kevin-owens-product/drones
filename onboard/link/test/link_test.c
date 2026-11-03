#include "link.h"

#include <stdio.h>

static int fail(const char *message) {
    fprintf(stderr, "FAIL %s\n", message);
    return 1;
}

static double rate(double distance, const link_jammer *jammer, double sx, double sy) {
    link_rng rng;
    int i;
    int ok = 0;
    rng.rng = 0xA2E01111u;
    for (i = 0; i < 2000; i++) {
        ok += link_deliver(&rng, distance, jammer, sx, sy);
    }
    return (double)ok / 2000.0;
}

int main(void) {
    link_jammer jammer = {0, 0, 100, 60};
    double near = rate(50, 0, 0, 0);
    double far = rate(5000, 0, 0, 0);
    double jammed = rate(50, &jammer, 0, 0);
    double outside = rate(50, &jammer, 500, 0);
    printf("success_50m %.3f\n", near);
    printf("success_5km %.3f\n", far);
    printf("success_jammed %.3f\n", jammed);
    printf("success_outside_jammer %.3f\n", outside);
    if (near < 0.9) {
        return fail("50 m link is not reliable");
    }
    if (far > 0.15) {
        return fail("5 km link is too reliable");
    }
    if (jammed > 0.2) {
        return fail("jammer did not collapse the link");
    }
    if (outside < 0.9) {
        return fail("jammer leaked outside its radius");
    }
    if (outside + 0.02 < near || outside < jammed || near < far) {
        return fail("success rate is not ordered");
    }
    printf("link tests passed\n");
    return 0;
}
