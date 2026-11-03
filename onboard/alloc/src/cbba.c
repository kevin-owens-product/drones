#include "cbba.h"

#include <math.h>
#include <string.h>

static double score(const cbba_agent *agent, const cbba_task *task) {
    double dx = agent->x - task->x;
    double dy = agent->y - task->y;
    return task->reward - sqrt(dx * dx + dy * dy);
}

void cbba_assign(const cbba_agent *agents, int n_agents, const cbba_task *tasks, int n_tasks, cbba_plan *plan) {
    int t;
    int a;
    memset(plan, 0, sizeof(*plan));
    for (t = 0; t < n_tasks && t < CBBA_MAX_TASKS; t++) {
        plan->winner[t] = -1;
        plan->bid[t] = -1e300;
    }
    for (a = 0; a < n_agents && a < CBBA_MAX_AGENTS; a++) {
        int pick;
        if (!agents[a].alive) {
            continue;
        }
        for (pick = 0; pick < CBBA_BUNDLE; pick++) {
            int best = -1;
            double best_score = -1e300;
            for (t = 0; t < n_tasks && t < CBBA_MAX_TASKS; t++) {
                double s;
                int already = 0;
                int k;
                for (k = 0; k < plan->bundle_n[a]; k++) {
                    if (plan->bundle[a][k] == t) {
                        already = 1;
                    }
                }
                if (already) {
                    continue;
                }
                s = score(&agents[a], &tasks[t]);
                if (s > best_score) {
                    best_score = s;
                    best = t;
                }
            }
            if (best < 0 || best_score <= plan->bid[best]) {
                break;
            }
            plan->bundle[a][plan->bundle_n[a]++] = best;
            plan->winner[best] = agents[a].id;
            plan->bid[best] = best_score;
        }
    }
}

int cbba_count(const cbba_plan *plan, int agent_index) {
    if (agent_index < 0 || agent_index >= CBBA_MAX_AGENTS) {
        return 0;
    }
    return plan->bundle_n[agent_index];
}
