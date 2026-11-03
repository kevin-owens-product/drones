#include "cbba.h"

#include <stdio.h>
#include <time.h>

static int fail(const char *message) {
    fprintf(stderr, "FAIL %s\n", message);
    return 1;
}

static int winner_of(const cbba_plan *plan, int task) {
    return plan->winner[task];
}

static int test_assignment_and_replan(void) {
    cbba_agent agents[3] = {
        {0, 0, 0, 1},
        {1, 10, 0, 1},
        {2, 0, 10, 1},
    };
    cbba_task tasks[4] = {
        {0, 1, 0, 50},
        {1, 9, 1, 50},
        {2, 1, 9, 50},
        {3, 5, 5, 20},
    };
    cbba_plan before;
    cbba_plan after;
    struct timespec t0;
    struct timespec t1;
    double us;
    int i;
    int covered;
    cbba_assign(agents, 3, tasks, 4, &before);
    if (winner_of(&before, 0) != 0 || winner_of(&before, 1) != 1 || winner_of(&before, 2) != 2) {
        return fail("nearest vehicle should win its local task");
    }
    agents[0].alive = 0;
    clock_gettime(CLOCK_MONOTONIC, &t0);
    for (i = 0; i < 1000; i++) {
        cbba_assign(agents, 3, tasks, 4, &after);
    }
    clock_gettime(CLOCK_MONOTONIC, &t1);
    us = (double)(t1.tv_sec - t0.tv_sec) * 1e6 + (double)(t1.tv_nsec - t0.tv_nsec) / 1e3;
    us /= 1000.0;
    printf("replan_us %.2f\n", us);
    if (winner_of(&after, 0) == 0) {
        return fail("dropped vehicle still owns a task");
    }
    covered = 0;
    for (i = 0; i < 4; i++) {
        if (after.winner[i] == 1 || after.winner[i] == 2) {
            covered++;
        }
    }
    printf("tasks_covered_after_loss %d\n", covered);
    if (covered < 3) {
        return fail("survivors did not pick up the dropped vehicle's work");
    }
    if (us > 1000.0) {
        return fail("replan slower than 1 ms");
    }
    return 0;
}

int main(void) {
    if (test_assignment_and_replan()) {
        return 1;
    }
    printf("cbba tests passed\n");
    return 0;
}
