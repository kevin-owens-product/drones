#include "track.h"

#include <math.h>

static float ncc(const uint8_t *frame, int x, int y, const uint8_t *templ) {
    float sum_f = 0;
    float sum_t = 0;
    int i;
    int n = TRACK_T * TRACK_T;
    float mean_f;
    float mean_t;
    float num = 0;
    float den_f = 0;
    float den_t = 0;
    if (x < 0 || y < 0 || x + TRACK_T > TRACK_W || y + TRACK_T > TRACK_H) {
        return -1;
    }
    for (i = 0; i < n; i++) {
        int row = i / TRACK_T;
        int col = i % TRACK_T;
        sum_f += (float)frame[(y + row) * TRACK_W + (x + col)];
        sum_t += (float)templ[i];
    }
    mean_f = sum_f / (float)n;
    mean_t = sum_t / (float)n;
    for (i = 0; i < n; i++) {
        int row = i / TRACK_T;
        int col = i % TRACK_T;
        float df = (float)frame[(y + row) * TRACK_W + (x + col)] - mean_f;
        float dt = (float)templ[i] - mean_t;
        num += df * dt;
        den_f += df * df;
        den_t += dt * dt;
    }
    if (den_f < 1e-3f || den_t < 1e-3f) {
        return -1;
    }
    return num / sqrtf(den_f * den_t);
}

void track_init(track_lock *lock, const uint8_t *frame, int x, int y) {
    int row;
    int col;
    lock->x = x;
    lock->y = y;
    lock->misses = 0;
    lock->locked = 1;
    for (row = 0; row < TRACK_T; row++) {
        for (col = 0; col < TRACK_T; col++) {
            lock->templ[row * TRACK_T + col] = frame[(y + row) * TRACK_W + (x + col)];
        }
    }
}

int track_step(track_lock *lock, const uint8_t *frame) {
    int dx;
    int dy;
    float best = -1;
    int bx = lock->x;
    int by = lock->y;
    if (!lock->locked) {
        return 0;
    }
    for (dy = -TRACK_R; dy <= TRACK_R; dy++) {
        for (dx = -TRACK_R; dx <= TRACK_R; dx++) {
            float score = ncc(frame, lock->x + dx, lock->y + dy, lock->templ);
            if (score > best) {
                best = score;
                bx = lock->x + dx;
                by = lock->y + dy;
            }
        }
    }
    if (best < 0.6f) {
        lock->misses++;
        if (lock->misses > 8) {
            lock->locked = 0;
        }
        return 0;
    }
    lock->x = bx;
    lock->y = by;
    lock->misses = 0;
    return 1;
}

track_vel track_servo(float err_x, float err_y, float area, float area_ref) {
    track_vel out;
    out.vy = 0.4f * err_x;
    out.vz = 0.4f * err_y;
    out.vx = 0.05f * (area_ref - area);
    return out;
}
