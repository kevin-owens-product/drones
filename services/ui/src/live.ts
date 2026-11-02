export interface LivePoint {
  tail_number: string;
  lat: number;
  lon: number;
  alt_m: number;
  classification: string;
  time?: string;
  airworthiness?: string | null;
}
