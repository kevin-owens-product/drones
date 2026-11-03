#include "separate.h"

#include <math.h>

void sep_step(sep_body *bodies, int n, double radius_m, double dt_s) {
    int i;
    int j;
    for (i = 0; i < n; i++) {
        for (j = i + 1; j < n; j++) {
            double rx = bodies[j].x - bodies[i].x;
            double ry = bodies[j].y - bodies[i].y;
            double rvx = bodies[j].vx - bodies[i].vx;
            double rvy = bodies[j].vy - bodies[i].vy;
            double dist2 = rx * rx + ry * ry;
            double vv = rvx * rvx + rvy * rvy;
            double tca;
            double cx;
            double cy;
            double closest2;
            double dist;
            double push;
            if (dist2 < 1e-9) {
                dist2 = 1e-9;
            }
            if (vv < 1e-9) {
                continue;
            }
            tca = -(rx * rvx + ry * rvy) / vv;
            if (tca < 0 || tca > 5.0) {
                continue;
            }
            cx = rx + rvx * tca;
            cy = ry + rvy * tca;
            closest2 = cx * cx + cy * cy;
            if (closest2 >= radius_m * radius_m) {
                continue;
            }
            dist = sqrt(dist2);
            push = (radius_m - sqrt(closest2)) / dist;
            bodies[i].vx -= push * rx;
            bodies[i].vy -= push * ry;
            bodies[j].vx += push * rx;
            bodies[j].vy += push * ry;
        }
    }
    for (i = 0; i < n; i++) {
        bodies[i].x += bodies[i].vx * dt_s;
        bodies[i].y += bodies[i].vy * dt_s;
    }
}

double sep_min_distance(const sep_body *bodies, int n) {
    int i;
    int j;
    double best = 1e300;
    for (i = 0; i < n; i++) {
        for (j = i + 1; j < n; j++) {
            double dx = bodies[i].x - bodies[j].x;
            double dy = bodies[i].y - bodies[j].y;
            double d = sqrt(dx * dx + dy * dy);
            if (d < best) {
                best = d;
            }
        }
    }
    return best;
}
