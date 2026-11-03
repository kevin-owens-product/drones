export type Section =
  | "operate"
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
};
