import time
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class EventRequest(BaseModel):
    family_code: str = Field(default="DEMO01", description="Family identifier code")
    event_type: str = Field(..., description="Type of event, e.g., keyword_detected, stage_advance")
    stage: int = Field(default=0, ge=0, description="Stage index or identifier")
    weight: float = Field(default=0.0, description="Weight/score contributed by this event")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional context or payload")


class EventResponse(BaseModel):
    status: str = "success"
    family_code: str
    current_stage: int
    score: float
    is_red: bool


class PollResponse(BaseModel):
    family_code: str
    current_stage: int
    score: float
    is_red: bool
    last_updated: float
    recent_events: List[Dict[str, Any]] = Field(default_factory=list)

