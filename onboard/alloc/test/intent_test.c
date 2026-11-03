#include "intent.h"

#include <stdio.h>

static int fail(const char *message) {
    fprintf(stderr, "FAIL %s\n", message);
    return 1;
}

static int test_search_polygon(void) {
    cbba_agent one[1] = {{0, 0, 0, 1}};
    cbba_agent two[2] = {{0, 0, 0, 1}, {1, 20, 20, 1}};
    cbba_task tasks[8];
    cbba_plan plan_one;
    cbba_plan plan_two;
    int n;
    double cov_one;
    double cov_two;
    double actions;
    n = intent_cells(0, 0, 20, 20, 10, tasks, 8);
    if (n != 4) {
        return fail("20 m box with 10 m cells should be 4 tasks");
    }
    cbba_assign(one, 1, tasks, n, &plan_one);
    cbba_assign(two, 2, tasks, n, &plan_two);
    cov_one = intent_coverage(one, 1, tasks, n, &plan_one, 5, 2, 1);
    cov_two = intent_coverage(two, 2, tasks, n, &plan_two, 5, 2, 1);
    actions = intent_actions_per_vehicle_per_minute(2, 1);
    printf("cells %d coverage_1 %.2f coverage_2 %.2f actions_per_vehicle_per_min %.2f\n", n, cov_one, cov_two, actions);
    if (cov_two + 1e-9 < cov_one) {
        return fail("two vehicles covered less than one");
    }
    if (cov_two < 0.5) {
        return fail("two vehicles should cover at least half the box in 2 s");
    }
    if (actions < 0.49 || actions > 0.51) {
        return fail("one search command should be 0.5 actions per vehicle per minute");
    }
    printf("intent tests passed\n");
    return 0;
}

int main(void) {
    return test_search_polygon();
}
