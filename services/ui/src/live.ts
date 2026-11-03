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
}
