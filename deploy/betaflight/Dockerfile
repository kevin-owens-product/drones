# Betaflight SITL, rate mode, pinned to a master commit that builds with the arm toolchain image.
FROM betaflight/betaflight-build:arm@sha256:8a0e4da6e9a6fb87996f6a1e38bc94a3edd772d95098e59643a1d99c4e14e06e

ARG BF_SHA=21e67d203d32ce46d39e996493c39c1378c4974b
RUN git init /src \
    && git -C /src remote add origin https://github.com/betaflight/betaflight.git \
    && git -C /src fetch --depth 1 origin ${BF_SHA} \
    && git -C /src checkout FETCH_HEAD
WORKDIR /src
RUN make TARGET=SITL
EXPOSE 5761
CMD ["./obj/main/betaflight_SITL.elf"]
