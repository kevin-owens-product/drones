#include "mesh.h"

#include <math.h>

static double dist(const mesh_node *a, const mesh_node *b) {
    double dx = a->x - b->x;
    double dy = a->y - b->y;
    return sqrt(dx * dx + dy * dy);
}

int mesh_route(const mesh_node *nodes, int n, int src, int dst, double range_m, int *hops, int hop_cap) {
    int queue[MESH_MAX];
    int parent[MESH_MAX];
    int seen[MESH_MAX];
    int qh = 0;
    int qt = 0;
    int i;
    if (n > MESH_MAX || src < 0 || dst < 0 || src >= n || dst >= n) {
        return -1;
    }
    if (!nodes[src].alive || !nodes[dst].alive) {
        return -1;
    }
    for (i = 0; i < n; i++) {
        seen[i] = 0;
        parent[i] = -1;
    }
    queue[qt++] = src;
    seen[src] = 1;
    while (qh < qt) {
        int cur = queue[qh++];
        if (cur == dst) {
            break;
        }
        for (i = 0; i < n; i++) {
            if (seen[i] || !nodes[i].alive) {
                continue;
            }
            if (dist(&nodes[cur], &nodes[i]) <= range_m) {
                seen[i] = 1;
                parent[i] = cur;
                queue[qt++] = i;
            }
        }
    }
    if (!seen[dst]) {
        return -1;
    }
    {
        int chain[MESH_MAX];
        int len = 0;
        int cur = dst;
        while (cur >= 0 && len < MESH_MAX) {
            chain[len++] = cur;
            if (cur == src) {
                break;
            }
            cur = parent[cur];
        }
        if (hop_cap < len) {
            return -1;
        }
        for (i = 0; i < len; i++) {
            hops[i] = chain[len - 1 - i];
        }
        return len - 1;
    }
}
