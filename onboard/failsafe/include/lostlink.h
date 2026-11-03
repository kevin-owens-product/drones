/* Lost-link behavior per task type. Survey keeps flying its assigned cells,
 * observe holds, transit returns. Land is the last step and stays land.
 * Onboard only: it picks a behavior, the console never commands it. */
#ifndef A2E_LOSTLINK_H
#define A2E_LOSTLINK_H

#ifdef __cplusplus
extern "C" {
#endif

typedef enum { LL_TASK_SURVEY = 0, LL_TASK_OBSERVE, LL_TASK_TRANSIT } ll_task;

typedef enum {
    LL_NOMINAL = 0,     /* link up or inside the grace period: fly the plan */
    LL_CONTINUE_SURVEY, /* link down: keep flying the assigned survey cells */
    LL_HOLD,            /* link down: hold position */
    LL_RETURN,          /* fly home */
    LL_LAND
} ll_action;

typedef struct {
    double grace_s;      /* link down shorter than this changes nothing */
    double survey_max_s; /* a survey continues at most this long without link */
    double hold_max_s;   /* an observe task holds at most this long */
    double return_max_s; /* a return without link lands after this long */
} ll_policy;

typedef struct {
    ll_task task;
    int link_up;
    int survey_left; /* assigned cells not yet visited */
    int energy_ok;   /* 0 once the reserve to fly home is reached */
    double dt_s;
} ll_input;

typedef struct {
    ll_policy policy;
    ll_action action;
    double link_down_s;
    double in_action_s;
} ll_machine;

/* policy may be NULL for the defaults: 2 s grace, 180 s survey, 30 s hold, 300 s return. */
void ll_init(ll_machine *m, const ll_policy *policy);
ll_action ll_step(ll_machine *m, ll_input in);

#ifdef __cplusplus
}
#endif

#endif
