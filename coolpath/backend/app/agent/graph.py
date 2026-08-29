import asyncio
import logging
import os

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from app.agent.state import CoolPathDispatchState
from app.agent.nodes import (
    load_state_node,
    parse_patch_node,
    validate_patch_node,
    merge_state_node,
    diff_state_node,
    plan_dependencies_node,
    fetch_work_order_node,
    fetch_routes_node,
    fetch_thermal_node,
    generate_candidates_node,
    evaluate_constraints_node,
    select_decision_node,
    explain_node,
    supersession_guard_node
)

logger = logging.getLogger(__name__)


def _checkpoint_connection_kwargs():
    from psycopg.rows import dict_row

    return {
        "autocommit": True,
        "prepare_threshold": 0,
        "row_factory": dict_row,
    }


def _create_checkpoint_pool(connection_pool_cls, conninfo: str):
    return connection_pool_cls(
        conninfo=conninfo,
        min_size=1,
        max_size=5,
        open=False,
        kwargs=_checkpoint_connection_kwargs(),
    )


def _uses_postgres_checkpointer() -> bool:
    return (
        os.getenv("ENVIRONMENT", "local") == "production"
        or os.getenv("USE_POSTGRES_SAVER", "false").lower() == "true"
    )


async def create_checkpointer():
    """
    Checkpointer factory.
    Uses MemorySaver for Phase 4 testing and local execution unless configured otherwise.
    Uses PostgresSaver in Phase 5 production, with a hard-fail if unavailable.
    """
    if _uses_postgres_checkpointer():
        pool = None
        try:
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
            from psycopg_pool import AsyncConnectionPool
            from app.config import CHECKPOINT_DATABASE_URL

            pool = _create_checkpoint_pool(
                AsyncConnectionPool,
                CHECKPOINT_DATABASE_URL,
            )
            await pool.open(wait=True)
            saver = AsyncPostgresSaver(pool)
            await saver.setup()
            return saver, pool
        except Exception as exc:
            if pool is not None:
                await pool.close()
            logger.critical(
                "Checkpoint initialization failed category=CHECKPOINT_FAILURE "
                "exception_class=%s",
                type(exc).__name__,
            )
            raise

    return MemorySaver(), None

# Initialize the StateGraph
builder = StateGraph(CoolPathDispatchState)

# Add nodes
builder.add_node("load_state", load_state_node)
builder.add_node("parse_patch", parse_patch_node)
builder.add_node("validate_patch", validate_patch_node)
builder.add_node("merge_state", merge_state_node)
builder.add_node("diff_state", diff_state_node)
builder.add_node("plan_dependencies", plan_dependencies_node)

builder.add_node("fetch_work_order", fetch_work_order_node)
builder.add_node("fetch_routes", fetch_routes_node)
builder.add_node("fetch_thermal", fetch_thermal_node)

builder.add_node("generate_candidates", generate_candidates_node)
builder.add_node("evaluate_constraints", evaluate_constraints_node)
builder.add_node("select_decision", select_decision_node)

builder.add_node("explain", explain_node)
builder.add_node("supersession_guard", supersession_guard_node)

# Define edges
builder.add_edge(START, "load_state")
builder.add_edge("load_state", "parse_patch")
builder.add_edge("parse_patch", "validate_patch")
builder.add_edge("validate_patch", "merge_state")
builder.add_edge("merge_state", "diff_state")
builder.add_edge("diff_state", "plan_dependencies")

# Conditional routing based on dependencies
def route_after_planning(state: CoolPathDispatchState) -> str:
    # Normally we'd do parallel or sequential fetching based on flags
    # We will just route sequentially if needed for simplicity, or we can route directly.
    return "fetch_work_order"

builder.add_conditional_edges("plan_dependencies", route_after_planning)

builder.add_edge("fetch_work_order", "fetch_routes")
builder.add_edge("fetch_routes", "fetch_thermal")
builder.add_edge("fetch_thermal", "generate_candidates")

builder.add_edge("generate_candidates", "evaluate_constraints")
builder.add_edge("evaluate_constraints", "select_decision")
builder.add_edge("select_decision", "explain")
builder.add_edge("explain", "supersession_guard")
builder.add_edge("supersession_guard", END)

class MissionAgentExecutor:
    def __init__(self):
        self._graph = None
        self._pool = None
        self._initialize_lock = None

    async def initialize(self):
        if self._graph is not None:
            return

        if self._initialize_lock is None:
            self._initialize_lock = asyncio.Lock()

        async with self._initialize_lock:
            if self._graph is not None:
                return
            checkpointer, pool = await create_checkpointer()
            self._pool = pool
            self._graph = builder.compile(checkpointer=checkpointer)

    async def ainvoke(self, *args, **kwargs):
        await self.initialize()
        return await self._graph.ainvoke(*args, **kwargs)

    async def close(self):
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
        self._graph = None


agent_executor = MissionAgentExecutor()
