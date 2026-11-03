#include "lostlink.h"

#include <stdio.h>

static int fail(const char *message) {
    fprintf(stderr, "FAIL %s\n", message);
    return 1;
}

static ll_input in(ll_task task, int link, int left, int energy, double dt) {
    ll_input x;
    x.task = task;
    x.link_up = link;
    x.survey_left = left;
    x.energy_ok = energy;
    x.dt_s = dt;
    return x;
}

static int test_survey_continues(void) {
    ll_machine m;
    ll_init(&m, 0);
    if (ll_step(&m, in(LL_TASK_SURVEY, 0, 3, 1, 1.9)) != LL_NOMINAL) {
        return fail("survey grace period should stay nominal");
    }
    if (ll_step(&m, in(LL_TASK_SURVEY, 0, 3, 1, 0.2)) != LL_CONTINUE_SURVEY) {
        return fail("survey should continue after grace");
    }
    if (ll_step(&m, in(LL_TASK_SURVEY, 0, 1, 1, 100)) != LL_CONTINUE_SURVEY) {
        return fail("survey should continue while cells remain");
    }
    if (ll_step(&m, in(LL_TASK_SURVEY, 0, 0, 1, 1)) != LL_RETURN) {
        return fail("finished survey should return");
    }
    if (ll_step(&m, in(LL_TASK_SURVEY, 1, 0, 1, 1)) != LL_NOMINAL) {
        return fail("link back should go nominal");
    }
    return 0;
}

static int test_survey_time_cap(void) {
    ll_machine m;
    ll_init(&m, 0);
    ll_step(&m, in(LL_TASK_SURVEY, 0, 5, 1, 3));
    if (ll_step(&m, in(LL_TASK_SURVEY, 0, 5, 1, 176)) != LL_CONTINUE_SURVEY) {
        return fail("survey inside 180 s should continue");
    }
    if (ll_step(&m, in(LL_TASK_SURVEY, 0, 5, 1, 2)) != LL_RETURN) {
        return fail("survey past 180 s should return");
    }
    return 0;
}

static int test_observe_holds_then_returns(void) {
    ll_machine m;
    ll_init(&m, 0);
    if (ll_step(&m, in(LL_TASK_OBSERVE, 0, 0, 1, 2.1)) != LL_HOLD) {
        return fail("observe should hold after grace");
    }
    if (ll_step(&m, in(LL_TASK_OBSERVE, 0, 0, 1, 29)) != LL_HOLD) {
        return fail("observe holds for 30 s");
    }
    if (ll_step(&m, in(LL_TASK_OBSERVE, 0, 0, 1, 1)) != LL_RETURN) {
        return fail("observe should return after hold");
    }
    return 0;
}

static int test_transit_returns_then_lands(void) {
    ll_machine m;
    ll_init(&m, 0);
    if (ll_step(&m, in(LL_TASK_TRANSIT, 0, 0, 1, 2.5)) != LL_RETURN) {
        return fail("transit should return after grace");
    }
    if (ll_step(&m, in(LL_TASK_TRANSIT, 0, 0, 1, 299)) != LL_RETURN) {
        return fail("return holds until 300 s");
    }
    if (ll_step(&m, in(LL_TASK_TRANSIT, 0, 0, 1, 2)) != LL_LAND) {
        return fail("long return should land");
    }
    if (ll_step(&m, in(LL_TASK_TRANSIT, 1, 0, 1, 1)) != LL_LAND) {
        return fail("land should stay land");
    }
    return 0;
}

static int test_energy_overrides_survey(void) {
    ll_machine m;
    ll_init(&m, 0);
    ll_step(&m, in(LL_TASK_SURVEY, 0, 4, 1, 5));
    if (ll_step(&m, in(LL_TASK_SURVEY, 0, 4, 0, 0.5)) != LL_RETURN) {
        return fail("low energy should return even mid survey");
    }
    if (ll_step(&m, in(LL_TASK_SURVEY, 1, 4, 0, 0.5)) != LL_RETURN) {
        return fail("low energy should return even with link");
    }
    return 0;
}

int main(void) {
    if (test_survey_continues() || test_survey_time_cap() || test_observe_holds_then_returns() ||
        test_transit_returns_then_lands() || test_energy_overrides_survey()) {
        return 1;
    }
    printf("lostlink tests passed\n");
    return 0;
}
