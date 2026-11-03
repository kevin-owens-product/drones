/* GNSS spoof gate. Chi-squared test of the GNSS-versus-VIO residual.
 * Compute budget: a few dozen flops per sample, fine for a Pi 5.
 * On detection the caller drops GNSS from the estimator. No mode change.
 */
#ifndef A2E_SPOOF_H
#define A2E_SPOOF_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    double n;
    double e;
    double d;
} spoof_vec3;

typedef struct {
    int gnss_used;
    int reject_run;
    int agree_run;
    int detections;
    int false_checks;
    double gate;          /* chi-square threshold, 3 dof */
    int reject_need;      /* consecutive failures before drop */
    int recover_need;     /* consecutive agreements before reuse */
    double last_d2;
} spoof_gate;

typedef struct {
    int gnss_used;
    int dropped_now;
    int recovered_now;
    double d2;
} spoof_decision;

void spoof_gate_init(spoof_gate *gate);
/* sigma_m is the 1-sigma of each residual axis, GNSS and VIO combined. */
spoof_decision spoof_gate_update(spoof_gate *gate, spoof_vec3 gnss, spoof_vec3 vio, double sigma_m);

#ifdef __cplusplus
}
#endif

#endif
