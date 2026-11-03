#include "spoof.h"

void spoof_gate_init(spoof_gate *gate) {
    gate->gnss_used = 1;
    gate->reject_run = 0;
    gate->agree_run = 0;
    gate->detections = 0;
    gate->false_checks = 0;
    /* Chi-square, 3 degrees of freedom, 99%. */
    gate->gate = 11.345;
    gate->reject_need = 3;
    gate->recover_need = 50;
    gate->last_d2 = 0;
}

spoof_decision spoof_gate_update(spoof_gate *gate, spoof_vec3 gnss, spoof_vec3 vio, double sigma_m) {
    spoof_decision out;
    double rn = gnss.n - vio.n;
    double re = gnss.e - vio.e;
    double rd = gnss.d - vio.d;
    double var = sigma_m * sigma_m;
    out.dropped_now = 0;
    out.recovered_now = 0;
    if (var < 1e-12) {
        var = 1e-12;
    }
    gate->last_d2 = (rn * rn + re * re + rd * rd) / var;
    out.d2 = gate->last_d2;
    if (gate->last_d2 > gate->gate) {
        gate->reject_run++;
        gate->agree_run = 0;
        if (gate->gnss_used && gate->reject_run >= gate->reject_need) {
            gate->gnss_used = 0;
            gate->detections++;
            out.dropped_now = 1;
        }
    } else {
        gate->agree_run++;
        gate->reject_run = 0;
        if (!gate->gnss_used && gate->agree_run >= gate->recover_need) {
            gate->gnss_used = 1;
            out.recovered_now = 1;
        }
        if (gate->gnss_used) {
            gate->false_checks++;
        }
    }
    out.gnss_used = gate->gnss_used;
    return out;
}
