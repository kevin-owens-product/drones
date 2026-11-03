/* Consensus-based bundle allocation. Each vehicle bids from its own position.
 * A lost vehicle is removed and the rest rebuild their bundles. */
#ifndef A2E_CBBA_H
#define A2E_CBBA_H

#ifdef __cplusplus
extern "C" {
#endif

enum { CBBA_MAX_AGENTS = 8, CBBA_MAX_TASKS = 16, CBBA_BUNDLE = 4 };

typedef struct {
    int id;
    double x;
    double y;
    int alive;
} cbba_agent;

typedef struct {
    int id;
    double x;
    double y;
    double reward;
} cbba_task;

typedef struct {
    int winner[CBBA_MAX_TASKS];
    double bid[CBBA_MAX_TASKS];
    int bundle[CBBA_MAX_AGENTS][CBBA_BUNDLE];
    int bundle_n[CBBA_MAX_AGENTS];
} cbba_plan;

void cbba_assign(const cbba_agent *agents, int n_agents, const cbba_task *tasks, int n_tasks, cbba_plan *plan);
int cbba_count(const cbba_plan *plan, int agent);

#ifdef __cplusplus
}
#endif

#endif
