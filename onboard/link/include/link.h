/* Range path loss and a circular jammer. Success is a seeded Bernoulli trial. */
#ifndef A2E_LINK_H
#define A2E_LINK_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    double x;
    double y;
    double radius_m;
    double extra_loss_db;
} link_jammer;

typedef struct {
    unsigned rng;
} link_rng;

double link_success_prob(double distance_m, double jammer_loss_db);
int link_deliver(link_rng *rng, double distance_m, const link_jammer *jammer, double sx, double sy);
double link_jammer_loss(const link_jammer *jammer, double x, double y);

#ifdef __cplusplus
}
#endif

#endif
