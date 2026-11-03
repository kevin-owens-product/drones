#include "lostlink.h"

void ll_init(ll_machine *m, const ll_policy *policy) {
    if (policy != 0) {
        m->policy = *policy;
    } else {
        m->policy.grace_s = 2;
        m->policy.survey_max_s = 180;
        m->policy.hold_max_s = 30;
        m->policy.return_max_s = 300;
    }
    m->action = LL_NOMINAL;
    m->link_down_s = 0;
    m->in_action_s = 0;
}

static void enter(ll_machine *m, ll_action next) {
    if (m->action != next) {
        m->action = next;
        m->in_action_s = 0;
    }
}

ll_action ll_step(ll_machine *m, ll_input in) {
    const ll_policy *p = &m->policy;
    if (in.dt_s < 0) {
        in.dt_s = 0;
    }
    m->in_action_s += in.dt_s;
    m->link_down_s = in.link_up ? 0 : m->link_down_s + in.dt_s;
    if (m->action == LL_LAND) {
        return LL_LAND;
    }
    if (!in.energy_ok) {
        enter(m, LL_RETURN);
    } else if (in.link_up || m->link_down_s < p->grace_s) {
        enter(m, LL_NOMINAL);
    } else if (m->action == LL_RETURN) {
        if (m->in_action_s >= p->return_max_s) {
            enter(m, LL_LAND);
        }
    } else if (in.task == LL_TASK_SURVEY && in.survey_left > 0 && m->link_down_s < p->survey_max_s) {
        enter(m, LL_CONTINUE_SURVEY);
    } else if (in.task == LL_TASK_OBSERVE && m->link_down_s < p->grace_s + p->hold_max_s) {
        enter(m, LL_HOLD);
    } else {
        enter(m, LL_RETURN);
    }
    return m->action;
}
