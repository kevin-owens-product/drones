#include "link.h"

#include <math.h>

static unsigned lcg(unsigned *state) {
    *state = *state * 1664525u + 1013904223u;
    return *state;
}

double link_jammer_loss(const link_jammer *jammer, double x, double y) {
    double dx;
    double dy;
    if (jammer == 0) {
        return 0;
    }
    dx = x - jammer->x;
    dy = y - jammer->y;
    if (dx * dx + dy * dy <= jammer->radius_m * jammer->radius_m) {
        return jammer->extra_loss_db;
    }
    return 0;
}

double link_success_prob(double distance_m, double jammer_loss_db) {
    /* Free-space-ish: 0 dB at 1 m, 20 dB/decade, then a logistic around 90 dB. */
    double loss;
    double x;
    if (distance_m < 1) {
        distance_m = 1;
    }
    loss = 20.0 * log10(distance_m) + jammer_loss_db;
    x = (loss - 60.0) / 6.0;
    if (x > 20) {
        return 0;
    }
    if (x < -20) {
        return 1;
    }
    return 1.0 / (1.0 + exp(x));
}

int link_deliver(link_rng *rng, double distance_m, const link_jammer *jammer, double sx, double sy) {
    double p = link_success_prob(distance_m, link_jammer_loss(jammer, sx, sy));
    double u = (lcg(&rng->rng) + 1.0) / 4294967296.0;
    return u < p;
}
