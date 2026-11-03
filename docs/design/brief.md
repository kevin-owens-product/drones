# Brief: intent to plan with human approval

**Brief** (`#brief`) lets an operator type a mission the way they would say it, for example "search the north field with two vehicles before 14:00, then check the culvert, keep two in reserve". The console turns that into the planner's own primitives: tasks on named places, vehicles per task, a reserve, a deadline and areas to avoid. It assigns vehicles and shows the proposal. **Nothing happens until a person presses Approve.** Even then the console only files a draft for the mission planner, which goes through mission review like any other plan. No command is sent to a vehicle. The logic is in `demo/intent.mjs`.

## How it reads a brief

- **Parser.** A small deterministic grammar that runs offline. It splits the brief into clauses on commas, "then" and full stops. In each clause it looks for a verb (search, survey, observe, relay, inspect, with synonyms), a known place, a vehicle count, a duration, a deadline, a reserve, and "avoid the jamming zone".
- **Explainable.** Every task quotes the words it came from. A clause it could not read is listed under "Not understood"; it is never guessed. A verb with no known place gets the list of places it does know.
- **Assignment.** Each task gets the nearest available vehicles, taken in order. The reserve is held back from what is left. A vehicle is unavailable when it is grounded or under 50% battery, and the proposal says why it was left out. If the fleet cannot cover a request, the proposal says "wanted N, got M" and does not quietly shrink the task.
- **Approval.** Proposals start as `awaiting approval`. Approve and Reject record who decided. A second decision on the same proposal returns 409.

## What it refuses

A brief that asks to strike, attack, engage, destroy, bomb, drop or release on, kill, neutralise, or target people or vehicles is refused outright. The refusal cites ADR-0016, and no plan is built. The system surveys, observes, relays and inspects; it never arms or releases.

## Why no language model (yet)

The console runs inside the air gap (ADR-0021), so it cannot call a hosted model. A grammar also makes each reading auditable, which matters more than flexibility for a first version. A local language model could propose the same structure behind the same approval step and the same refusal check. In that design the model only writes the proposal, and the human still approves it. That model is not wired in, and the page is labelled OFFLINE PARSER so nobody mistakes it for one.

## Limits

- The vocabulary is fixed: five verbs, eight named places on the demo range, and numbers up to six. Anything else is reported as not understood.
- Assignment is greedy by straight-line distance. It ignores battery endurance, and it does not route around the jamming zone. The denial map and the configuration planner already cover those, and a real version would call both.
- Proposals are kept in memory in the demo server.
