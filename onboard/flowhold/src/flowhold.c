#include "flowhold.h"

flow_vel flow_hold(double flow_x, double flow_y, double range_m) {
    flow_vel out;
    if (range_m < 0.05) {
        range_m = 0.05;
    }
    out.vx = -flow_x * range_m;
    out.vy = -flow_y * range_m;
    return out;
}
