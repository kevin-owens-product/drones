"""Human approval. A behavior cannot move a plan to approved or active."""

from __future__ import annotations


class WorkflowError(ValueError):
    pass


# (current, action) -> next state. The action name matches the role matrix.
_EDGES: dict[tuple[str, str], str] = {
    ("draft", "mission.review"): "review",
    ("review", "mission.approve"): "approved",
    ("approved", "mission.execute"): "active",
    ("active", "mission.execute"): "closed",
}


def transition(
    state: str,
    action: str,
    *,
    actor_id: str,
    requested_by: str,
    behavior_initiated: bool = False,
) -> str:
    if behavior_initiated and action in {"mission.approve", "mission.execute"}:
        raise WorkflowError("behavior_cannot_approve")
    nxt = _EDGES.get((state, action))
    if nxt is None:
        raise WorkflowError("illegal_transition")
    if nxt == "approved" and actor_id == requested_by:
        raise WorkflowError("two_person_required")
    return nxt
