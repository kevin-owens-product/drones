/* Runs the four GNSS faults through the chi-squared gate. */
#include "fault.h"
#include "spoof.h"

#include <math.h>
#include <stdio.h>

static int fail(const char *message) {
    fprintf(stderr, "FAIL %s\n", message);
    return 1;
}

static double detect_s(fault_kind kind, double speed_mps, double seconds) {
    fault_inj fault;
    spoof_gate gate;
    int steps = (int)(seconds * 10.0);
    int i;
    fault_init(&fault, kind);
    spoof_gate_init(&gate);
    for (i = 0; i < steps; i++) {
        double t = i * 0.1;
        spoof_vec3 truth = {speed_mps * t, 0, 0};
        spoof_vec3 gnss = fault_apply(&fault, truth, t);
        spoof_decision d = spoof_gate_update(&gate, gnss, truth, 2.0);
        if (d.dropped_now) {
            return t;
        }
    }
    return -1.0;
}

static int test_loss_and_step(void) {
    double loss = detect_s(FAULT_LOSS, 5.0, 30.0);
    double step = detect_s(FAULT_STEP, 5.0, 5.0);
    printf("loss_detect_s %.1f\n", loss);
    printf("step_detect_s %.1f\n", step);
    if (loss < 0 || loss > 5.0) {
        return fail("gnss loss was not detected within 5s");
    }
    if (step < 0 || step > 0.5) {
        return fail("step spoof was not detected within 0.5s");
    }
    return 0;
}

static int test_drag(void) {
    double drag = detect_s(FAULT_DRAG, 0.0, 40.0);
    printf("drag_detect_s %.1f\n", drag);
    if (drag < 0 || drag > 30.0) {
        return fail("drag spoof was not detected within 30s");
    }
    return 0;
}

static int test_multipath(void) {
    fault_inj fault;
    spoof_gate gate;
    int i;
    int alarms = 0;
    fault_init(&fault, FAULT_MULTIPATH);
    spoof_gate_init(&gate);
    for (i = 0; i < 6000; i++) {
        spoof_vec3 truth = {0, 0, 0};
        spoof_vec3 gnss = fault_apply(&fault, truth, i * 0.1);
        spoof_decision d = spoof_gate_update(&gate, gnss, truth, 4.0);
        if (d.dropped_now) {
            alarms++;
        }
    }
    printf("multipath_false_alarms_per_10min %d\n", alarms);
    if (alarms > 1) {
        return fail("multipath noise tripped the gate");
    }
    return 0;
}

static int test_drift_while_denied(void) {
    /* Truth flies north at 5 m/s. VIO carries a 0.05 m/s east bias.
     * GNSS is frozen. Once the gate drops it, the estimate follows VIO. */
    fault_inj fault;
    spoof_gate gate;
    const double vio_bias_mps = 0.05;
    double sum_sq = 0;
    double err_e = 0;
    int i;
    int n = 0;
    fault_init(&fault, FAULT_LOSS);
    spoof_gate_init(&gate);
    for (i = 1; i <= 600; i++) {
        double t = i * 0.1;
        spoof_vec3 truth = {5.0 * t, 0, 0};
        spoof_vec3 vio = {truth.n, vio_bias_mps * t, 0};
        spoof_vec3 gnss = fault_apply(&fault, truth, t);
        spoof_decision d = spoof_gate_update(&gate, gnss, vio, 2.0);
        if (!d.gnss_used) {
            double en = vio.n - truth.n;
            double ee = vio.e - truth.e;
            err_e = ee;
            sum_sq += en * en + ee * ee;
            n++;
        }
    }
    if (n < 500) {
        return fail("gnss loss did not stay denied");
    }
    printf("drift_m_per_min %.2f\n", err_e);
    printf("rmse_m %.2f\n", sqrt(sum_sq / n));
    if (fabs(err_e - 3.0) > 0.05) {
        return fail("east drift after one denied minute is not 3 m");
    }
    return 0;
}

int main(void) {
    if (test_loss_and_step() || test_drag() || test_multipath() || test_drift_while_denied()) {
        return 1;
    }
    printf("fault scenarios passed\n");
    return 0;
}
