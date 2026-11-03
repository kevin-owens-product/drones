/* Two-stage box association. High-score boxes match first, then low-score
 * boxes fill the tracks that are still free. There is no detector here. */
#ifndef A2E_ASSOCIATE_H
#define A2E_ASSOCIATE_H

#ifdef __cplusplus
extern "C" {
#endif

enum { ASSOC_CAP = 8 };

typedef struct {
    float x;
    float y;
    float w;
    float h;
    float score;
} det_box;

typedef struct {
    int id;
    int misses;
    float x;
    float y;
    float w;
    float h;
} assoc_track;

typedef struct {
    assoc_track tracks[ASSOC_CAP];
    int count;
    int next_id;
} assoc;

void assoc_init(assoc *a);
void assoc_step(assoc *a, const det_box *dets, int n);
int assoc_find(const assoc *a, int id);

#ifdef __cplusplus
}
#endif

#endif
