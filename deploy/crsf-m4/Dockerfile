# Cortex-M4 size report for the CRSF parser. Bazel drives arm-none-eabi-gcc.
FROM ubuntu:24.04@sha256:24737cef17f4e22b1977df7d9a05e77c4e28b7da5b8911f8d8ccda136bf3573c

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl gcc-arm-none-eabi libnewlib-arm-none-eabi python3 build-essential \
        qemu-system-arm \
    && rm -rf /var/lib/apt/lists/*

ARG BAZELISK_VERSION=1.25.0
RUN curl -fsSL -o /usr/local/bin/bazel \
        "https://github.com/bazelbuild/bazelisk/releases/download/v${BAZELISK_VERSION}/bazelisk-linux-arm64" \
    && chmod 755 /usr/local/bin/bazel

WORKDIR /src
COPY MODULE.bazel .bazelversion ./
COPY firmware/crsf firmware/crsf
ENV USE_BAZEL_VERSION=7.4.1
RUN bazel build //firmware/crsf:crsf_m4_size \
    && cp bazel-bin/firmware/crsf/crsf_m4_size.txt /crsf_m4_size.txt \
    && chmod +x firmware/crsf/m4/qemu-time.sh \
    && firmware/crsf/m4/qemu-time.sh >> /crsf_m4_size.txt
CMD ["cat", "/crsf_m4_size.txt"]
