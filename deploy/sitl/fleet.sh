#!/bin/sh
# Start N PX4 SITL quads in one Gazebo Harmonic world.
# The stock image entrypoint execs a single px4. This replaces it.
set -eu

COUNT="${A2E_SITL_COUNT:-6}"
PX4_PREFIX=/opt/px4-gazebo
export HEADLESS="${HEADLESS:-1}"
export PX4_GZ_WORLD="${PX4_GZ_WORLD:-default}"
export GZ_SIM_RESOURCE_PATH="/models:${GZ_SIM_RESOURCE_PATH:-$PX4_PREFIX/share/gz/models}"

# Gazebo resolves model://x500_a2e under the image model root, not GZ_SIM_RESOURCE_PATH.
if [ -d /models/x500_a2e ] && [ ! -e "$PX4_PREFIX/share/gz/models/x500_a2e/model.sdf" ]; then
    mkdir -p "$PX4_PREFIX/share/gz/models/x500_a2e"
    cp -R /models/x500_a2e/. "$PX4_PREFIX/share/gz/models/x500_a2e/"
fi
# Reach the gateway on the Docker network. The stock link stays on localhost.
airframe="$PX4_PREFIX/etc/init.d-posix/airframes/4001_gz_x500"
if ! grep -q MAV_0_BROADCAST "$airframe"; then
    printf '\nparam set-default MAV_0_BROADCAST 1\nparam set-default MAV_1_BROADCAST 1\n' >> "$airframe"
fi

DOCKER_HOST_IP=$(getent ahostsv4 host.docker.internal 2>/dev/null | awk '/STREAM/ {print $1; exit}')
if [ -n "$DOCKER_HOST_IP" ]; then
    sed -i "s/mavlink start -x -u/mavlink start -x -t $DOCKER_HOST_IP -u/g" \
        "$PX4_PREFIX/etc/init.d-posix/px4-rc.mavlink"
    sed -i "s|uxrce_dds_client start -t udp|uxrce_dds_client start -t udp -h $DOCKER_HOST_IP|" \
        "$PX4_PREFIX/etc/init.d-posix/rcS"
fi

i=0
while [ "$i" -lt "$COUNT" ]; do
    pose="0,$((i * 3))"
    standalone=""
    if [ "$i" -ne 0 ]; then
        standalone=1
    fi
    echo "spawn instance $i pose $pose"
    PX4_SYS_AUTOSTART=4001 \
    PX4_SIM_MODEL=x500_a2e \
    PX4_GZ_MODEL_POSE="$pose" \
    PX4_GZ_STANDALONE="$standalone" \
        "$PX4_PREFIX/bin/px4" -i "$i" &
    if [ "$i" -eq 0 ]; then
        sleep 8
    else
        sleep 2
    fi
    i=$((i + 1))
done
wait
