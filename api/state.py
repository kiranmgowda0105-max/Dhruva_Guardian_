import time
from threading import Lock
from typing import Any, Dict, List, Optional


class FamilyState:
    def __init__(self, family_code: str, red_threshold: float = 100.0):
        self.family_code = family_code
        self.current_stage = 0
        self.score = 0.0
        self.is_red = False
        self.events: List[Dict[str, Any]] = []
        self.last_updated = time.time()
        self.red_threshold = red_threshold

    def add_event(self, event_type: str, stage: int, weight: float, metadata: Dict[str, Any]) -> None:
        self.events.append({
            "event_type": event_type,
            "stage": stage,
            "weight": weight,
            "metadata": metadata,
            "timestamp": time.time(),
        })
        self.score += weight
        if stage > self.current_stage:
            self.current_stage = stage
        if self.score >= self.red_threshold:
            self.is_red = True
        self.last_updated = time.time()

    def reset(self) -> None:
        self.current_stage = 0
        self.score = 0.0
        self.is_red = False
        self.events = []
        self.last_updated = time.time()


class StateStore:
    def __init__(self):
        self._lock = Lock()
        self._families: Dict[str, FamilyState] = {}

    def get_or_create(self, family_code: str) -> FamilyState:
        with self._lock:
            if family_code not in self._families:
                self._families[family_code] = FamilyState(family_code)
            return self._families[family_code]


store = StateStore()

