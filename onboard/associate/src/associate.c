#include "associate.h"

void assoc_init(assoc *a) {
    a->count = 0;
    a->next_id = 1;
}

static float iou(const assoc_track *t, const det_box *d) {
    float x1 = t->x > d->x ? t->x : d->x;
    float y1 = t->y > d->y ? t->y : d->y;
    float x2 = (t->x + t->w) < (d->x + d->w) ? (t->x + t->w) : (d->x + d->w);
    float y2 = (t->y + t->h) < (d->y + d->h) ? (t->y + t->h) : (d->y + d->h);
    float iw = x2 - x1;
    float ih = y2 - y1;
    float inter;
    float uni;
    if (iw <= 0.f || ih <= 0.f || t->w <= 0.f || t->h <= 0.f || d->w <= 0.f || d->h <= 0.f) {
        return 0.f;
    }
    inter = iw * ih;
    uni = t->w * t->h + d->w * d->h - inter;
    if (uni <= 0.f) {
        return 0.f;
    }
    return inter / uni;
}

static void match_band(assoc *a, const det_box *dets, int n, int *det_used, int *trk_used, float lo, float hi) {
    int i;
    for (i = 0; i < n; i++) {
        int t;
        int best = -1;
        float best_iou = 0.3f;
        if (det_used[i] || dets[i].score < lo || dets[i].score >= hi) {
            continue;
        }
        for (t = 0; t < a->count; t++) {
            float v;
            if (trk_used[t]) {
                continue;
            }
            v = iou(&a->tracks[t], &dets[i]);
            if (v >= best_iou) {
                best_iou = v;
                best = t;
            }
        }
        if (best < 0) {
            continue;
        }
        det_used[i] = 1;
        trk_used[best] = 1;
        a->tracks[best].x = dets[i].x;
        a->tracks[best].y = dets[i].y;
        a->tracks[best].w = dets[i].w;
        a->tracks[best].h = dets[i].h;
        a->tracks[best].misses = 0;
    }
}

void assoc_step(assoc *a, const det_box *dets, int n) {
    int det_used[32];
    int trk_used[ASSOC_CAP];
    int i;
    int write;
    if (n > 32) {
        n = 32;
    }
    if (n < 0) {
        n = 0;
    }
    for (i = 0; i < n; i++) {
        det_used[i] = 0;
    }
    for (i = 0; i < a->count; i++) {
        trk_used[i] = 0;
    }
    match_band(a, dets, n, det_used, trk_used, 0.5f, 1.01f);
    match_band(a, dets, n, det_used, trk_used, 0.1f, 0.5f);
    for (i = 0; i < a->count; i++) {
        if (!trk_used[i]) {
            a->tracks[i].misses += 1;
        }
    }
    write = 0;
    for (i = 0; i < a->count; i++) {
        if (a->tracks[i].misses >= 8) {
            continue;
        }
        a->tracks[write] = a->tracks[i];
        write += 1;
    }
    a->count = write;
    for (i = 0; i < n; i++) {
        if (det_used[i] || dets[i].score < 0.5f || a->count >= ASSOC_CAP) {
            continue;
        }
        a->tracks[a->count].id = a->next_id++;
        a->tracks[a->count].misses = 0;
        a->tracks[a->count].x = dets[i].x;
        a->tracks[a->count].y = dets[i].y;
        a->tracks[a->count].w = dets[i].w;
        a->tracks[a->count].h = dets[i].h;
        a->count += 1;
    }
}

int assoc_find(const assoc *a, int id) {
    int i;
    for (i = 0; i < a->count; i++) {
        if (a->tracks[i].id == id) {
            return i;
        }
    }
    return -1;
}
