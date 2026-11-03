/* Normalized cross-correlation lock and image-based visual servoing.
 * Frames are grayscale. There is no weapon output, only a velocity setpoint. */
#ifndef A2E_TRACK_H
#define A2E_TRACK_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum { TRACK_W = 64, TRACK_H = 48, TRACK_T = 8, TRACK_R = 6 };

typedef struct {
    int x;
    int y;
    int misses;
    int locked;
    uint8_t templ[TRACK_T * TRACK_T];
} track_lock;

typedef struct {
    float vx;
    float vy;
    float vz;
} track_vel;

void track_init(track_lock *lock, const uint8_t *frame, int x, int y);
/* Returns 1 when the peak correlation is above the lock threshold. */
int track_step(track_lock *lock, const uint8_t *frame);
track_vel track_servo(float err_x, float err_y, float area, float area_ref);

#ifdef __cplusplus
}
#endif

#endif
