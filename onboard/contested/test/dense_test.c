/* Dense crossing. Eight vehicles start on a ring and fly to the opposite
 * side, so every path crosses near the center. With sep_step on, count the
 * minimum pair distance, the losses of separation (a pair entering the
 * minimum), and geofence breaches (a vehicle leaving the fence box). */
#include "separate.h"

#include <math.h>
#include <stdio.h>

enum { N = 8 };

static const double RING_M = 150.0;
static const double SPEED = 5.0;
static const double DT = 0.05;
static const double SEP_RADIUS_M = 6.0;
static const double MIN_SEP_M = 4.0; /* matches scenarios/separation.yaml */
static const double FENCE_M = 170.0; /* square fence, half width */

typedef struct {
    double min_sep;
    int los_events;
    int breaches;
    int arrived;
} dense_result;

static dense_result run(int guided) {
    sep_body b[N];
    double gx[N];
    double gy[N];
    int inside[N][N] = {{0}};
    int outside[N] = {0};
    dense_result r = {1e300, 0, 0, 0};
    int i;
    int j;
    int step;
    for (i = 0; i < N; i++) {
        /* A small angle offset per vehicle so the crossing is not perfectly symmetric. */
        double a = 2.0 * 3.14159265358979 * i / N + 0.01 * i;
        b[i].x = RING_M * cos(a);
        b[i].y = RING_M * sin(a);
        gx[i] = -b[i].x;
        gy[i] = -b[i].y;
        b[i].vx = 0;
        b[i].vy = 0;
    }
    for (step = 0; step < 2400; step++) {
        for (i = 0; i < N; i++) {
            /* Steer toward the goal with a first-order lag so separation pushes persist. */
            double dx = gx[i] - b[i].x;
            double dy = gy[i] - b[i].y;
            double d = sqrt(dx * dx + dy * dy);
            double s = d > 1e-6 ? (d < SPEED ? d : SPEED) / d : 0;
            b[i].vx += (dx * s - b[i].vx) * 0.5 * DT;
            b[i].vy += (dy * s - b[i].vy) * 0.5 * DT;
        }
        if (guided) {
            sep_step(b, N, SEP_RADIUS_M, DT);
        } else {
            for (i = 0; i < N; i++) {
                b[i].x += b[i].vx * DT;
                b[i].y += b[i].vy * DT;
            }
        }
        for (i = 0; i < N; i++) {
            int out = fabs(b[i].x) > FENCE_M || fabs(b[i].y) > FENCE_M;
            r.breaches += out && !outside[i];
            outside[i] = out;
            for (j = i + 1; j < N; j++) {
                double d = hypot(b[i].x - b[j].x, b[i].y - b[j].y);
                int close = d < MIN_SEP_M;
                r.los_events += close && !inside[i][j];
                inside[i][j] = close;
                if (d < r.min_sep) {
                    r.min_sep = d;
                }
            }
        }
    }
    for (i = 0; i < N; i++) {
        r.arrived += hypot(b[i].x - gx[i], b[i].y - gy[i]) < 5.0;
    }
    return r;
}

int main(void) {
    dense_result g = run(1);
    dense_result u = run(0);
    printf("dense_min_sep_m %.2f dense_los_events %d geofence_breaches %d dense_arrived %d/%d\n", g.min_sep,
           g.los_events, g.breaches, g.arrived, N);
    printf("dense_unguided_min_sep_m %.2f dense_unguided_los_events %d\n", u.min_sep, u.los_events);
    if (g.los_events != 0 || g.min_sep < MIN_SEP_M) {
        fprintf(stderr, "FAIL guided dense run lost separation\n");
        return 1;
    }
    if (g.breaches != 0) {
        fprintf(stderr, "FAIL guided dense run left the geofence\n");
        return 1;
    }
    if (u.los_events == 0) {
        fprintf(stderr, "FAIL unguided run should lose separation, scenario is not dense\n");
        return 1;
    }
    printf("dense tests passed\n");
    return 0;
}
