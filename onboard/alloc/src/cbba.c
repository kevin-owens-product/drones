#include "cbba.h"

#include <math.h>
#include <string.h>

#define EPS 1e-9

/* One vehicle's private view. Nothing here is shared with another agent
 * except through a message copy in cbba_run. Winners are agent indexes. */
typedef struct {
    double y[CBBA_MAX_TASKS];  /* winning bid this agent believes in */
    int z[CBBA_MAX_TASKS];     /* winner this agent believes in */
    double s[CBBA_MAX_AGENTS]; /* last time this agent heard (directly or not) from each peer */
    int b[CBBA_BUNDLE];        /* bundle, in the order tasks were added */
    int bn;
    int p[CBBA_BUNDLE];        /* path, in visit order */
    int pn;
} agent_state;

static unsigned lcg(unsigned *state) {
    *state = *state * 1664525u + 1013904223u;
    return *state;
}

static double uniform(unsigned *state) {
    return (double)(lcg(state) >> 8) / 16777216.0;
}

static double path_score(const cbba_agent *agent, const cbba_task *tasks, const int *path, int n,
                         const cbba_net *net) {
    double x = agent->x;
    double y = agent->y;
    double t = 0;
    double total = 0;
    int k;
    for (k = 0; k < n; k++) {
        const cbba_task *task = &tasks[path[k]];
        double dx = task->x - x;
        double dy = task->y - y;
        t += sqrt(dx * dx + dy * dy) / net->speed_mps;
        total += task->reward * pow(net->discount, t);
        x = task->x;
        y = task->y;
    }
    return total;
}

/* Best marginal gain of inserting task j anywhere in the path. */
static double marginal(const cbba_agent *agent, const cbba_task *tasks, const agent_state *st, int j,
                       const cbba_net *net, int *best_pos) {
    int trial[CBBA_BUNDLE];
    double base = path_score(agent, tasks, st->p, st->pn, net);
    double best = -1e300;
    int pos;
    for (pos = 0; pos <= st->pn; pos++) {
        int k;
        int w = 0;
        double gain;
        for (k = 0; k < st->pn + 1; k++) {
            if (k == pos) {
                trial[w++] = j;
            }
            if (k < st->pn) {
                trial[w++] = st->p[k];
            }
        }
        gain = path_score(agent, tasks, trial, st->pn + 1, net) - base;
        if (gain > best) {
            best = gain;
            *best_pos = pos;
        }
    }
    return best;
}

/* Higher bid wins; an exact tie goes to the lower agent index. */
static int beats(double bid, int bidder, double held, int holder) {
    if (holder == CBBA_NONE) {
        return bid > EPS;
    }
    if (bid > held + EPS) {
        return 1;
    }
    return fabs(bid - held) <= EPS && bidder < holder;
}

static int in_bundle(const agent_state *st, int j) {
    int k;
    for (k = 0; k < st->bn; k++) {
        if (st->b[k] == j) {
            return 1;
        }
    }
    return 0;
}

static int build_bundle(int i, const cbba_agent *agents, const cbba_task *tasks, int n_tasks,
                        const cbba_net *net, agent_state *st) {
    int changed = 0;
    while (st->bn < CBBA_BUNDLE) {
        int best_j = -1;
        int best_pos = 0;
        double best_c = 0;
        int j;
        for (j = 0; j < n_tasks; j++) {
            int pos = 0;
            double c;
            if (in_bundle(st, j)) {
                continue;
            }
            c = marginal(&agents[i], tasks, st, j, net, &pos);
            /* Path insertion can make a later bid larger than an earlier one,
             * which breaks diminishing marginal gains and with it CBBA's
             * convergence proof. Cap each bid at the previous one (bid warping,
             * Johnson, Choi, How 2011). */
            if (st->bn > 0 && c > st->y[st->b[st->bn - 1]]) {
                c = st->y[st->b[st->bn - 1]];
            }
            if (c > best_c + EPS && beats(c, i, st->y[j], st->z[j])) {
                best_c = c;
                best_j = j;
                best_pos = pos;
            }
        }
        if (best_j < 0) {
            break;
        }
        st->b[st->bn++] = best_j;
        memmove(&st->p[best_pos + 1], &st->p[best_pos], (size_t)(st->pn - best_pos) * sizeof(int));
        st->p[best_pos] = best_j;
        st->pn++;
        st->y[best_j] = best_c;
        st->z[best_j] = i;
        changed = 1;
    }
    return changed;
}

static void set(agent_state *st, int j, double y, int z, int *changed) {
    if (st->z[j] != z || fabs(st->y[j] - y) > EPS) {
        *changed = 1;
    }
    st->y[j] = y;
    st->z[j] = z;
}

/* Table 1 of Choi, Brunet, How (2009). Receiver i, sender k, task j. */
static void resolve(int i, int k, int j, agent_state *me, const agent_state *msg, int *changed) {
    int zk = msg->z[j];
    int zi = me->z[j];
    double yk = msg->y[j];
    double yi = me->y[j];
#define UPDATE() set(me, j, yk, zk, changed)
#define RESET() set(me, j, 0, CBBA_NONE, changed)
#define NEWER(m) (msg->s[(m)] > me->s[(m)] + EPS)
    if (zk == k) {
        if (zi == i) {
            if (beats(yk, zk, yi, zi)) UPDATE();
        } else if (zi == k) {
            UPDATE();
        } else if (zi != CBBA_NONE) {
            if (NEWER(zi) || beats(yk, zk, yi, zi)) UPDATE();
        } else {
            UPDATE();
        }
    } else if (zk == i) {
        if (zi == i) {
            /* leave */
        } else if (zi == k) {
            RESET();
        } else if (zi != CBBA_NONE) {
            if (NEWER(zi)) RESET();
        }
    } else if (zk != CBBA_NONE) {
        int m = zk;
        if (zi == i) {
            if (NEWER(m) && beats(yk, zk, yi, zi)) UPDATE();
        } else if (zi == k) {
            if (NEWER(m)) UPDATE(); else RESET();
        } else if (zi == m) {
            if (NEWER(m)) UPDATE();
        } else if (zi != CBBA_NONE) {
            int n = zi;
            if (NEWER(m) && NEWER(n)) {
                UPDATE();
            } else if (NEWER(m) && beats(yk, zk, yi, zi)) {
                UPDATE();
            } else if (NEWER(n) && me->s[m] > msg->s[m] + EPS) {
                RESET();
            }
        } else {
            if (NEWER(m)) UPDATE();
        }
    } else {
        if (zi == k) {
            UPDATE();
        } else if (zi != i && zi != CBBA_NONE) {
            if (NEWER(zi)) UPDATE();
        }
    }
#undef UPDATE
#undef RESET
#undef NEWER
}

/* Drop the first bundle task this agent no longer wins, and everything added
 * after it: those marginal bids assumed a path that has now changed. */
static void release_outbid(int i, agent_state *st, int *changed) {
    int n;
    int cut = st->bn;
    int k;
    int w = 0;
    for (n = 0; n < st->bn; n++) {
        if (st->z[st->b[n]] != i) {
            cut = n;
            break;
        }
    }
    if (cut == st->bn) {
        return;
    }
    for (n = cut + 1; n < st->bn; n++) {
        if (st->z[st->b[n]] == i) {
            st->y[st->b[n]] = 0;
            st->z[st->b[n]] = CBBA_NONE;
        }
    }
    for (k = 0; k < st->pn; k++) {
        int keep = 0;
        for (n = 0; n < cut; n++) {
            if (st->b[n] == st->p[k]) {
                keep = 1;
            }
        }
        if (keep) {
            st->p[w++] = st->p[k];
        }
    }
    st->pn = w;
    st->bn = cut;
    *changed = 1;
}

static int tables_agree(const agent_state *states, const cbba_agent *agents, int n_agents, int n_tasks) {
    int first = -1;
    int a;
    int j;
    for (a = 0; a < n_agents; a++) {
        if (!agents[a].alive) {
            continue;
        }
        if (first < 0) {
            first = a;
            continue;
        }
        for (j = 0; j < n_tasks; j++) {
            if (states[a].z[j] != states[first].z[j] || fabs(states[a].y[j] - states[first].y[j]) > EPS) {
                return 0;
            }
        }
    }
    return 1;
}

void cbba_net_full(cbba_net *net, int n_agents) {
    int a;
    int b;
    memset(net, 0, sizeof(*net));
    for (a = 0; a < n_agents && a < CBBA_MAX_AGENTS; a++) {
        for (b = 0; b < n_agents && b < CBBA_MAX_AGENTS; b++) {
            net->link[a][b] = a != b;
        }
    }
    net->drop = 0;
    net->seed = 0xA2E0CBBAu;
    net->speed_mps = 10.0;
    net->discount = 0.98;
    net->max_rounds = 200;
}

void cbba_net_line(cbba_net *net, int n_agents) {
    int a;
    cbba_net_full(net, n_agents);
    memset(net->link, 0, sizeof(net->link));
    for (a = 0; a + 1 < n_agents && a + 1 < CBBA_MAX_AGENTS; a++) {
        net->link[a][a + 1] = 1;
        net->link[a + 1][a] = 1;
    }
}

int cbba_run(const cbba_agent *agents, int n_agents, const cbba_task *tasks, int n_tasks,
             const cbba_net *net, cbba_plan *plan, cbba_stats *stats) {
    agent_state states[CBBA_MAX_AGENTS];
    agent_state inbox[CBBA_MAX_AGENTS];
    unsigned rng = net->seed;
    int claims[CBBA_MAX_TASKS];
    int first_alive = -1;
    int round;
    int a;
    int j;
    int k;
    if (n_agents > CBBA_MAX_AGENTS) {
        n_agents = CBBA_MAX_AGENTS;
    }
    if (n_tasks > CBBA_MAX_TASKS) {
        n_tasks = CBBA_MAX_TASKS;
    }
    memset(stats, 0, sizeof(*stats));
    memset(plan, 0, sizeof(*plan));
    for (a = 0; a < n_agents; a++) {
        memset(&states[a], 0, sizeof(states[a]));
        for (j = 0; j < CBBA_MAX_TASKS; j++) {
            states[a].z[j] = CBBA_NONE;
        }
        if (agents[a].alive && first_alive < 0) {
            first_alive = a;
        }
    }
    for (j = 0; j < CBBA_MAX_TASKS; j++) {
        plan->winner[j] = CBBA_NONE;
        plan->bid[j] = 0;
    }
    if (first_alive < 0) {
        stats->converged = 1;
        return 0;
    }
    for (round = 1; round <= net->max_rounds; round++) {
        int changed = 0;
        for (a = 0; a < n_agents; a++) {
            if (agents[a].alive) {
                changed |= build_bundle(a, agents, tasks, n_tasks, net, &states[a]);
            }
        }
        memcpy(inbox, states, sizeof(inbox));
        for (a = 0; a < n_agents; a++) {
            int heard[CBBA_MAX_AGENTS];
            if (!agents[a].alive) {
                continue;
            }
            for (k = 0; k < n_agents; k++) {
                heard[k] = 0;
                if (k == a || !agents[k].alive || !net->link[a][k]) {
                    continue;
                }
                if (net->drop > 0 && uniform(&rng) < net->drop) {
                    stats->dropped++;
                    continue;
                }
                stats->messages++;
                heard[k] = 1;
                for (j = 0; j < n_tasks; j++) {
                    resolve(a, k, j, &states[a], &inbox[k], &changed);
                }
            }
            for (k = 0; k < n_agents; k++) {
                int m;
                if (!heard[k]) {
                    continue;
                }
                states[a].s[k] = round;
                for (m = 0; m < n_agents; m++) {
                    if (m != a && inbox[k].s[m] > states[a].s[m]) {
                        states[a].s[m] = inbox[k].s[m];
                    }
                }
            }
            release_outbid(a, &states[a], &changed);
        }
        stats->rounds = round;
        if (!changed && tables_agree(states, agents, n_agents, n_tasks)) {
            stats->converged = 1;
            break;
        }
    }
    for (j = 0; j < n_tasks; j++) {
        int w = states[first_alive].z[j];
        plan->winner[j] = w == CBBA_NONE ? CBBA_NONE : agents[w].id;
        plan->bid[j] = states[first_alive].y[j];
        claims[j] = 0;
    }
    for (a = 0; a < n_agents; a++) {
        if (!agents[a].alive) {
            continue;
        }
        plan->bundle_n[a] = states[a].pn;
        for (k = 0; k < states[a].pn; k++) {
            plan->bundle[a][k] = states[a].p[k];
            claims[states[a].p[k]]++;
        }
        stats->score += path_score(&agents[a], tasks, states[a].p, states[a].pn, net);
    }
    for (j = 0; j < n_tasks; j++) {
        if (claims[j] > 1) {
            stats->conflicts++;
        }
    }
    return stats->converged ? 0 : -1;
}

void cbba_assign(const cbba_agent *agents, int n_agents, const cbba_task *tasks, int n_tasks, cbba_plan *plan) {
    cbba_net net;
    cbba_stats stats;
    cbba_net_full(&net, n_agents);
    (void)cbba_run(agents, n_agents, tasks, n_tasks, &net, plan, &stats);
}

int cbba_count(const cbba_plan *plan, int agent_index) {
    if (agent_index < 0 || agent_index >= CBBA_MAX_AGENTS) {
        return 0;
    }
    return plan->bundle_n[agent_index];
}
