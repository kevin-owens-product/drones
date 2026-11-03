// Package wire encodes telemetry.v1.Sample. The layout matches proto/telemetry/v1/sample.proto.
package wire

import (
	"encoding/binary"
	"math"
)

type Sample struct {
	SystemID            uint32
	Name                string
	ReceivedUnixNs      int64
	LatE7               int32
	LonE7               int32
	AltMM               int32
	Roll                float32
	Pitch               float32
	Yaw                 float32
	CustomMode          uint32
	BaseMode            uint32
	VxCms               int32
	VyCms               int32
	VzCms               int32
	BatteryRemainingPct int32
	EstimatorFlags      uint32
	RCCount             uint32
	VoltageMV           uint32
	XM                  float32
	YM                  float32
	ZM                  float32
	Command             uint32
	Param1              float32
}

func Marshal(s Sample) []byte {
	var b []byte
	b = appendVarint(b, 1, uint64(s.SystemID))
	b = appendString(b, 2, s.Name)
	b = appendVarint(b, 3, uint64(s.ReceivedUnixNs))
	b = appendZigzag(b, 4, int64(s.LatE7))
	b = appendZigzag(b, 5, int64(s.LonE7))
	b = appendZigzag(b, 6, int64(s.AltMM))
	b = appendFixed32(b, 7, math.Float32bits(s.Roll))
	b = appendFixed32(b, 8, math.Float32bits(s.Pitch))
	b = appendFixed32(b, 9, math.Float32bits(s.Yaw))
	b = appendVarint(b, 10, uint64(s.CustomMode))
	b = appendVarint(b, 11, uint64(s.BaseMode))
	b = appendZigzag(b, 12, int64(s.VxCms))
	b = appendZigzag(b, 13, int64(s.VyCms))
	b = appendZigzag(b, 14, int64(s.VzCms))
	b = appendZigzag(b, 15, int64(s.BatteryRemainingPct))
	b = appendVarint(b, 16, uint64(s.EstimatorFlags))
	b = appendVarint(b, 17, uint64(s.RCCount))
	b = appendVarint(b, 18, uint64(s.VoltageMV))
	b = appendFixed32(b, 19, math.Float32bits(s.XM))
	b = appendFixed32(b, 20, math.Float32bits(s.YM))
	b = appendFixed32(b, 21, math.Float32bits(s.ZM))
	b = appendVarint(b, 22, uint64(s.Command))
	b = appendFixed32(b, 23, math.Float32bits(s.Param1))
	return b
}

func Unmarshal(buf []byte) (Sample, error) {
	var s Sample
	i := 0
	for i < len(buf) {
		key, n := uvarint(buf[i:])
		if n <= 0 {
			return s, errShort
		}
		i += n
		field := int(key >> 3)
		wire := key & 7
		switch wire {
		case 0:
			v, m := uvarint(buf[i:])
			if m <= 0 {
				return s, errShort
			}
			i += m
			putVar(field, v, &s)
		case 2:
			ln, m := uvarint(buf[i:])
			if m <= 0 || i+m+int(ln) > len(buf) {
				return s, errShort
			}
			i += m
			s.Name = string(buf[i : i+int(ln)])
			i += int(ln)
		case 5:
			if i+4 > len(buf) {
				return s, errShort
			}
			bits := binary.LittleEndian.Uint32(buf[i : i+4])
			i += 4
			putFixed(field, bits, &s)
		default:
			return s, errWire
		}
	}
	return s, nil
}

type protoError string

func (e protoError) Error() string { return string(e) }

const (
	errShort protoError = "short protobuf"
	errWire  protoError = "unsupported wire type"
)

func putVar(field int, v uint64, s *Sample) {
	switch field {
	case 1:
		s.SystemID = uint32(v)
	case 3:
		s.ReceivedUnixNs = int64(v)
	case 4:
		s.LatE7 = int32(zigzagDecode(v))
	case 5:
		s.LonE7 = int32(zigzagDecode(v))
	case 6:
		s.AltMM = int32(zigzagDecode(v))
	case 10:
		s.CustomMode = uint32(v)
	case 11:
		s.BaseMode = uint32(v)
	case 12:
		s.VxCms = int32(zigzagDecode(v))
	case 13:
		s.VyCms = int32(zigzagDecode(v))
	case 14:
		s.VzCms = int32(zigzagDecode(v))
	case 15:
		s.BatteryRemainingPct = int32(zigzagDecode(v))
	case 16:
		s.EstimatorFlags = uint32(v)
	case 17:
		s.RCCount = uint32(v)
	case 18:
		s.VoltageMV = uint32(v)
	case 22:
		s.Command = uint32(v)
	}
}

func putFixed(field int, bits uint32, s *Sample) {
	f := math.Float32frombits(bits)
	switch field {
	case 7:
		s.Roll = f
	case 8:
		s.Pitch = f
	case 9:
		s.Yaw = f
	case 19:
		s.XM = f
	case 20:
		s.YM = f
	case 21:
		s.ZM = f
	case 23:
		s.Param1 = f
	}
}

func appendVarint(b []byte, field int, v uint64) []byte {
	if v == 0 {
		return b
	}
	b = appendKey(b, field, 0)
	return appendUvarint(b, v)
}

func appendZigzag(b []byte, field int, v int64) []byte {
	if v == 0 {
		return b
	}
	b = appendKey(b, field, 0)
	return appendUvarint(b, zigzagEncode(v))
}

func appendString(b []byte, field int, s string) []byte {
	if s == "" {
		return b
	}
	b = appendKey(b, field, 2)
	b = appendUvarint(b, uint64(len(s)))
	return append(b, s...)
}

func appendFixed32(b []byte, field int, bits uint32) []byte {
	if bits == 0 {
		return b
	}
	b = appendKey(b, field, 5)
	var buf [4]byte
	binary.LittleEndian.PutUint32(buf[:], bits)
	return append(b, buf[:]...)
}

func appendKey(b []byte, field int, wire int) []byte {
	return appendUvarint(b, uint64(field<<3|wire))
}

func appendUvarint(b []byte, v uint64) []byte {
	for v >= 0x80 {
		b = append(b, byte(v)|0x80)
		v >>= 7
	}
	return append(b, byte(v))
}

func uvarint(b []byte) (uint64, int) {
	var x uint64
	for i := 0; i < len(b) && i < 10; i++ {
		x |= uint64(b[i]&0x7f) << (7 * uint(i))
		if b[i] < 0x80 {
			return x, i + 1
		}
	}
	return 0, -1
}

func zigzagEncode(v int64) uint64 {
	return uint64((v << 1) ^ (v >> 63))
}

func zigzagDecode(v uint64) int64 {
	return int64(v>>1) ^ -int64(v&1)
}
