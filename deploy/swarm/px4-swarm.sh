#!/bin/sh
# Start N PX4 quads in SIH (PX4's built-in rigid-body simulator) in one container.
# No Gazebo and no GPU: each vehicle is the real PX4 flight stack (commander, EKF2,
# position and attitude control) flying a 6-DOF quad model.
#
# Vehicle i sends its ground-station link to SWARM_GCS_HOST on UDP 14550+i, where the
# bridge listens. PX4 talks only to the first peer it hears on a UDP link, so the
# peer is fixed here rather than learned (a bridge restart would otherwise lose it).
set -eu

COUNT="${SWARM_COUNT:-4}"
# The pad: a row of vehicles 8 m apart, by default at the demo range's station.
LAT="${SWARM_HOME_LAT:-35.738748}"
LON="${SWARM_HOME_LON:--120.739944}"
ALT="${SWARM_HOME_ALT:-0}"
SPACING="${SWARM_SPACING_M:-8}"
PX4=/opt/px4-gazebo/bin/px4
RC=/opt/px4-gazebo/etc/init.d-posix/px4-rc.mavlink
GCS_HOST="${SWARM_GCS_HOST:-172.28.57.10}"

# Point the ground-station link (local port 18570+i) at the bridge.
if ! grep -q "SWARM_GCS" "$RC"; then
    sed -i "s|^mavlink start -x -u \$udp_gcs_port_local -r 4000000 -f|# SWARM_GCS\nmavlink start -x -u \$udp_gcs_port_local -r 4000000 -f -t $GCS_HOST -o \$((14550+px4_instance))|" "$RC"
fi
grep -A1 SWARM_GCS "$RC"

if [ "$COUNT" -gt 10 ]; then
    echo "SWARM_COUNT above 10 is not supported (PX4 reuses ports past instance 9)" >&2
    exit 1
fi

i=0
while [ "$i" -lt "$COUNT" ]; do
    # Each vehicle starts SPACING m east of the one before it.
    lon=$(awk -v lon="$LON" -v lat="$LAT" -v i="$i" -v s="$SPACING" \
        'BEGIN { printf "%.7f", lon + (i * s) / (111320 * cos(lat * 3.14159265 / 180)) }')
    echo "swarm: vehicle $((i + 1)) at $LAT,$lon on UDP $((18570 + i))"
    # -d runs without the interactive shell, which would spin with no stdin.
    PX4_SIMULATOR=sihsim \
    PX4_SIM_MODEL=sihsim_quadx \
    PX4_SYS_AUTOSTART=10040 \
    PX4_HOME_LAT="$LAT" \
    PX4_HOME_LON="$lon" \
    PX4_HOME_ALT="$ALT" \
    PX4_SIM_SPEED_FACTOR="${SWARM_SPEED:-1}" \
        "$PX4" -d -i "$i" > "/tmp/px4-$i.log" 2>&1 &
    i=$((i + 1))
    sleep 1
done

# Keep the container up while any vehicle runs; show their logs.
tail -F /tmp/px4-*.log &
wait
