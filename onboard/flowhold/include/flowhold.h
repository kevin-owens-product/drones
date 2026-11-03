/* Position hold from a downward optical-flow sensor and a rangefinder.
 * Flow is rad/s. The command is the velocity that cancels it. */
#ifndef A2E_FLOWHOLD_H
#define A2E_FLOWHOLD_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    double vx;
    double vy;
} flow_vel;

flow_vel flow_hold(double flow_x, double flow_y, double range_m);

#ifdef __cplusplus
}
#endif

#endif
