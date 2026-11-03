#include "crsf.h"

#include <stddef.h>
#include <stdint.h>

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
    crsf_parser parser;
    crsf_frame frames[4];
    crsf_parser_init(&parser);
    (void)crsf_parser_push(&parser, data, size, frames, 4);
    return 0;
}
