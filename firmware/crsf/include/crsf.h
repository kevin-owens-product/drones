/* CRSF (TBS / ExpressLRS) telemetry parser.
 * Compute budget: a few dozen instructions per byte, sized for a Raspberry Pi 5
 * or the companion UART on a 5-inch quad. No heap use.
 */
#ifndef A2E_CRSF_H
#define A2E_CRSF_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
    CRSF_ADDR_BROADCAST = 0x00,
    CRSF_ADDR_FC = 0xC8,
    CRSF_ADDR_RADIO = 0xEA,
    CRSF_ADDR_RECEIVER = 0xEC,
    CRSF_ADDR_TRANSMITTER = 0xEE,
    CRSF_TYPE_GPS = 0x02,
    CRSF_TYPE_BATTERY = 0x08,
    CRSF_TYPE_LINK = 0x14,
    CRSF_TYPE_ATTITUDE = 0x1E,
    CRSF_TYPE_FLIGHT_MODE = 0x21,
    CRSF_MAX_FRAME = 64,
    CRSF_MAX_PAYLOAD = 60
};

typedef enum {
    CRSF_KIND_OTHER = 0,
    CRSF_KIND_GPS,
    CRSF_KIND_BATTERY,
    CRSF_KIND_LINK,
    CRSF_KIND_ATTITUDE,
    CRSF_KIND_FLIGHT_MODE
} crsf_kind;

typedef struct {
    crsf_kind kind;
    uint8_t address;
    uint8_t type;
    uint8_t payload_len;
    uint8_t payload[CRSF_MAX_PAYLOAD];
    int32_t lat_e7;
    int32_t lon_e7;
    uint16_t groundspeed_kmh_e1;
    uint16_t heading_deg_e2;
    uint16_t alt_m_plus_1000;
    uint8_t satellites;
    uint16_t voltage_dv;
    uint16_t current_da;
    uint32_t capacity_mah;
    uint8_t remaining_pct;
    uint8_t uplink_rssi_1;
    uint8_t uplink_rssi_2;
    uint8_t uplink_lq;
    int8_t uplink_snr;
    uint8_t downlink_rssi;
    uint8_t downlink_lq;
    int8_t downlink_snr;
    int16_t pitch_rad_e4;
    int16_t roll_rad_e4;
    int16_t yaw_rad_e4;
    char flight_mode[CRSF_MAX_PAYLOAD];
} crsf_frame;

typedef struct {
    uint8_t buf[CRSF_MAX_FRAME];
    uint8_t have;
    uint8_t need;
    uint32_t frames_ok;
    uint32_t frames_bad_crc;
    uint32_t bytes_skipped;
} crsf_parser;

uint8_t crsf_crc8(const uint8_t *data, size_t len);
void crsf_parser_init(crsf_parser *parser);
/* Push bytes. Writes up to max_out decoded frames and returns how many. */
size_t crsf_parser_push(crsf_parser *parser, const uint8_t *data, size_t len, crsf_frame *out, size_t max_out);

#ifdef __cplusplus
}
#endif

#endif
