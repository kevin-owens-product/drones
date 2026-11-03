#include "cbba.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>

/* Message exchange rate assumed for the re-plan latency figure. */
#define ROUND_HZ 10.0

static int fail(const char *message) {
    fprintf(stderr, "FAIL %s\n", message);
    return 1;
}

static unsigned lcg(unsigned *state) {
    *state = *state * 1664525u + 1013904223u;
    return *state;
}

static double uniform(unsigned *state, double lo, double hi) {
    return lo + (hi - lo) * (double)(lcg(state) >> 8) / 16777216.0;
}

static int bundle_has(const cbba_plan *plan, int agent, int task) {
    int k;
    for (k = 0; k < plan->bundle_n[agent]; k++) {
        if (plan->bundle[agent][k] == task) {
            return 1;
        }
    }
    return 0;
}

static int test_local_tasks_and_loss(void) {
    cbba_agent agents[3] = {
        {0, 0, 0, 1},
        {1, 100, 0, 1},
        {2, 0, 100, 1},
    };
    cbba_task tasks[4] = {
        {0, 10, 0, 50},
        {1, 90, 10, 50},
        {2, 10, 90, 50},
        {3, 50, 50, 20},
    };
    cbba_net net;
    cbba_plan plan;
    cbba_stats stats;
    int covered = 0;
    int j;
    cbba_net_full(&net, 3);
    cbba_run(agents, 3, tasks, 4, &net, &plan, &stats);
    if (plan.winner[0] != 0 || plan.winner[1] != 1 || plan.winner[2] != 2) {
        return fail("nearest vehicle should win its local task");
    }
    agents[0].alive = 0;
    cbba_run(agents, 3, tasks, 4, &net, &plan, &stats);
    if (plan.winner[0] == 0) {
        return fail("dropped vehicle still owns a task");
    }
    for (j = 0; j < 4; j++) {
        if (plan.winner[j] == 1 || plan.winner[j] == 2) {
            covered++;
        }
    }
    printf("tasks_covered_after_loss %d\n", covered);
    if (covered < 4) {
        return fail("survivors did not pick up the dropped vehicle's work");
    }
    return 0;
}

static void random_world(unsigned *rng, cbba_agent *agents, int n_agents, cbba_task *tasks, int n_tasks) {
    int i;
    for (i = 0; i < n_agents; i++) {
        agents[i].id = i;
        agents[i].x = uniform(rng, 0, 500);
        agents[i].y = uniform(rng, 0, 500);
        agents[i].alive = 1;
    }
    for (i = 0; i < n_tasks; i++) {
        tasks[i].id = i;
        tasks[i].x = uniform(rng, 0, 500);
        tasks[i].y = uniform(rng, 0, 500);
        tasks[i].reward = uniform(rng, 50, 150);
    }
}

/* Over many random worlds, on a line network with lossy links:
 *  - every run converges,
 *  - no task ever sits in two bundles (the bug in the old greedy auction),
 *  - the agreed winner of each task actually carries it,
 *  - the result is close in value to the fully connected run. */
static int test_random_worlds(void) {
    enum { SEEDS = 500, AGENTS = 6, TASKS = 12 };
    unsigned rng = 0xC0FFEEu;
    int seed;
    int conflicts = 0;
    int unconverged = 0;
    int mismatched = 0;
    double worst_ratio = 1.0;
    int orphaned = 0;
    int rounds[SEEDS];
    double drop_sum = 0;
    for (seed = 0; seed < SEEDS; seed++) {
        cbba_agent agents[AGENTS];
        cbba_task tasks[TASKS];
        cbba_net full;
        cbba_net line;
        cbba_plan pf;
        cbba_plan pl;
        cbba_stats sf;
        cbba_stats sl;
        int j;
        random_world(&rng, agents, AGENTS, tasks, TASKS);
        cbba_net_full(&full, AGENTS);
        cbba_net_line(&line, AGENTS);
        line.drop = 0.2;
        line.seed = (unsigned)seed * 2654435761u;
        cbba_run(agents, AGENTS, tasks, TASKS, &full, &pf, &sf);
        cbba_run(agents, AGENTS, tasks, TASKS, &line, &pl, &sl);
        conflicts += sf.conflicts + sl.conflicts;
        unconverged += !sf.converged + !sl.converged;
        if (fabs(sf.score - sl.score) > 1e-6) {
            mismatched++;
        }
        if (sf.score > 0 && sl.score / sf.score < worst_ratio) {
            worst_ratio = sl.score / sf.score;
        }
        for (j = 0; j < TASKS; j++) {
            int w = pl.winner[j];
            if (w != CBBA_NONE && !bundle_has(&pl, w, j)) {
                orphaned++;
            }
        }
        rounds[seed] = sl.rounds;
        drop_sum += (double)sl.dropped / (double)(sl.dropped + sl.messages);
    }
    {
        int i;
        int j;
        for (i = 1; i < SEEDS; i++) {
            int v = rounds[i];
            for (j = i - 1; j >= 0 && rounds[j] > v; j--) {
                rounds[j + 1] = rounds[j];
            }
            rounds[j + 1] = v;
        }
    }
    printf("cbba_random_worlds %d line_drop %.2f\n", SEEDS, drop_sum / SEEDS);
    printf("cbba_conflicts %d\n", conflicts);
    printf("cbba_unconverged %d\n", unconverged);
    printf("cbba_line_vs_full_mismatch %d worst_score_ratio %.3f\n", mismatched, worst_ratio);
    printf("cbba_rounds_p50 %d p95 %d\n", rounds[SEEDS / 2], rounds[SEEDS * 95 / 100]);
    if (conflicts != 0) {
        return fail("a task was held by two vehicles");
    }
    if (unconverged != 0) {
        return fail("a run did not converge");
    }
    if (orphaned != 0) {
        return fail("an agreed winner does not carry its task");
    }
    /* Bid warping keeps convergence but lets message order change which
     * equal-quality plan wins, so a few seeds differ. The plan must stay
     * close in value. */
    if (mismatched > SEEDS / 20 || worst_ratio < 0.9) {
        return fail("lossy line network drifted from the fully connected result");
    }
    return 0;
}

/* A vehicle drops out mid-mission on a lossy line network. Re-plan latency is
 * consensus rounds at ROUND_HZ, the number a radio budget actually cares about. */
static int test_replan_latency(void) {
    enum { SEEDS = 200, AGENTS = 6, TASKS = 12 };
    unsigned rng = 0xBEEFu;
    int seed;
    int worst = 0;
    double sum = 0;
    for (seed = 0; seed < SEEDS; seed++) {
        cbba_agent agents[AGENTS];
        cbba_task tasks[TASKS];
        cbba_net line;
        cbba_plan plan;
        cbba_stats stats;
        random_world(&rng, agents, AGENTS, tasks, TASKS);
        /* Lose an interior vehicle and keep the survivors connected through
         * a relay link, as the mesh layer would. */
        agents[2].alive = 0;
        cbba_net_line(&line, AGENTS);
        line.link[1][3] = 1;
        line.link[3][1] = 1;
        line.drop = 0.2;
        line.seed = (unsigned)seed + 17u;
        cbba_run(agents, AGENTS, tasks, TASKS, &line, &plan, &stats);
        if (!stats.converged || stats.conflicts) {
            return fail("re-plan after loss did not converge cleanly");
        }
        sum += stats.rounds;
        if (stats.rounds > worst) {
            worst = stats.rounds;
        }
    }
    printf("replan_rounds_mean %.1f worst %d\n", sum / SEEDS, worst);
    printf("replan_ms_at_10hz %.0f\n", 1000.0 * (sum / SEEDS) / ROUND_HZ);
    if (worst > 60) {
        return fail("re-plan took more than 60 rounds");
    }
    return 0;
}

int main(void) {
    if (test_local_tasks_and_loss() || test_random_worlds() || test_replan_latency()) {
        return 1;
    }
    printf("cbba tests passed\n");
    return 0;
}
