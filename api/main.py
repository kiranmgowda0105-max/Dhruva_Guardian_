import asyncio
import json
import os
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Optional, Union
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import telegram_bot

# Load environment variables
load_dotenv()
TG_TOKEN = os.getenv("TG_TOKEN")

EVENTS_FILE = Path(__file__).resolve().parent / "events.json"
ALERT_EXPIRY_SECONDS: float = 60.0

# Concurrency lock and monotonic ID tracker
_alert_lock = threading.Lock()
_last_alert_id: int = 0

# In-memory storage keyed by family code
latest_events: Dict[str, dict] = {}


def load_events():
    global latest_events, _last_alert_id
    if EVENTS_FILE.exists():
        try:
            with open(EVENTS_FILE, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                latest_events = loaded if isinstance(loaded, dict) else {}
                print(f"[API] Loaded {len(latest_events)} events from {EVENTS_FILE}")
                
                # Recover maximum existing integer ID across loaded events for monotonic continuity
                max_id = 0
                for ev in latest_events.values():
                    if isinstance(ev, dict) and "id" in ev:
                        try:
                            max_id = max(max_id, int(ev["id"]))
                        except (ValueError, TypeError):
                            pass
                with _alert_lock:
                    _last_alert_id = max(_last_alert_id, max_id)
        except Exception as e:
            print(f"[API] Error loading events from {EVENTS_FILE}: {e}")
            latest_events = {}


def save_events():
    try:
        with open(EVENTS_FILE, "w", encoding="utf-8") as f:
            json.dump(latest_events, f, indent=2)
    except Exception as e:
        print(f"[API] Error saving events to {EVENTS_FILE}: {e}")


def create_alert(
    level: str,
    message: str,
    reason: str,
    code: str = "DEMO01",
    score: float = 0.0,
    stage: int = 0,
    matched: Optional[List[str]] = None,
    ts: Optional[Union[float, int]] = None,
) -> dict:
    """
    Central, thread-safe function to create reliable alerts.
    Used by both Fake RED and real transcript analysis when RED is triggered.
    Assigns a strictly increasing unique integer ID (millisecond timestamp),
    standardized level, message, reason, and created_at.
    """
    global _last_alert_id

    with _alert_lock:
        now = time.time()
        candidate_id = int(now * 1000)
        # Ensure strict monotonic increase even under simultaneous calls or clock jitter
        if candidate_id <= _last_alert_id:
            candidate_id = _last_alert_id + 1
        _last_alert_id = candidate_id
        alert_id = candidate_id

        alert_dict = {
            "id": alert_id,
            "level": level.upper(),
            "message": message,
            "reason": reason,
            "created_at": now,
            "code": code,
            "score": score,
            "stage": stage,
            "matched": matched or [],
            "ts": ts if ts is not None else int(now),
        }

        latest_events[code] = alert_dict
        save_events()

    print(
        f"[API] Alert CREATED: id={alert_dict['id']}, level={alert_dict['level']}, "
        f"message='{alert_dict['message']}', reason='{alert_dict['reason']}', "
        f"code={code}, created_at={alert_dict['created_at']}"
    )

    # Trigger Telegram notification for RED alerts
    if level.upper() == "RED":
        asyncio.create_task(telegram_bot.notify(code, alert_dict))

    return alert_dict


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: load persisted events & initialize Telegram bot
    load_events()
    await telegram_bot.start_bot()
    yield
    # Shutdown: stop Telegram bot background task cleanly
    await telegram_bot.stop_bot()


app = FastAPI(title="Dhruva API", lifespan=lifespan)

# Enable CORS for web development and external clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Event(BaseModel):
    id: Optional[Union[int, str]] = Field(default=None, description="Optional incoming alert ID")
    code: str
    level: str
    score: float
    stage: int
    matched: List[str] = Field(default_factory=list)
    ts: Union[float, int]
    message: Optional[str] = None
    reason: Optional[str] = None
    created_at: Optional[float] = None


class EventResponse(BaseModel):
    ok: bool = True
    id: Optional[int] = None


class PollResponse(BaseModel):
    event: Optional[dict] = None


class HealthResponse(BaseModel):
    ok: bool = True


class LatestAlertResponse(BaseModel):
    id: int
    level: str
    message: str
    reason: str


DEFAULT_NONE_ALERT: dict = {
    "id": 0,
    "level": "NONE",
    "message": "",
    "reason": "",
}


@app.get("/health", response_model=HealthResponse)
def health():
    print("[API] GET /health requested -> returning ok: true")
    return {"ok": True}


@app.post("/event", response_model=EventResponse)
async def post_event(event: Event):
    """
    Event endpoint for transcript analysis & client alerts.
    When level is RED, creates an alert via the centralized create_alert function.
    """
    matched_str = ", ".join(event.matched) if event.matched else "none"
    default_reason = f"Stage {event.stage} triggered (matched: {matched_str})"
    default_message = "Possible digital-arrest scam" if event.level.upper() == "RED" else "Scam warning detected"

    if event.level.upper() == "RED":
        alert = create_alert(
            level="RED",
            message=event.message or default_message,
            reason=event.reason or default_reason,
            code=event.code,
            score=event.score,
            stage=event.stage,
            matched=event.matched,
            ts=event.ts,
        )
        return {"ok": True, "id": alert["id"]}
    else:
        print(f"[API] Event received with level={event.level} (not RED) -> no alert created")
        return {"ok": True, "id": None}


@app.api_route("/fake-red", methods=["GET", "POST"])
async def trigger_fake_red(code: str = Query(default="DEMO01")):
    """
    Fake RED alert generator.
    Calls the same create_alert function as transcript analysis.
    Supports GET (for browser testing) and POST.
    """
    alert = create_alert(
        level="RED",
        message="Possible digital-arrest scam",
        reason="Safe account payment demand (matched: safe account, tell no one)",
        code=code,
        score=55.0,
        stage=4,
        matched=["safe account", "tell no one"],
    )
    return {"ok": True, "alert": alert}


@app.get("/alerts/latest", response_model=LatestAlertResponse)
def get_latest_alert(code: Optional[str] = Query(default=None)):
    """
    Returns the newest alert only if it is less than 60 seconds old.
    Otherwise returns {"id": 0, "level": "NONE", "message": "", "reason": ""}.
    """
    now = time.time()
    alert: Optional[dict] = None

    with _alert_lock:
        if code:
            alert = latest_events.get(code)
        else:
            if latest_events:
                alert = max(latest_events.values(), key=lambda e: e.get("created_at", 0))

    if alert is not None:
        created_at = alert.get("created_at") or alert.get("ts", 0)
        age = now - created_at
        if age < ALERT_EXPIRY_SECONDS:
            res = {
                "id": alert["id"],
                "level": alert["level"],
                "message": alert["message"],
                "reason": alert["reason"],
            }
            print(f"[API] GET /alerts/latest SERVED: id={res['id']}, level={res['level']}, message='{res['message']}', reason='{res['reason']}' (age: {age:.1f}s)")
            return res
        else:
            print(f"[API] GET /alerts/latest: newest alert id={alert['id']} expired ({age:.1f}s old) -> returning NONE")

    print(f"[API] GET /alerts/latest SERVED: id=0, level=NONE (no active alert < {ALERT_EXPIRY_SECONDS}s)")
    return DEFAULT_NONE_ALERT


@app.get("/poll", response_model=PollResponse)
def get_poll(
    code: str = Query(..., description="Family code"),
    since: Optional[Union[float, int]] = Query(None, description="Timestamp threshold"),
):
    """
    Poll endpoint returning the family code's newest event (if active < 60s).
    Kept backward-compatible for existing Android app polling.
    """
    with _alert_lock:
        event_data = latest_events.get(code)
        if event_data is None:
            return {"event": None}

        created_at = event_data.get("created_at") or event_data.get("ts", 0)
        if time.time() - created_at > ALERT_EXPIRY_SECONDS:
            latest_events.pop(code, None)
            save_events()
            return {"event": None}

    if since is not None and event_data["ts"] <= since:
        return {"event": None}

    print(f"[API] GET /poll SERVING alert id={event_data.get('id')} for code={code}: level={event_data.get('level')}")
    return {"event": event_data}


@app.post("/dismiss")
@app.post("/ack")
def dismiss_alert(code: str = Query(default="DEMO01")):
    """Endpoint to explicitly acknowledge or clear an active alert."""
    with _alert_lock:
        if code in latest_events:
            cleared_id = latest_events[code].get("id")
            latest_events.pop(code, None)
            save_events()
            print(f"[API] Dismissed alert id={cleared_id} for code={code}")
    return {"ok": True}


@app.get("/tg/status")
def tg_status():
    """Returns Telegram bot status and paired counts without exposing credentials."""
    return telegram_bot.get_status()

