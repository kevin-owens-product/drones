#include "track.h"

#include <math.h>
#include <string.h>

/* Accept a match at or above this correlation. */
#define ACCEPT 0.6f
/* Adapt the template only on a strong, unambiguous match. */
#define ADAPT 0.85f
#define ADAPT_RATE 0.15f
/* Prefer candidates near the prediction: score minus this per pixel squared. */
#define DIST_PENALTY 0.004f
/* The designated patch only wins when it clearly beats the adapted one: a
 * parked look-alike matches the original pose better than a turning target. */
#define ANCHOR_WEIGHT 0.85f
/* The match must still look like what the operator designated. Without this
 * the adapted template drifts into the background while the target is half
 * hidden, and then background matches everywhere. */
#define ANCHOR_MIN 0.5f
#define ADAPT_ANCHOR 0.7f

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

static int clampi(int v, int lo, int hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

static float sample(const uint8_t *frame, float fx, float fy) {
    int x0;
    int y0;
    float ax;
    float ay;
    float a;
    float b;
    float c;
    float d;
    if (fx < 0) fx = 0;
    if (fy < 0) fy = 0;
    if (fx > TRACK_W - 1.001f) fx = TRACK_W - 1.001f;
    if (fy > TRACK_H - 1.001f) fy = TRACK_H - 1.001f;
    x0 = (int)fx;
    y0 = (int)fy;
    ax = fx - (float)x0;
    ay = fy - (float)y0;
    a = frame[y0 * TRACK_W + x0];
    b = frame[y0 * TRACK_W + x0 + 1];
    c = frame[(y0 + 1) * TRACK_W + x0];
    d = frame[(y0 + 1) * TRACK_W + x0 + 1];
    return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
}

/* Rotate the image around the box centre and cut TRACK_T x TRACK_T. */
static void build_bank(track_lock *lock, const uint8_t *frame, int x, int y) {
    float cxf = (float)x + (TRACK_T - 1) * 0.5f;
    float cyf = (float)y + (TRACK_T - 1) * 0.5f;
    int k;
    for (k = 0; k < TRACK_ROT; k++) {
        float ang = (float)k * 6.2831853f / (float)TRACK_ROT;
        float ca = cosf(ang);
        float sa = sinf(ang);
        int row;
        int col;
        for (row = 0; row < TRACK_T; row++) {
            for (col = 0; col < TRACK_T; col++) {
                float u = (float)col - (TRACK_T - 1) * 0.5f;
                float v = (float)row - (TRACK_T - 1) * 0.5f;
                float sx = cxf + ca * u - sa * v;
                float sy = cyf + sa * u + ca * v;
                lock->bank[(k * TRACK_T + row) * TRACK_T + col] = (uint8_t)(sample(frame, sx, sy) + 0.5f);
            }
        }
    }
}

void track_init(track_lock *lock, const uint8_t *frame, int x, int y) {
    int row;
    int col;
    x = clampi(x, 0, TRACK_W - TRACK_T);
    y = clampi(y, 0, TRACK_H - TRACK_T);
    memset(lock, 0, sizeof(*lock));
    lock->x = x;
    lock->y = y;
    lock->fx = (float)x;
    lock->fy = (float)y;
    lock->locked = 1;
    lock->score = 1;
    for (row = 0; row < TRACK_T; row++) {
        for (col = 0; col < TRACK_T; col++) {
            lock->templ[row * TRACK_T + col] = frame[(y + row) * TRACK_W + (x + col)];
        }
    }
    memcpy(lock->anchor, lock->templ, sizeof(lock->anchor));
    build_bank(lock, frame, x, y);
    lock->rot = 0;
}

int track_step(track_lock *lock, const uint8_t *frame) {
    float px;
    float py;
    int cx;
    int cy;
    int r;
    int dx;
    int dy;
    float best = -2;
    float best_raw = -1;
    int best_rot;
    int bx;
    int by;
    if (!lock->locked) {
        return 0;
    }
    px = lock->fx + lock->vx;
    py = lock->fy + lock->vy;
    cx = clampi((int)lroundf(px), 0, TRACK_W - TRACK_T);
    cy = clampi((int)lroundf(py), 0, TRACK_H - TRACK_T);
    bx = cx;
    by = cy;
    best_rot = lock->rot;
    r = TRACK_R + lock->misses;
    if (r > TRACK_R_MAX) {
        r = TRACK_R_MAX;
    }
    for (dy = -r; dy <= r; dy++) {
        for (dx = -r; dx <= r; dx++) {
            float raw = ncc(frame, cx + dx, cy + dy, lock->templ);
            int rot = lock->rot;
            int j;
            float score;
            for (j = -1; j <= 1; j++) {
                int k = (lock->rot + j + TRACK_ROT) % TRACK_ROT;
                float b = ANCHOR_WEIGHT * ncc(frame, cx + dx, cy + dy, &lock->bank[k * TRACK_T * TRACK_T]);
                if (b > raw) {
                    raw = b;
                    rot = k;
                }
            }
            score = raw - DIST_PENALTY * (float)(dx * dx + dy * dy);
            if (score > best) {
                best = score;
                best_raw = raw;
                best_rot = rot;
                bx = cx + dx;
                by = cy + dy;
            }
        }
    }
    lock->score = best_raw;
    {
        float a = ncc(frame, bx, by, &lock->bank[best_rot * TRACK_T * TRACK_T]);
        lock->anchor_score = a;
        if (a < ANCHOR_MIN) {
            best_raw = -1;
        }
    }
    if (best_raw < ACCEPT) {
        /* Coast on the last velocity and widen the search next frame. */
        lock->misses++;
        lock->fx = (float)clampi((int)lroundf(px), 0, TRACK_W - TRACK_T);
        lock->fy = (float)clampi((int)lroundf(py), 0, TRACK_H - TRACK_T);
        lock->x = (int)lock->fx;
        lock->y = (int)lock->fy;
        if (lock->misses > TRACK_COAST_MAX) {
            lock->locked = 0;
        }
        return 0;
    }
    if (lock->misses == 0) {
        lock->vx = 0.7f * lock->vx + 0.3f * ((float)bx - lock->fx);
        lock->vy = 0.7f * lock->vy + 0.3f * ((float)by - lock->fy);
    } else {
        /* Velocity during a coast was a guess; restart it from rest. */
        lock->vx = 0;
        lock->vy = 0;
    }
    lock->fx = (float)bx;
    lock->fy = (float)by;
    lock->x = bx;
    lock->y = by;
    lock->misses = 0;
    lock->rot = best_rot;
    if (best_raw >= ADAPT && lock->anchor_score >= ADAPT_ANCHOR) {
        int i;
        for (i = 0; i < TRACK_T * TRACK_T; i++) {
            int row = i / TRACK_T;
            int col = i % TRACK_T;
            float cur = (float)frame[(by + row) * TRACK_W + (bx + col)];
            float next = (1.0f - ADAPT_RATE) * (float)lock->templ[i] + ADAPT_RATE * cur;
            lock->templ[i] = (uint8_t)(next + 0.5f);
        }
    }
    return 1;
}

track_vel track_servo(float err_x, float err_y, float area, float area_ref) {
    track_vel out;
    out.vy = 0.4f * err_x;
    out.vz = 0.4f * err_y;
    out.vx = 0.05f * (area_ref - area);
    return out;
}
