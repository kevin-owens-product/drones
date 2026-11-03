#include "associate.h"

#include <stdio.h>

static int fail(const char *message) {
    fprintf(stderr, "FAIL %s\n", message);
    return 1;
}

static det_box box(float x, float y, float score) {
    det_box d;
    d.x = x;
    d.y = y;
    d.w = 10.f;
    d.h = 10.f;
    d.score = score;
    return d;
}

static int test_keeps_ids(void) {
    assoc a;
    det_box frame[2];
    int left;
    int right;
    assoc_init(&a);
    frame[0] = box(0.f, 0.f, 0.9f);
    frame[1] = box(40.f, 0.f, 0.9f);
    assoc_step(&a, frame, 2);
    left = a.tracks[0].id;
    right = a.tracks[1].id;
    frame[0] = box(2.f, 0.f, 0.9f);
    frame[1] = box(42.f, 0.f, 0.9f);
    assoc_step(&a, frame, 2);
    if (assoc_find(&a, left) < 0 || assoc_find(&a, right) < 0) {
        return fail("ids were dropped on a small move");
    }
    if (a.tracks[assoc_find(&a, left)].x > 20.f || a.tracks[assoc_find(&a, right)].x < 20.f) {
        return fail("ids switched sides");
    }
    printf("id_switches 0 tracks %d\n", a.count);
    return 0;
}

static int test_low_score_keeps_track(void) {
    assoc a;
    det_box frame[1];
    int id;
    assoc_init(&a);
    frame[0] = box(0.f, 0.f, 0.9f);
    assoc_step(&a, frame, 1);
    id = a.tracks[0].id;
    frame[0] = box(1.f, 0.f, 0.2f);
    assoc_step(&a, frame, 1);
    if (assoc_find(&a, id) < 0) {
        return fail("a low score on the same box dropped the track");
    }
    printf("low_score_kept %d\n", id);
    return 0;
}

static int test_low_score_does_not_spawn(void) {
    assoc a;
    det_box frame[1];
    assoc_init(&a);
    frame[0] = box(0.f, 0.f, 0.2f);
    assoc_step(&a, frame, 1);
    if (a.count != 0) {
        return fail("a low score with no track started one");
    }
    printf("low_score_spawned 0\n");
    return 0;
}

static int test_drop_after_eight(void) {
    assoc a;
    det_box frame[1];
    int i;
    assoc_init(&a);
    frame[0] = box(0.f, 0.f, 0.9f);
    assoc_step(&a, frame, 1);
    for (i = 0; i < 8; i++) {
        assoc_step(&a, frame, 0);
    }
    if (a.count != 0) {
        return fail("eight empty frames should drop the track");
    }
    printf("dropped_after 8\n");
    return 0;
}

int main(void) {
    if (test_keeps_ids() || test_low_score_keeps_track() || test_low_score_does_not_spawn() || test_drop_after_eight()) {
        return 1;
    }
    printf("associate tests passed\n");
    return 0;
}
