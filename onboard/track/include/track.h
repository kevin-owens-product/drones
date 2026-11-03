/* Normalized cross-correlation lock and image-based visual servoing.
 * Frames are grayscale. There is no weapon output, only a velocity setpoint. */
#ifndef A2E_TRACK_H
#define A2E_TRACK_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum { TRACK_W = 64, TRACK_H = 48, TRACK_T = 8, TRACK_R = 6, TRACK_R_MAX = 18, TRACK_COAST_MAX = 60, TRACK_ROT = 16 };

/* x, y is the top-left of the TRACK_T x TRACK_T box.
 * templ adapts slowly while the match is strong; anchor is the patch the
 * operator designated and never changes, so drift has something to snap
 * back to. bank holds the designated patch rotated in 22.5 degree steps (cut
 * from a wider patch so the corners are real pixels); each frame tries the
 * current rotation and its two neighbours, which follows a turning vehicle
 * without letting the template wander. While misses > 0 the lock is coasting on its last velocity and
 * the search window grows by a pixel per miss. */
typedef struct {
    int x;
    int y;
    int misses;
    int locked;
    uint8_t templ[TRACK_T * TRACK_T];
    uint8_t anchor[TRACK_T * TRACK_T];
    float fx;
    float fy;
    float vx;
    float vy;
    float score;
    float anchor_score; /* match against the designated template, best rotation */
    int rot;
    uint8_t bank[TRACK_ROT * TRACK_T * TRACK_T];
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
