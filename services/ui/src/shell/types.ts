export type Section =
  | "overview"
  | "live"
  | "fleet"
  | "video"
  | "missions"
  | "debrief"
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
