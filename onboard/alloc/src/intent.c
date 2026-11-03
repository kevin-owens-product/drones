#include "intent.h"

#include <math.h>

int intent_cells(double xmin, double ymin, double xmax, double ymax, double cell_m, cbba_task *tasks, int cap) {
    int count = 0;
    double x;
    double y;
    if (cell_m <= 0 || xmax <= xmin || ymax <= ymin || cap <= 0) {
        return 0;
    }
    for (y = ymin + cell_m * 0.5; y < ymax && count < cap; y += cell_m) {
        for (x = xmin + cell_m * 0.5; x < xmax && count < cap; x += cell_m) {
            tasks[count].id = count;
            tasks[count].x = x;
            tasks[count].y = y;
            tasks[count].reward = 100;
            count++;
        }
    }
    return count;
}

static double travel(double x0, double y0, double x1, double y1) {
    double dx = x1 - x0;
    double dy = y1 - y0;
    return sqrt(dx * dx + dy * dy);
}

double intent_coverage(const cbba_agent *agents, int n_agents, const cbba_task *tasks, int n_tasks, const cbba_plan *plan, double speed_mps, double t_s, double radius_m) {
    int covered[CBBA_MAX_TASKS];
    int a;
    int t;
    int hits = 0;
    if (speed_mps <= 0 || n_tasks <= 0) {
        return 0;
    }
    for (t = 0; t < n_tasks && t < CBBA_MAX_TASKS; t++) {
        covered[t] = 0;
    }
    for (a = 0; a < n_agents && a < CBBA_MAX_AGENTS; a++) {
        double x = agents[a].x;
        double y = agents[a].y;
        double left = t_s;
        int k;
        if (!agents[a].alive) {
            continue;
        }
        for (k = 0; k < plan->bundle_n[a] && left > 0; k++) {
            int id = plan->bundle[a][k];
            double need;
            if (id < 0 || id >= n_tasks) {
                continue;
            }
            need = travel(x, y, tasks[id].x, tasks[id].y) / speed_mps;
            if (need <= left + radius_m / speed_mps) {
                covered[id] = 1;
            }
            if (need > left) {
                break;
            }
            left -= need;
            x = tasks[id].x;
            y = tasks[id].y;
        }
    }
    for (t = 0; t < n_tasks && t < CBBA_MAX_TASKS; t++) {
        hits += covered[t];
    }
    return (double)hits / (double)n_tasks;
}

double intent_actions_per_vehicle_per_minute(int vehicles, double minutes) {
    if (vehicles <= 0 || minutes <= 0) {
        return 0;
    }
    return 1.0 / (double)vehicles / minutes;
}
