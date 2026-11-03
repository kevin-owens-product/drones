/* Hosts the parser so the linker keeps it. No hardware init. */
#include "crsf.h"

int main(void) {
    static const uint8_t stream[] = {
        0x00, 0x11, 0x22, 0xc8, 0x11, 0x02, 0x16, 0x83, 0xfe, 0x08, 0xb7, 0x08,
        0x48, 0x30, 0x00, 0x7b, 0x6b, 0x3a, 0x04, 0x65, 0x0b, 0x37,
    };
    crsf_parser parser;
    crsf_frame frames[4];
    crsf_parser_init(&parser);
    return (int)crsf_parser_push(&parser, stream, sizeof(stream), frames, 4);
}
