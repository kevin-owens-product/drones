/* Fleet under a jammer. CBBA assigns survey cells, each vehicle flies its
 * bundle, and every tick it tries to reach the ground station directly or,
 * with mesh on, through other vehicles. The link outcome feeds either the
 * default failsafe or the per-task lost-link policy. Kinematic only. */
#include "cbba.h"
#include "failsafe.h"
#include "link.h"
#include "lostlink.h"
#include "mesh.h"

#include <math.h>
#include <stdio.h>

enum { N_AGENTS = 6, N_TASKS = 12, SEEDS = 40 };

static const double SPEED = 10.0;
static const double DT = 0.5;
static const double ENDURANCE_S = 1200.0;
static const double REACH_M = 10.0;
static const double MESH_RANGE_M = 700.0;
static double jam_radius_m = 250.0;

typedef struct {
    double x;
    double y;
    int next;   /* index into the bundle */
    int home;   /* back at the station with the bundle done */
    int landed; /* landed in the field */
    fs_machine fs;
    ll_machine ll;
} vehicle;

static double dist(double ax, double ay, double bx, double by) {
    return sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
}

static void fly_to(vehicle *v, double tx, double ty) {
    double d = dist(v->x, v->y, tx, ty);
    double step = SPEED * DT;
    if (d <= step) {
        v->x = tx;
        v->y = ty;
        return;
    }
    v->x += (tx - v->x) / d * step;
    v->y += (ty - v->y) / d * step;
}

static int link_up(link_rng *rng, const vehicle *vs, int i, const link_jammer *jam, int use_mesh) {
    mesh_node nodes[N_AGENTS + 1];
    int hops[N_AGENTS + 1];
    int n;
    int k;
    if (link_deliver(rng, dist(vs[i].x, vs[i].y, 0, 0), jam, vs[i].x, vs[i].y)) {
        return 1;
    }
    if (!use_mesh) {
        return 0;
    }
    /* Node 0 is the station. A relay inside the jammer cannot hear. */
    nodes[0].x = 0;
    nodes[0].y = 0;
    nodes[0].alive = 1;
    for (k = 0; k < N_AGENTS; k++) {
        nodes[k + 1].x = vs[k].x;
        nodes[k + 1].y = vs[k].y;
        nodes[k + 1].alive = !vs[k].landed && (k == i || link_jammer_loss(jam, vs[k].x, vs[k].y) == 0);
    }
    n = mesh_route(nodes, N_AGENTS + 1, i + 1, 0, MESH_RANGE_M, hops, N_AGENTS + 1);
    if (n < 2) {
        return 0;
    }
    for (k = 0; k + 1 < n; k++) {
        const mesh_node *a = &nodes[hops[k]];
        const mesh_node *b = &nodes[hops[k + 1]];
        if (!link_deliver(rng, dist(a->x, a->y, b->x, b->y), jam, a->x, a->y)) {
            return 0;
        }
    }
    return 1;
}

/* Returns sorties completed; *flown gets the sorties attempted, *cells the cells visited. */
static int run(unsigned seed, int use_mesh, int use_policy, int *flown, int *cells) {
    cbba_agent agents[N_AGENTS];
    cbba_task tasks[N_TASKS];
    cbba_plan plan;
    vehicle vs[N_AGENTS];
    link_jammer jam;
    link_rng rng;
    double t;
    int i;
    int done = 0;
    for (i = 0; i < N_AGENTS; i++) {
        agents[i].id = i;
        agents[i].x = 0;
        agents[i].y = -25 + 10 * i;
        agents[i].alive = 1;
        vs[i].x = agents[i].x;
        vs[i].y = agents[i].y;
        vs[i].next = 0;
        vs[i].home = 0;
        vs[i].landed = 0;
        fs_init(&vs[i].fs);
        ll_init(&vs[i].ll, 0);
    }
    for (i = 0; i < N_TASKS; i++) {
        tasks[i].id = i;
        tasks[i].x = 400 + 400 * (i % 4);
        tasks[i].y = -300 + 300 * (i / 4);
        tasks[i].reward = 100;
    }
    cbba_assign(agents, N_AGENTS, tasks, N_TASKS, &plan);
    /* The jammer sits on a different cell each seed. */
    jam.x = tasks[seed % N_TASKS].x + (double)(seed % 7) * 20 - 60;
    jam.y = tasks[seed % N_TASKS].y + (double)(seed % 5) * 20 - 40;
    jam.radius_m = jam_radius_m;
    jam.extra_loss_db = 60;
    rng.rng = 1234567u + seed * 7919u;
    for (t = 0; t < ENDURANCE_S; t += DT) {
        for (i = 0; i < N_AGENTS; i++) {
            vehicle *v = &vs[i];
            int left = plan.bundle_n[i] - v->next;
            int up;
            int go_home;
            int hold = 0;
            if (v->home || v->landed || plan.bundle_n[i] == 0) {
                continue;
            }
            up = link_up(&rng, vs, i, &jam, use_mesh);
            if (use_policy) {
                ll_input in;
                double reserve = dist(v->x, v->y, 0, 0) / SPEED * 1.2 + 30;
                in.task = LL_TASK_SURVEY;
                in.link_up = up;
                in.survey_left = left;
                in.energy_ok = ENDURANCE_S - t > reserve;
                in.dt_s = DT;
                ll_step(&v->ll, in);
                go_home = v->ll.action == LL_RETURN || left == 0;
                hold = v->ll.action == LL_HOLD;
                v->landed = v->ll.action == LL_LAND;
            } else {
                fs_input in;
                in.link_up = up;
                in.operator_return = 0;
                in.operator_land = 0;
                in.track_lost = 0;
                in.dt_s = DT;
                fs_step(&v->fs, in);
                go_home = v->fs.state == FS_RETURN || left == 0;
                hold = v->fs.state == FS_LOITER;
                v->landed = v->fs.state == FS_LAND;
            }
            if (v->landed || hold) {
                continue;
            }
            if (go_home) {
                fly_to(v, 0, 0);
                if (left == 0 && dist(v->x, v->y, 0, 0) < REACH_M) {
                    v->home = 1;
                }
            } else {
                const cbba_task *task = &tasks[plan.bundle[i][v->next]];
                fly_to(v, task->x, task->y);
                if (dist(v->x, v->y, task->x, task->y) < REACH_M) {
                    v->next++;
                }
            }
        }
    }
    *flown = 0;
    *cells = 0;
    for (i = 0; i < N_AGENTS; i++) {
        if (plan.bundle_n[i] > 0) {
            (*flown)++;
            *cells += vs[i].next;
            done += vs[i].home;
        }
    }
    return done;
}

static double sweep(int use_mesh, int use_policy, double *cell_frac) {
    int done = 0;
    int flown = 0;
    int cells = 0;
    unsigned seed;
    for (seed = 0; seed < SEEDS; seed++) {
        int f;
        int c;
        done += run(seed, use_mesh, use_policy, &f, &c);
        flown += f;
        cells += c;
    }
    *cell_frac = (double)cells / (double)(SEEDS * N_TASKS);
    return flown ? (double)done / (double)flown : 0;
}

int main(void) {
    double c_default;
    double c_mesh;
    double c_policy;
    double c_both;
    double s_default = sweep(0, 0, &c_default);
    double s_mesh = sweep(1, 0, &c_mesh);
    double s_policy = sweep(0, 1, &c_policy);
    double s_both = sweep(1, 1, &c_both);
    double c_clear;
    double s_clear;
    jam_radius_m = 0; /* control: same fleet, no jammer, default failsafe */
    s_clear = sweep(0, 0, &c_clear);
    printf("fleet_sorties_no_jammer %.3f fleet_cells_no_jammer %.3f\n", s_clear, c_clear);
    printf("fleet_sorties_default %.3f fleet_cells_default %.3f\n", s_default, c_default);
    printf("fleet_sorties_mesh_only %.3f fleet_cells_mesh_only %.3f\n", s_mesh, c_mesh);
    printf("fleet_sorties_policy_only %.3f fleet_cells_policy_only %.3f\n", s_policy, c_policy);
    printf("fleet_sorties_mesh_policy %.3f fleet_cells_mesh_policy %.3f\n", s_both, c_both);
    if (s_both < s_default) {
        fprintf(stderr, "FAIL mesh and policy completed fewer sorties than the default failsafe\n");
        return 1;
    }
    printf("fleet tests passed\n");
    return 0;
}
