export interface LivePoint {
  tail_number: string;
  lat: number;
  lon: number;
  alt_m: number;
  classification: string;
  time?: string;
  airworthiness?: string | null;
  // Vehicle state. Optional: older gateways send position only.
  heading_deg?: number;
  ground_mps?: number;
  climb_mps?: number;
  battery_pct?: number;
  mode?: string;
  armed?: boolean;
  nav_source?: string;
  gnss_trusted?: boolean;
  /** Horizontal position error, 1-sigma, metres (for example PX4's EKF eph). */
  pos_sigma_m?: number;
  // From the vehicle's own estimator and power system when the gateway relays them.
  air_mps?: number;
  wind_mps?: number;
  wind_from_deg?: number;
  roll_deg?: number;
  pitch_deg?: number;
  power_w?: number;
  pack_v?: number;
  /** Minutes of usable energy left at the present draw. */
  endurance_min?: number;
  /** Minutes to fly home at best-range speed against the wind. */
  home_min?: number;
  /** The vehicle has turned for home because the reserve would not survive the plan. */
  bingo?: boolean;
  forced_landing?: boolean;
  rssi_dbm?: number;
  link_margin_db?: number;
  airframe?: string;
}
