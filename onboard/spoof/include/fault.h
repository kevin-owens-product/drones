/* GNSS fault injector. The four cases are total loss, drag, step, and multipath. */
#ifndef A2E_FAULT_H
#define A2E_FAULT_H

#include "spoof.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    FAULT_NONE = 0,
    FAULT_LOSS,
    FAULT_DRAG,
    FAULT_STEP,
    FAULT_MULTIPATH
} fault_kind;

typedef struct {
    fault_kind kind;
    double drag_mps;
    double step_m;
    double multipath_sigma_m;
    unsigned rng;
    int held;
    spoof_vec3 hold;
} fault_inj;

void fault_init(fault_inj *fault, fault_kind kind);
spoof_vec3 fault_apply(fault_inj *fault, spoof_vec3 truth, double t_s);

#ifdef __cplusplus
}
#endif

#endif
