"""Domain routers. Governance stays available; it is not the product surface."""

from a2e.routers.autonomy import router as autonomy_router
from a2e.routers.eval import router as eval_router
from a2e.routers.flight import router as flight_router
from a2e.routers.governance import router as governance_router
from a2e.routers.insights import router as insights_router
from a2e.routers.missions import router as missions_router
from a2e.routers.sim import router as sim_router
from a2e.routers.telemetry import router as telemetry_router
from a2e.routers.vehicles import router as vehicles_router

routers = (
    governance_router,
    vehicles_router,
    telemetry_router,
    missions_router,
    autonomy_router,
    sim_router,
    eval_router,
    flight_router,
    insights_router,
)
