#include "failsafe.h"

#include <string.h>

void fs_init(fs_machine *m) {
    m->state = FS_CONTINUE;
    m->link_down_s = 0;
    m->in_state_s = 0;
    m->loiter_after_s = 2;
    m->return_after_s = 10;
    m->land_after_s = 30;
}

static void enter(fs_machine *m, fs_state next) {
    if (m->state != next) {
        m->state = next;
        m->in_state_s = 0;
    }
}

fs_state fs_step(fs_machine *m, fs_input in) {
    if (in.dt_s < 0) {
        in.dt_s = 0;
    }
    m->in_state_s += in.dt_s;
    if (in.link_up) {
        m->link_down_s = 0;
    } else {
        m->link_down_s += in.dt_s;
    }
    if (in.operator_land) {
        enter(m, FS_LAND);
        return m->state;
    }
    if (m->state == FS_LAND) {
        return FS_LAND;
    }
    if (in.operator_return) {
        enter(m, FS_RETURN);
        return m->state;
    }
    if (in.track_lost && m->state == FS_CONTINUE) {
        enter(m, FS_LOITER);
        return m->state;
    }
    if (in.link_up && !in.track_lost && (m->state == FS_LOITER || m->state == FS_RETURN)) {
        enter(m, FS_CONTINUE);
        return m->state;
    }
    if (!in.link_up && m->state == FS_CONTINUE && m->link_down_s >= m->loiter_after_s) {
        enter(m, FS_LOITER);
    } else if (!in.link_up && m->state == FS_LOITER && m->in_state_s >= m->return_after_s) {
        enter(m, FS_RETURN);
    } else if (!in.link_up && m->state == FS_RETURN && m->in_state_s >= m->land_after_s) {
        enter(m, FS_LAND);
    }
    return m->state;
}

void sf_init(sf_buf *b) {
    memset(b, 0, sizeof(*b));
}

int sf_push(sf_buf *b, const unsigned char *data, int n) {
    int slot;
    if (n < 0) {
        return -1;
    }
    if (n > SF_LEN) {
        n = SF_LEN;
    }
    if (b->count == SF_CAP) {
        b->dropped++;
        b->head = (b->head + 1) % SF_CAP;
        b->count--;
    }
    slot = (b->head + b->count) % SF_CAP;
    if (n > 0) {
        memcpy(b->bytes[slot], data, (size_t)n);
    }
    b->len[slot] = n;
    b->count++;
    return 0;
}

int sf_pop(sf_buf *b, unsigned char *out, int cap) {
    int n;
    if (b->count == 0) {
        return 0;
    }
    n = b->len[b->head];
    if (n > cap) {
        n = cap;
    }
    if (n > 0) {
        memcpy(out, b->bytes[b->head], (size_t)n);
    }
    b->head = (b->head + 1) % SF_CAP;
    b->count--;
    return n;
}
