/* Consensus-based bundle algorithm (Choi, Brunet, How, 2009).
 *
 * Every vehicle keeps its own copy of the winning bids, the winners, and a
 * timestamp per peer. Each round it builds a bundle from its own position,
 * then trades tables with the neighbors it can hear and applies the CBBA
 * conflict-resolution rules. When a vehicle is outbid on a bundle task it
 * releases that task and every task it added after it, because those bids
 * were computed on a path that no longer exists.
 *
 * The rounds run in-process here, but each agent only reads its own state and
 * the messages it received, so the same code runs one instance per vehicle. */
#ifndef A2E_CBBA_H
#define A2E_CBBA_H

#ifdef __cplusplus
extern "C" {
#endif

enum { CBBA_MAX_AGENTS = 8, CBBA_MAX_TASKS = 16, CBBA_BUNDLE = 4, CBBA_NONE = -1 };

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

/* The agreed result. bundle[a] is in path (visit) order. */
typedef struct {
    int winner[CBBA_MAX_TASKS];
    double bid[CBBA_MAX_TASKS];
    int bundle[CBBA_MAX_AGENTS][CBBA_BUNDLE];
    int bundle_n[CBBA_MAX_AGENTS];
} cbba_plan;

/* Who can hear whom, and how lossy the link is. */
typedef struct {
    int link[CBBA_MAX_AGENTS][CBBA_MAX_AGENTS];
    double drop; /* probability a message is lost, 0..1 */
    unsigned seed;
    double speed_mps; /* used for the time-discounted score */
    double discount;  /* reward multiplier per second of travel, 0..1 */
    int max_rounds;
} cbba_net;

typedef struct {
    int rounds;     /* rounds until every live agent held the same table */
    int messages;   /* messages delivered */
    int dropped;    /* messages lost */
    int converged;  /* 1 if the tables agreed before max_rounds */
    int conflicts;  /* tasks claimed in two bundles after the run; must be 0 */
    double score;   /* total discounted reward of the agreed plan */
} cbba_stats;

/* A fully connected, lossless network with default scoring. */
void cbba_net_full(cbba_net *net, int n_agents);
/* Agents in a line: each hears only the one before and after it. */
void cbba_net_line(cbba_net *net, int n_agents);

int cbba_run(const cbba_agent *agents, int n_agents, const cbba_task *tasks, int n_tasks,
             const cbba_net *net, cbba_plan *plan, cbba_stats *stats);

/* cbba_run on a full lossless network. */
void cbba_assign(const cbba_agent *agents, int n_agents, const cbba_task *tasks, int n_tasks, cbba_plan *plan);
int cbba_count(const cbba_plan *plan, int agent);

#ifdef __cplusplus
}
#endif

#endif
