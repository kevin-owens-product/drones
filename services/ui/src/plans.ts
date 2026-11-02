export interface PlanAssignment {
  tail_number: string;
  mission_id: string;
  mission_name: string;
  state: string;
}

export function planLabel(state: string, name: string): string {
  if (state === "active") return `Mission active · ${name}`;
  if (state === "approved") return `Plan approved · ${name}`;
  if (state === "review") return `In review · ${name}`;
  return name;
}
