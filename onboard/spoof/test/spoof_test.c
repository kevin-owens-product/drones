#include "spoof.h"

#include <math.h>
#include <stdint.h>
#include <stdio.h>

static int fail(const char *message) {
    fprintf(stderr, "FAIL %s\n", message);
    return 1;
}

static uint32_t lcg(uint32_t *state) {
    *state = *state * 1664525u + 1013904223u;
    return *state;
}

static double normal(uint32_t *state) {
    double u = (lcg(state) + 1.0) / 4294967296.0;
    double v = (lcg(state) + 1.0) / 4294967296.0;
    if (u < 1e-12) {
        u = 1e-12;
    }
    return sqrt(-2.0 * log(u)) * cos(2.0 * 3.141592653589793 * v);
}

static int test_step(void) {
    spoof_gate gate;
    spoof_decision d;
    int i;
    spoof_gate_init(&gate);
    for (i = 0; i < 3; i++) {
        spoof_vec3 gnss = {40, 0, 0};
        spoof_vec3 vio = {0, 0, 0};
        d = spoof_gate_update(&gate, gnss, vio, 2.0);
    }
    if (!d.dropped_now || d.gnss_used) {
        return fail("step spoof was not dropped on the third sample");
    }
    printf("step_detect_samples 3\n");
    return 0;
}

static int test_drag(void) {
    spoof_gate gate;
    int i;
    int detected = -1;
    spoof_gate_init(&gate);
    for (i = 0; i < 600; i++) {
        double t = i * 0.1;
        spoof_vec3 gnss = {0.4 * t, 0, 0};
        spoof_vec3 vio = {0, 0, 0};
        spoof_decision d = spoof_gate_update(&gate, gnss, vio, 2.0);
        if (d.dropped_now) {
            detected = i;
            break;
        }
    }
    printf("drag_detect_s %.1f\n", detected < 0 ? -1.0 : detected * 0.1);
    if (detected < 0 || detected * 0.1 > 30.0) {
        return fail("drag spoof was not detected within 30s");
    }
    return 0;
}

static int test_false_alarm(void) {
    spoof_gate gate;
    uint32_t state = 0xA2E05F01u;
    int i;
    int alarms = 0;
    spoof_gate_init(&gate);
    /* One hour at 10 Hz, residual noise matched to the gate sigma. */
    for (i = 0; i < 36000; i++) {
        spoof_vec3 gnss = {1.5 * normal(&state), 1.5 * normal(&state), 1.5 * normal(&state)};
        spoof_vec3 vio = {0, 0, 0};
        spoof_decision d = spoof_gate_update(&gate, gnss, vio, 2.0);
        if (d.dropped_now) {
            alarms++;
            gate.gnss_used = 1;
            gate.reject_run = 0;
        }
    }
    printf("false_alarms_per_hour %d\n", alarms);
    if (alarms > 1) {
        return fail("false alarm rate above 1 per hour");
    }
    return 0;
}

static int test_recover(void) {
    spoof_gate gate;
    int i;
    spoof_decision d = {0, 0, 0, 0};
    spoof_gate_init(&gate);
    for (i = 0; i < 3; i++) {
        spoof_vec3 gnss = {40, 0, 0};
        spoof_vec3 vio = {0, 0, 0};
        spoof_gate_update(&gate, gnss, vio, 2.0);
    }
    for (i = 0; i < 50; i++) {
        spoof_vec3 both = {0, 0, 0};
        d = spoof_gate_update(&gate, both, both, 2.0);
    }
    if (!d.recovered_now || !d.gnss_used) {
        return fail("gnss did not recover after agreement");
    }
    printf("recover_samples 50\n");
    return 0;
}

int main(void) {
    if (test_step() || test_drag() || test_false_alarm() || test_recover()) {
        return 1;
    }
    printf("spoof tests passed\n");
    return 0;
}
