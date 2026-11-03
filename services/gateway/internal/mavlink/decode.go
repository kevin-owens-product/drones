// Package mavlink decodes MAVLink 2 frames from PX4 into the telemetry.v1 sample.
package mavlink

import (
	"time"

	"github.com/bluenviron/gomavlib/v3/pkg/dialects/common"
	"github.com/bluenviron/gomavlib/v3/pkg/message"

	"a2e.local/gateway/internal/wire"
)

const (
	CommandArm     = 400 // MAV_CMD_COMPONENT_ARM_DISARM
	CommandTakeoff = 22  // MAV_CMD_NAV_TAKEOFF
	CommandLand    = 21  // MAV_CMD_NAV_LAND
	CommandMode    = 176 // MAV_CMD_DO_SET_MODE
)

func Decode(systemID byte, msg message.Message, received time.Time) (wire.Sample, bool) {
	sample := wire.Sample{SystemID: uint32(systemID), ReceivedUnixNs: received.UnixNano()}
	switch m := msg.(type) {
	case *common.MessageHeartbeat:
		sample.Name = "HEARTBEAT"
		sample.CustomMode = m.CustomMode
		sample.BaseMode = uint32(m.BaseMode)
	case *common.MessageAttitude:
		sample.Name = "ATTITUDE"
		sample.Roll = m.Roll
		sample.Pitch = m.Pitch
		sample.Yaw = m.Yaw
	case *common.MessageLocalPositionNed:
		sample.Name = "LOCAL_POSITION_NED"
		sample.XM = m.X
		sample.YM = m.Y
		sample.ZM = m.Z
		sample.VxCms = int32(m.Vx * 100)
		sample.VyCms = int32(m.Vy * 100)
		sample.VzCms = int32(m.Vz * 100)
	case *common.MessageGlobalPositionInt:
		sample.Name = "GLOBAL_POSITION_INT"
		sample.LatE7 = m.Lat
		sample.LonE7 = m.Lon
		sample.AltMM = m.Alt
		sample.VxCms = int32(m.Vx)
		sample.VyCms = int32(m.Vy)
		sample.VzCms = int32(m.Vz)
	case *common.MessageEstimatorStatus:
		sample.Name = "ESTIMATOR_STATUS"
		sample.EstimatorFlags = uint32(m.Flags)
	case *common.MessageBatteryStatus:
		sample.Name = "BATTERY_STATUS"
		sample.BatteryRemainingPct = int32(m.BatteryRemaining)
		sample.VoltageMV = uint32(m.Voltages[0])
	case *common.MessageRcChannels:
		sample.Name = "RC_CHANNELS"
		sample.RCCount = uint32(m.Chancount)
	case *common.MessageSysStatus:
		sample.Name = "SYS_STATUS"
		sample.VoltageMV = uint32(m.VoltageBattery)
		sample.BatteryRemainingPct = int32(m.BatteryRemaining)
	case *common.MessageCommandLong:
		sample.Name = "COMMAND_LONG"
		sample.Command = uint32(m.Command)
		sample.Param1 = m.Param1
	default:
		return wire.Sample{}, false
	}
	return sample, true
}

func Command(system byte, command uint16, param1 float32) *common.MessageCommandLong {
	return &common.MessageCommandLong{
		TargetSystem:    system,
		TargetComponent: 1,
		Command:         common.MAV_CMD(command),
		Param1:          param1,
	}
}
