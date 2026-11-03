/* One operator command: search this rectangle. Cells are bid with CBBA. */
#ifndef A2E_INTENT_H
#define A2E_INTENT_H

#include "cbba.h"

#ifdef __cplusplus
extern "C" {
#endif

int intent_cells(double xmin, double ymin, double xmax, double ymax, double cell_m, cbba_task *tasks, int cap);
double intent_coverage(const cbba_agent *agents, int n_agents, const cbba_task *tasks, int n_tasks, const cbba_plan *plan, double speed_mps, double t_s, double radius_m);
double intent_actions_per_vehicle_per_minute(int vehicles, double minutes);

#ifdef __cplusplus
}
#endif

#endif
