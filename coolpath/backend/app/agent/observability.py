"""
CoolPath Agent Tracing & Observability Logger
================================================
Generates trace IDs and logs tool calls, latency breakdown, grounding status,
and model responses for agent debugging and hackathon demonstration.
"""

import time
import uuid
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger("coolpath.agent.trace")

class AgentTrace:
    def __init__(self, request_type: str = "assistant_chat"):
        self.trace_id = f"tr_{uuid.uuid4().hex[:8]}"
        self.request_type = request_type
        self.start_time = time.time()
        self.tool_calls: List[Dict[str, Any]] = []
        self.grounding_corrections: List[str] = []
        self.latencies_ms: Dict[str, float] = {}

    def log_tool_call(self, tool_name: str, args: Dict[str, Any], duration_ms: float, status: str = "success"):
        call_info = {
            "tool": tool_name,
            "args": args,
            "duration_ms": round(duration_ms, 2),
            "status": status,
            "timestamp": time.time()
        }
        self.tool_calls.append(call_info)
        self.latencies_ms[f"tool_{tool_name}"] = round(duration_ms, 2)
        logger.info(f"[{self.trace_id}] Tool {tool_name} executed in {duration_ms:.1f}ms ({status})")

    def log_grounding_correction(self, correction_detail: str):
        self.grounding_corrections.append(correction_detail)
        logger.info(f"[{self.trace_id}] Grounding correction: {correction_detail}")

    def finalize(self, response_summary: str) -> Dict[str, Any]:
        total_duration = round((time.time() - self.start_time) * 1000, 2)
        self.latencies_ms["total_ms"] = total_duration
        summary = {
            "trace_id": self.trace_id,
            "request_type": self.request_type,
            "total_duration_ms": total_duration,
            "tool_calls_count": len(self.tool_calls),
            "tool_calls": self.tool_calls,
            "grounding_corrections": self.grounding_corrections,
            "latencies_ms": self.latencies_ms,
            "response_summary": response_summary[:100]
        }
        logger.info(f"[{self.trace_id}] Trace completed in {total_duration:.1f}ms (Tools: {len(self.tool_calls)})")
        return summary
