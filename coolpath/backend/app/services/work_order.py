from typing import dict

class DemoWorkOrderProvider:
    """
    Provides mock work orders and crew contexts for the Thermal Dispatch Gate.
    """
    
    async def get_work_order(self, work_order_id: str) -> dict:
        # Mocking a work order
        return {
            "work_order_id": work_order_id,
            "task_type": "repair",
            "job_location": {"lat": 40.71, "lng": -74.01},
            "estimated_outdoor_minutes": 45,
            "priority": "NORMAL",
            "sla_deadline_iso": "2026-08-29T16:00:00Z"
        }
        
    async def get_crew_context(self, crew_id: str) -> dict:
        # Mocking a crew context
        return {
            "crew_id": crew_id,
            "crew_location": {"lat": 40.70, "lng": -74.00},
            "thermal_policy_id": "p1",
            "thermal_policy_version": "v1"
        }
