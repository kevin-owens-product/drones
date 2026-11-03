/* clock_gettime and CLOCK_MONOTONIC are POSIX, not ISO C17. */
#define _POSIX_C_SOURCE 200809L
#include "track.h"

#include <math.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

static int fail(const char *message) {
    fprintf(stderr, "FAIL %s\n", message);
    return 1;
}

static void paint(uint8_t *frame, int x, int y, int on) {
    int row;
    int col;
    memset(frame, 0, TRACK_W * TRACK_H);
    if (!on) {
        return;
    }
    for (row = 0; row < TRACK_T; row++) {
        for (col = 0; col < TRACK_T; col++) {
            int px = x + col;
            int py = y + row;
            if (px >= 0 && py >= 0 && px < TRACK_W && py < TRACK_H) {
                frame[py * TRACK_W + px] = ((col + row) & 1) ? 220 : 30;
            }
        }
    }
}

static int test_servo_centers(void) {
    float ex = 10;
    float ey = -6;
    float area = 40;
    int i;
    for (i = 0; i < 40; i++) {
        track_vel v = track_servo(ex, ey, area, 64);
        ex -= v.vy;
        ey -= v.vz;
        area += v.vx;
    }
    printf("servo_err_px %.2f %.2f area %.1f\n", ex, ey, area);
    if (fabsf(ex) > 0.5f || fabsf(ey) > 0.5f) {
        return fail("servo did not center the target");
    }
    return 0;
}

static int run_one(unsigned seed, float *err_sum, int *err_n, int *reacq) {
    uint8_t frame[TRACK_W * TRACK_H];
    track_lock lock;
    int x = 8 + (int)(seed % 20);
    int y = 8 + (int)((seed / 3) % 16);
    int vx = (seed % 2) == 0 ? 1 : -1;
    int i;
    int lost = 0;
    int reacquired = -1;
    paint(frame, x, y, 1);
    track_init(&lock, frame, x, y);
    for (i = 0; i < 24; i++) {
        int visible = !(i >= 8 && i < 14);
        x += vx;
        if (x < 2) {
            x = 2;
            vx = 1;
        }
        if (x > TRACK_W - TRACK_T - 2) {
            x = TRACK_W - TRACK_T - 2;
            vx = -1;
        }
        paint(frame, x, y, visible);
        track_step(&lock, frame);
        if (!visible && !lock.locked) {
            lost = 1;
        }
        if (visible && i >= 14 && lock.locked && abs(lock.x - x) <= 1 && abs(lock.y - y) <= 1) {
            if (reacquired < 0) {
                reacquired = i - 14;
            }
            *err_sum += (float)abs(lock.x - x) + (float)abs(lock.y - y);
            (*err_n)++;
        }
    }
    *reacq = reacquired;
    return lock.locked && !lost && reacquired >= 0;
}

static int test_fifty(void) {
    int run;
    int held = 0;
    int reacqs = 0;
    int reacq_sum = 0;
    float err_sum = 0;
    int err_n = 0;
    struct timespec t0;
    struct timespec t1;
    double seconds;
    double fps;
    clock_gettime(CLOCK_MONOTONIC, &t0);
    for (run = 0; run < 50; run++) {
        int reacq = -1;
        if (run_one((unsigned)(run * 17 + 3), &err_sum, &err_n, &reacq)) {
            held++;
        }
        if (reacq >= 0) {
            reacqs++;
            reacq_sum += reacq;
        }
    }
    clock_gettime(CLOCK_MONOTONIC, &t1);
    seconds = (double)(t1.tv_sec - t0.tv_sec) + (double)(t1.tv_nsec - t0.tv_nsec) / 1e9;
    fps = (50.0 * 24.0) / seconds;
    printf("lock_retention %d/50\n", held);
    printf("reacq_frames %.2f\n", reacqs ? (double)reacq_sum / reacqs : -1);
    printf("mean_pixel_err %.3f\n", err_n ? err_sum / err_n : -1);
    printf("track_fps %.0f\n", fps);
    if (held < 45) {
        return fail("lock retention below 45/50");
    }
    if (err_n == 0 || err_sum / err_n > 1.5f) {
        return fail("mean pixel error above 1.5");
    }
    if (fps < 200) {
        return fail("tracker slower than 200 fps");
    }
    return 0;
}

/* Textured ground: the target sits on it, then is hidden. The tracker must not
 * call ground a hit, and must not adapt its template into the ground. */
static void ground(uint8_t *frame, unsigned *rng) {
    int i;
    for (i = 0; i < TRACK_W * TRACK_H; i++) {
        *rng = *rng * 1103515245u + 12345u;
        frame[i] = (uint8_t)(110 + ((*rng >> 16) % 40));
    }
}

static void stamp(uint8_t *frame, int x, int y) {
    int row;
    int col;
    for (row = 0; row < TRACK_T; row++) {
        for (col = 0; col < TRACK_T; col++) {
            frame[(y + row) * TRACK_W + (x + col)] = ((col / 2 + row / 2) & 1) ? 230 : 20;
        }
    }
}

static int test_hidden_on_texture(void) {
    uint8_t frame[TRACK_W * TRACK_H];
    track_lock lock;
    unsigned rng = 7;
    int i;
    int false_hits = 0;
    int back = -1;
    ground(frame, &rng);
    stamp(frame, 28, 20);
    track_init(&lock, frame, 28, 20);
    for (i = 0; i < 10; i++) {
        ground(frame, &rng);
        stamp(frame, 28, 20);
        track_step(&lock, frame);
    }
    for (i = 0; i < 40; i++) {
        ground(frame, &rng);
        /* Hold the search where the target was, as the ground filter does. */
        lock.fx = 28;
        lock.fy = 20;
        lock.vx = 0;
        lock.vy = 0;
        false_hits += track_step(&lock, frame);
    }
    for (i = 0; i < 10 && back < 0; i++) {
        ground(frame, &rng);
        stamp(frame, 28, 20);
        lock.fx = 28;
        lock.fy = 20;
        if (track_step(&lock, frame) && abs(lock.x - 28) <= 1 && abs(lock.y - 20) <= 1) {
            back = i;
        }
    }
    printf("hidden_false_hits %d/40 reacquired_after %d frames\n", false_hits, back);
    if (false_hits > 2) {
        return fail("tracker matched bare ground while the target was hidden");
    }
    if (back < 0 || back > 2) {
        return fail("tracker did not reacquire the target after it reappeared");
    }
    return 0;
}

int main(void) {
    if (test_servo_centers() || test_fifty() || test_hidden_on_texture()) {
        return 1;
    }
    printf("track tests passed\n");
    return 0;
}
