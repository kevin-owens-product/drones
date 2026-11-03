#include "crsf.h"

#include <string.h>

static int is_sync(uint8_t byte) {
    return byte == CRSF_ADDR_FC || byte == CRSF_ADDR_RADIO || byte == CRSF_ADDR_RECEIVER ||
           byte == CRSF_ADDR_TRANSMITTER || byte == CRSF_ADDR_BROADCAST;
}

uint8_t crsf_crc8(const uint8_t *data, size_t len) {
    uint8_t crc = 0;
    size_t i;
    int bit;
    for (i = 0; i < len; i++) {
        crc ^= data[i];
        for (bit = 0; bit < 8; bit++) {
            if (crc & 0x80) {
                crc = (uint8_t)((crc << 1) ^ 0xD5);
            } else {
                crc = (uint8_t)(crc << 1);
            }
        }
    }
    return crc;
}

void crsf_parser_init(crsf_parser *parser) {
    memset(parser, 0, sizeof(*parser));
}

static uint16_t rd_be16(const uint8_t *p) {
    return (uint16_t)((p[0] << 8) | p[1]);
}

static int16_t rd_be16s(const uint8_t *p) {
    return (int16_t)rd_be16(p);
}

static int32_t rd_be32s(const uint8_t *p) {
    return (int32_t)(((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3]);
}

static void decode(crsf_frame *frame) {
    const uint8_t *p = frame->payload;
    uint8_t n = frame->payload_len;
    memset(frame->flight_mode, 0, sizeof(frame->flight_mode));
    if (frame->type == CRSF_TYPE_GPS && n >= 15) {
        frame->kind = CRSF_KIND_GPS;
        frame->lat_e7 = rd_be32s(p);
        frame->lon_e7 = rd_be32s(p + 4);
        frame->groundspeed_kmh_e1 = rd_be16(p + 8);
        frame->heading_deg_e2 = rd_be16(p + 10);
        frame->alt_m_plus_1000 = rd_be16(p + 12);
        frame->satellites = p[14];
    } else if (frame->type == CRSF_TYPE_BATTERY && n >= 8) {
        frame->kind = CRSF_KIND_BATTERY;
        frame->voltage_dv = rd_be16(p);
        frame->current_da = rd_be16(p + 2);
        frame->capacity_mah = ((uint32_t)p[4] << 16) | ((uint32_t)p[5] << 8) | p[6];
        frame->remaining_pct = p[7];
    } else if (frame->type == CRSF_TYPE_LINK && n >= 10) {
        frame->kind = CRSF_KIND_LINK;
        frame->uplink_rssi_1 = p[0];
        frame->uplink_rssi_2 = p[1];
        frame->uplink_lq = p[2];
        frame->uplink_snr = (int8_t)p[3];
        frame->downlink_rssi = p[7];
        frame->downlink_lq = p[8];
        frame->downlink_snr = (int8_t)p[9];
    } else if (frame->type == CRSF_TYPE_ATTITUDE && n >= 6) {
        frame->kind = CRSF_KIND_ATTITUDE;
        frame->pitch_rad_e4 = rd_be16s(p);
        frame->roll_rad_e4 = rd_be16s(p + 2);
        frame->yaw_rad_e4 = rd_be16s(p + 4);
    } else if (frame->type == CRSF_TYPE_FLIGHT_MODE && n >= 1) {
        size_t copy = n;
        frame->kind = CRSF_KIND_FLIGHT_MODE;
        if (copy >= sizeof(frame->flight_mode)) {
            copy = sizeof(frame->flight_mode) - 1;
        }
        memcpy(frame->flight_mode, p, copy);
        frame->flight_mode[copy] = '\0';
    } else {
        frame->kind = CRSF_KIND_OTHER;
    }
}

static int finish(crsf_parser *parser, crsf_frame *frame) {
    uint8_t length = parser->buf[1];
    uint8_t crc = crsf_crc8(parser->buf + 2, (size_t)length - 1);
    if (crc != parser->buf[1 + length]) {
        parser->frames_bad_crc++;
        return 0;
    }
    memset(frame, 0, sizeof(*frame));
    frame->address = parser->buf[0];
    frame->type = parser->buf[2];
    frame->payload_len = (uint8_t)(length - 2);
    if (frame->payload_len > 0) {
        memcpy(frame->payload, parser->buf + 3, frame->payload_len);
    }
    decode(frame);
    parser->frames_ok++;
    return 1;
}

static void resync(crsf_parser *parser) {
    uint8_t kept[CRSF_MAX_FRAME];
    uint8_t n;
    uint8_t i;
    if (parser->have < 2) {
        parser->have = 0;
        parser->need = 0;
        return;
    }
    n = (uint8_t)(parser->have - 1);
    memcpy(kept, parser->buf + 1, n);
    parser->bytes_skipped++;
    parser->have = 0;
    parser->need = 0;
    for (i = 0; i < n; i++) {
        uint8_t byte = kept[i];
        if (parser->need == 0) {
            if (!is_sync(byte)) {
                parser->bytes_skipped++;
                continue;
            }
            parser->buf[0] = byte;
            parser->have = 1;
            parser->need = 2;
            continue;
        }
        parser->buf[parser->have++] = byte;
        if (parser->have == 2) {
            uint8_t length = parser->buf[1];
            if (length < 2 || length > CRSF_MAX_FRAME - 2) {
                parser->need = 0;
                parser->have = 0;
                parser->bytes_skipped++;
                continue;
            }
            parser->need = (uint8_t)(length + 2);
        }
    }
}

static size_t emit_ready(crsf_parser *parser, crsf_frame *out, size_t max_out, size_t produced) {
    while (parser->need > 0 && parser->have == parser->need) {
        crsf_frame scratch;
        crsf_frame *dest = (produced < max_out) ? &out[produced] : &scratch;
        if (finish(parser, dest)) {
            if (produced < max_out) {
                produced++;
            }
            parser->have = 0;
            parser->need = 0;
        } else {
            resync(parser);
        }
    }
    return produced;
}

size_t crsf_parser_push(crsf_parser *parser, const uint8_t *data, size_t len, crsf_frame *out, size_t max_out) {
    size_t produced = 0;
    size_t i;
    for (i = 0; i < len; i++) {
        uint8_t byte = data[i];
        if (parser->need == 0) {
            if (!is_sync(byte)) {
                parser->bytes_skipped++;
                continue;
            }
            parser->buf[0] = byte;
            parser->have = 1;
            parser->need = 2;
            continue;
        }
        if (parser->have >= CRSF_MAX_FRAME) {
            resync(parser);
            produced = emit_ready(parser, out, max_out, produced);
            i--;
            continue;
        }
        parser->buf[parser->have++] = byte;
        if (parser->have == 2) {
            uint8_t length = parser->buf[1];
            if (length < 2 || length > CRSF_MAX_FRAME - 2) {
                resync(parser);
                produced = emit_ready(parser, out, max_out, produced);
                continue;
            }
            parser->need = (uint8_t)(length + 2);
        }
        produced = emit_ready(parser, out, max_out, produced);
    }
    return produced;
}
