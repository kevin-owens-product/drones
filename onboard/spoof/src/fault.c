#include "fault.h"

#include <math.h>

static unsigned lcg(unsigned *state) {
    *state = *state * 1664525u + 1013904223u;
    return *state;
}

static double normal(unsigned *state) {
    double u = (lcg(state) + 1.0) / 4294967296.0;
    double v = (lcg(state) + 1.0) / 4294967296.0;
    if (u < 1e-12) {
        u = 1e-12;
    }
    return sqrt(-2.0 * log(u)) * cos(2.0 * 3.141592653589793 * v);
}

void fault_init(fault_inj *fault, fault_kind kind) {
    fault->kind = kind;
    fault->drag_mps = 0.4;
    fault->step_m = 40.0;
    fault->multipath_sigma_m = 1.5;
    fault->rng = 0xA2E0FAu;
    fault->held = 0;
    fault->hold.n = 0;
    fault->hold.e = 0;
    fault->hold.d = 0;
}

spoof_vec3 fault_apply(fault_inj *fault, spoof_vec3 truth, double t_s) {
    spoof_vec3 out = truth;
    if (fault->kind == FAULT_LOSS) {
        if (!fault->held) {
            fault->hold = truth;
            fault->held = 1;
        }
        return fault->hold;
    }
    if (fault->kind == FAULT_DRAG) {
        out.n += fault->drag_mps * t_s;
        return out;
    }
    if (fault->kind == FAULT_STEP) {
        out.n += fault->step_m;
        return out;
    }
    if (fault->kind == FAULT_MULTIPATH) {
        out.n += fault->multipath_sigma_m * normal(&fault->rng);
        out.e += fault->multipath_sigma_m * normal(&fault->rng);
        out.d += fault->multipath_sigma_m * normal(&fault->rng);
        return out;
    }
    return out;
}
