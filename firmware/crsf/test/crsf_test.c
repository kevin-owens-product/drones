#include "crsf.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static int fail(const char *message) {
    fprintf(stderr, "FAIL %s\n", message);
    return 1;
}

static uint8_t *read_file(const char *path, size_t *len) {
    FILE *file = fopen(path, "rb");
    uint8_t *buf;
    long size;
    if (file == NULL) {
        return NULL;
    }
    if (fseek(file, 0, SEEK_END) != 0) {
        fclose(file);
        return NULL;
    }
    size = ftell(file);
    if (size < 0) {
        fclose(file);
        return NULL;
    }
    rewind(file);
    buf = malloc((size_t)size);
    if (buf == NULL) {
        fclose(file);
        return NULL;
    }
    if (fread(buf, 1, (size_t)size, file) != (size_t)size) {
        free(buf);
        fclose(file);
        return NULL;
    }
    fclose(file);
    *len = (size_t)size;
    return buf;
}

static int expect_stream(const crsf_frame *frames, size_t count) {
    if (count != 5) {
        return fail("expected 5 frames");
    }
    if (frames[0].kind != CRSF_KIND_GPS || frames[0].lat_e7 != 377749000 || frames[0].lon_e7 != -1224194000) {
        return fail("gps");
    }
    if (frames[0].groundspeed_kmh_e1 != 123 || frames[0].heading_deg_e2 != 27450 || frames[0].alt_m_plus_1000 != 1125 ||
        frames[0].satellites != 11) {
        return fail("gps fields");
    }
    if (frames[1].kind != CRSF_KIND_BATTERY || frames[1].voltage_dv != 168 || frames[1].current_da != 42 ||
        frames[1].capacity_mah != 1500 || frames[1].remaining_pct != 73) {
        return fail("battery");
    }
    if (frames[2].kind != CRSF_KIND_LINK || frames[2].uplink_rssi_1 != 80 || frames[2].uplink_lq != 98 ||
        frames[2].uplink_snr != -5 || frames[2].downlink_lq != 95 || frames[2].downlink_snr != -2) {
        return fail("link");
    }
    if (frames[3].kind != CRSF_KIND_ATTITUDE || frames[3].pitch_rad_e4 != 120 || frames[3].roll_rad_e4 != -40 ||
        frames[3].yaw_rad_e4 != 9000) {
        return fail("attitude");
    }
    if (frames[4].kind != CRSF_KIND_FLIGHT_MODE || strcmp(frames[4].flight_mode, "ANGLE") != 0) {
        return fail("flight mode");
    }
    return 0;
}

static int test_split(const uint8_t *data, size_t len) {
    crsf_parser parser;
    crsf_frame frames[8];
    size_t got = 0;
    size_t offset = 0;
    crsf_parser_init(&parser);
    while (offset < len) {
        size_t chunk = 3;
        size_t n;
        if (offset + chunk > len) {
            chunk = len - offset;
        }
        n = crsf_parser_push(&parser, data + offset, chunk, frames + got, 8 - got);
        got += n;
        offset += chunk;
    }
    return expect_stream(frames, got);
}

static int test_rate(const uint8_t *data, size_t len) {
    enum { COPIES = 20000 };
    crsf_parser parser;
    crsf_frame frames[8];
    struct timespec start;
    struct timespec end;
    double seconds;
    double per_sec;
    int i;
    crsf_parser_init(&parser);
    clock_gettime(CLOCK_MONOTONIC, &start);
    for (i = 0; i < COPIES; i++) {
        if (crsf_parser_push(&parser, data, len, frames, 8) != 5) {
            return fail("rate parse");
        }
    }
    clock_gettime(CLOCK_MONOTONIC, &end);
    seconds = (double)(end.tv_sec - start.tv_sec) + (double)(end.tv_nsec - start.tv_nsec) / 1e9;
    per_sec = (COPIES * 5) / seconds;
    printf("crsf_frames_per_sec %.0f\n", per_sec);
    /* Floor is half of a laptop measurement (~1e6 frames/s). A Pi 5 is the
     * budget this parser is written for; this catches an algorithmic regression. */
    if (per_sec < 200000.0) {
        fprintf(stderr, "FAIL frames/s %.0f under floor 200000\n", per_sec);
        return 1;
    }
    return 0;
}

int main(int argc, char **argv) {
    const char *dir = argc > 1 ? argv[1] : "testdata";
    char path[512];
    uint8_t *stream;
    uint8_t *bad;
    size_t stream_len = 0;
    size_t bad_len = 0;
    crsf_parser parser;
    crsf_frame frames[8];
    size_t got;
    int rc;
    snprintf(path, sizeof(path), "%s/stream.bin", dir);
    stream = read_file(path, &stream_len);
    snprintf(path, sizeof(path), "%s/bad_then_gps.bin", dir);
    bad = read_file(path, &bad_len);
    if (stream == NULL || bad == NULL) {
        fprintf(stderr, "missing fixtures under %s\n", dir);
        free(stream);
        free(bad);
        return 1;
    }
    crsf_parser_init(&parser);
    got = crsf_parser_push(&parser, stream, stream_len, frames, 8);
    rc = expect_stream(frames, got);
    if (rc != 0) {
        free(stream);
        free(bad);
        return rc;
    }
    if (parser.bytes_skipped < 3) {
        free(stream);
        free(bad);
        return fail("noise was not skipped");
    }
    rc = test_split(stream, stream_len);
    if (rc != 0) {
        free(stream);
        free(bad);
        return rc;
    }
    crsf_parser_init(&parser);
    got = crsf_parser_push(&parser, bad, bad_len, frames, 8);
    if (got != 1 || frames[0].kind != CRSF_KIND_GPS || parser.frames_bad_crc < 1) {
        free(stream);
        free(bad);
        return fail("bad crc then gps");
    }
    rc = test_rate(stream + 3, stream_len - 3);
    free(stream);
    free(bad);
    if (rc == 0) {
        printf("crsf tests passed\n");
    }
    return rc;
}
