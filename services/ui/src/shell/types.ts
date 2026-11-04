export type Section =
  | "operate"
  | "ops"
  | "supply"
  | "fleet"
  | "company"
  | "missions"
  | "debrief"
  | "eval"
  | "attrition"
  | "reports"
  | "denial"
  | "configure"
  | "brief"
  | "receiving"
  | "accountability"
  | "quality"
  | "compliance"
  | "readiness"
  | "program"
  | "updates"
  | "integrations"
  | "quote"
  | "mixed"
  | "config"
  | "access"
  | "audit";

export type Viewer = {
  id: string;
  username: string;
  display_name: string;
  citizenship: string;
  clearance: string;
  ntk_programs: string[];
  roles: string[];
  /** "neros" runs operations; a customer id runs its own fleet. Absent on the real API: everything shows. */
  org?: string;
  org_name?: string;
};
