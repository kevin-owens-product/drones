/* Link failsafe. Continue, loiter, return, land. GNSS loss is not an input. */
#ifndef A2E_FAILSAFE_H
#define A2E_FAILSAFE_H

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    FS_CONTINUE = 0,
    FS_LOITER,
    FS_RETURN,
    FS_LAND
} fs_state;

typedef struct {
    fs_state state;
    double link_down_s;
    double in_state_s;
    double loiter_after_s;
    double return_after_s;
    double land_after_s;
} fs_machine;

typedef struct {
    int link_up;
    int operator_return;
    int operator_land;
    double dt_s;
} fs_input;

void fs_init(fs_machine *m);
fs_state fs_step(fs_machine *m, fs_input in);

/* Store-and-forward for telemetry while the link is down. */
enum { SF_CAP = 64, SF_LEN = 24 };

typedef struct {
    unsigned char bytes[SF_CAP][SF_LEN];
    int len[SF_CAP];
    int count;
    int dropped;
    int head;
} sf_buf;

void sf_init(sf_buf *b);
int sf_push(sf_buf *b, const unsigned char *data, int n);
int sf_pop(sf_buf *b, unsigned char *out, int cap);

#ifdef __cplusplus
}
#endif

#endif
