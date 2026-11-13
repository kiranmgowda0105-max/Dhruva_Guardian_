import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Dict, List, Optional, Set
from dotenv import load_dotenv
import httpx

# Configure logging
logger = logging.getLogger("dhruva.telegram")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

# Load repo-root .env
repo_root = Path(__file__).resolve().parent.parent
env_path = repo_root / ".env"
load_dotenv(dotenv_path=env_path)

TG_TOKEN = os.getenv("TG_TOKEN")
TELEGRAM_API_BASE = f"https://api.telegram.org/bot{TG_TOKEN}" if TG_TOKEN else ""

PAIRINGS_FILE = Path(__file__).resolve().parent / "pairings.json"

# In-memory storage for pairings: { code: set(chat_ids) }
pairings: Dict[str, Set[int]] = {}

# Track last alert dispatch per family code: { code: timestamp }
last_alert_time: Dict[str, float] = {}

# Background polling task handle
bot_task: Optional[asyncio.Task] = None


def load_pairings() -> None:
    """Loads existing pairings from pairings.json into memory."""
    global pairings
    if not PAIRINGS_FILE.exists():
        pairings = {}
        return

    try:
        with open(PAIRINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            pairings = {code: set(chats) for code, chats in data.items()}
            logger.info("Loaded pairings for %d family codes.", len(pairings))
    except Exception as exc:
        logger.error("Failed to load pairings from %s: %s", PAIRINGS_FILE, exc)
        pairings = {}


def save_pairings() -> None:
    """Saves memory pairings to pairings.json."""
    try:
        serializable = {code: list(chats) for code, chats in pairings.items()}
        with open(PAIRINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(serializable, f, indent=2)
    except Exception as exc:
        logger.error("Failed to save pairings to %s: %s", PAIRINGS_FILE, exc)


async def send_message(chat_id: int, text: str) -> bool:
    """Sends a text message to a specific Telegram chat_id."""
    if not TG_TOKEN:
        return False

    url = f"{TELEGRAM_API_BASE}/sendMessage"
    payload = {"chat_id": chat_id, "text": text}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload)
            if resp.status_code == 200:
                return True
            logger.error("Telegram sendMessage failed [%d]: %s", resp.status_code, resp.text)
            return False
    except Exception as exc:
        logger.error("Error sending Telegram message to %s: %s", chat_id, exc)
        return False


async def handle_update(update: dict) -> None:
    """Processes an incoming Telegram update."""
    message = update.get("message")
    if not message:
        return

    chat = message.get("chat")
    if not chat:
        return

    chat_id = chat.get("id")
    text = (message.get("text") or "").strip()

    if not text.startswith("/start"):
        return

    parts = text.split()
    if len(parts) > 1:
        code = parts[1].strip()
        if code not in pairings:
            pairings[code] = set()
        pairings[code].add(chat_id)
        save_pairings()

        reply = f"Paired with family {code}. You will get an alert if a scam call is detected."
        await send_message(chat_id, reply)
    else:
        reply = "Send /start followed by your family code, for example /start DEMO01"
        await send_message(chat_id, reply)


async def poll_updates() -> None:
    """Long-polling background task for Telegram getUpdates."""
    offset = 0
    logger.info("Starting Telegram bot long-polling...")

    async with httpx.AsyncClient(timeout=40.0) as client:
        while True:
            try:
                url = f"{TELEGRAM_API_BASE}/getUpdates"
                params = {"offset": offset, "timeout": 30}
                resp = await client.get(url, params=params)

                if resp.status_code == 200:
                    data = resp.json()
                    for update in data.get("result", []):
                        offset = max(offset, update["update_id"] + 1)
                        await handle_update(update)
                else:
                    logger.warning("Telegram getUpdates returned status %d", resp.status_code)
                    await asyncio.sleep(5)
            except asyncio.CancelledError:
                logger.info("Telegram polling task cancelled.")
                break
            except Exception as exc:
                logger.error("Error in Telegram long-polling: %s", exc)
                await asyncio.sleep(5)


async def start_bot() -> None:
    """Initializes and runs the Telegram bot background task."""
    global bot_task
    load_pairings()

    if not TG_TOKEN:
        logger.warning("TG_TOKEN is not configured. Telegram bot will not be started.")
        return

    bot_task = asyncio.create_task(poll_updates())


async def stop_bot() -> None:
    """Stops the Telegram bot background task."""
    global bot_task
    if bot_task:
        bot_task.cancel()
        try:
            await bot_task
        except asyncio.CancelledError:
            pass
        bot_task = None
        logger.info("Telegram bot stopped.")


async def notify(code: str, event: dict) -> None:
    """
    Sends scam alerts to all paired Telegram chats for the given family code.
    Enforces at most one message per family code every 30 seconds.
    """
    if not TG_TOKEN:
        return

    now = time.time()
    last_time = last_alert_time.get(code, 0.0)
    if now - last_time < 30.0:
        logger.info("Notification for %s throttled (< 30s since last alert).", code)
        return

    last_alert_time[code] = now

    chats = pairings.get(code)
    if not chats:
        logger.info("No paired Telegram chats found for family code %s.", code)
        return

    level = event.get("level", "unknown")
    stage = event.get("stage", 0)
    matched_list = event.get("matched", [])
    matched_str = ", ".join(matched_list) if matched_list else "none"

    message = (
        "ALERT: possible digital-arrest scam call.\n"
        f"Risk: {level}, stage {stage} of 5.\n"
        f"Heard: {matched_str}.\n"
        "Call them now."
    )

    for chat_id in list(chats):
        try:
            await send_message(chat_id, message)
        except Exception as exc:
            logger.error("Failed to notify chat_id %s: %s", chat_id, exc)


def get_status() -> dict:
    """Returns bot status and pairing counts without exposing secrets."""
    is_running = bool(TG_TOKEN and bot_task is not None and not bot_task.done())
    paired_summary = {code: len(chats) for code, chats in pairings.items()}
    return {
        "bot": is_running,
        "paired": paired_summary,
    }

