export type Section =
  | "operate"
  | "overview"
  | "live"
  | "fleet"
  | "video"
  | "missions"
  | "debrief"
  | "eval"
  | "attrition"
  | "reports"
  | "denial"
  | "configure"
  | "brief"
  | "organization"
  | "people"
  | "sharing"
  | "audit";

export type Viewer = {
  id: string;
  username: string;
  display_name: string;
  citizenship: string;
  clearance: string;
  ntk_programs: string[];
  roles: string[];
};
