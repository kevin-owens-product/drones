/* Reciprocal separation. Vehicles that would pass inside a radius repel. */
#ifndef A2E_SEPARATE_H
#define A2E_SEPARATE_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    double x;
    double y;
    double vx;
    double vy;
} sep_body;

void sep_step(sep_body *bodies, int n, double radius_m, double dt_s);
double sep_min_distance(const sep_body *bodies, int n);

#ifdef __cplusplus
}
#endif

#endif
