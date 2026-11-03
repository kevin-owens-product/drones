/* Multi-hop relay. A packet reaches the destination if some chain of live
 * vehicles stays inside the radio range. */
#ifndef A2E_MESH_H
#define A2E_MESH_H

#ifdef __cplusplus
extern "C" {
#endif

enum { MESH_MAX = 16 };

typedef struct {
    double x;
    double y;
    int alive;
} mesh_node;

/* Returns the hop count, or -1 if there is no path. hops[0] is src. */
int mesh_route(const mesh_node *nodes, int n, int src, int dst, double range_m, int *hops, int hop_cap);

#ifdef __cplusplus
}
#endif

#endif
